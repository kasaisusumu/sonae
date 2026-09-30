/**
 * 「未来の自分へのメッセージ」機能のユーザー分離監査スクリプト。
 *
 * このプロジェクトには ts-node 等の TypeScript ランナーが無いため、
 * scripts/test-admin-authz.mjs と同じ方針で、lib/future-messages.ts・
 * lib/learning.ts・lib/recall.ts が実際に使っている Prisma の where 条件を
 * このスクリプトでもそのまま実行し、2人ぶんのテストデータを使って
 * 「userB の操作から userA のデータが一切見えないこと」を検証する
 * （TypeScript モジュールの import はしない。lib 側の条件を変えたら、
 *  このスクリプトの対応する where 条件も合わせて直すこと）。
 *
 * 検証する3項目:
 *   ① LearnedRule（pattern_item）のカテゴリ横断検索
 *      — lib/learning.ts の getKnownPatternSlotTypes/getApplicablePatternRules
 *   ② FutureMessage の一致判定対象の取得
 *      — lib/future-messages.ts の ensureFutureMessageMatchesForEvent
 *   ③ recallBaseChecklist（似た予定からの準備リスト再利用）の候補取得
 *      — lib/recall.ts の recallBaseChecklist
 *
 * 安全装置:
 *   このスクリプトは書き込みを行うため、接続先が本番 DB でないことを
 *   自分の目で確認したうえで、環境変数 CONFIRM_TEST_DB=1 を付けて実行すること。
 *   （テスト環境構築手順.md の「マイグレーションの当て方」と同じく、
 *    DATABASE_URL / DIRECT_URL をテスト用 Neon ブランチの接続文字列に
 *    一時的に差し替えてから実行する）
 *
 * 実行例（PowerShell）:
 *   $env:DATABASE_URL="<テスト用 Pooled 接続文字列>"
 *   $env:DIRECT_URL="<テスト用 Direct 接続文字列>"
 *   $env:CONFIRM_TEST_DB="1"
 *   node scripts/test-user-isolation.mjs
 *
 * 後始末: 作成した2人のテストユーザーは、成功・失敗を問わず finally で必ず削除する
 * （関連する Category / Event / FutureMessage 等は onDelete: Cascade で連動して消える）。
 */

import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const EMAIL_A = "test-isolation-a@example.com";
const EMAIL_B = "test-isolation-b@example.com";

let failures = 0;
function check(label, ok, detail = "") {
  if (ok) {
    console.log(`✅ ${label}`);
  } else {
    failures++;
    console.error(`🚨 ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

async function main() {
  const dbUrl = process.env.DATABASE_URL || "";
  const host = dbUrl.match(/@([^/]+)\//)?.[1] ?? "(unknown)";
  console.log(`対象DB: ${host}`);
  if (process.env.CONFIRM_TEST_DB !== "1") {
    console.error(
      "\n安全のため停止しました。上の対象DBが本番ではなくテスト用 Neon ブランチで" +
        "あることを確認したうえで、環境変数 CONFIRM_TEST_DB=1 を付けて実行してください。",
    );
    process.exitCode = 1;
    return;
  }

  const { PrismaClient } = await import(
    pathToFileURL(path.join(ROOT, "generated", "prisma", "index.js")).href
  );
  const prisma = new PrismaClient();

  let userA;
  let userB;
  try {
    userA = await prisma.user.upsert({
      where: { email: EMAIL_A },
      update: {},
      create: { email: EMAIL_A, name: "分離テストA" },
    });
    userB = await prisma.user.upsert({
      where: { email: EMAIL_B },
      update: {},
      create: { email: EMAIL_B, name: "分離テストB" },
    });

    const catA = await prisma.category.create({
      data: { userId: userA.id, name: "旅行・出張" },
    });
    const catB = await prisma.category.create({
      data: { userId: userB.id, name: "旅行・出張" },
    });

    // ── ① LearnedRule（pattern_item）のカテゴリ横断検索 ──
    await prisma.learnedRule.create({
      data: {
        categoryId: catA.id,
        itemKind: "task",
        ruleType: "pattern_item",
        target: "新幹線の時間を確認する",
        featureSignature: "{}",
        slotType: "交通手段",
        patternTemplate: "{slot}の時間を確認する",
        aiConfidence: 0.9,
        confirmedCount: 2,
        contradictedCount: 0,
      },
    });
    // lib/learning.ts: getKnownPatternSlotTypes(userId) と同じ where 条件
    const slotTypesForB = await prisma.learnedRule.findMany({
      where: { ruleType: "pattern_item", category: { userId: userB.id } },
      select: { slotType: true },
    });
    check(
      "① userB から userA の pattern_item が見えない",
      slotTypesForB.length === 0,
      `${slotTypesForB.length}件見えてしまっている`,
    );
    const slotTypesForA = await prisma.learnedRule.findMany({
      where: { ruleType: "pattern_item", category: { userId: userA.id } },
      select: { slotType: true },
    });
    check(
      "① （前提確認）userA 自身からは pattern_item が見える",
      slotTypesForA.length === 1,
      "テストデータの前提が崩れている可能性",
    );

    // ── ② FutureMessage の一致判定対象の取得 ──
    await prisma.futureMessage.create({
      data: {
        userId: userA.id,
        body: "前回のギブアンドテイクを忘れない",
        keywords: "[]",
        genres: JSON.stringify(["飲み会系"]),
        genreKeywords: JSON.stringify([
          { genre: "飲み会系", terms: ["飲み会", "忘年会"] },
        ]),
        categoryIds: "[]",
      },
    });
    // lib/future-messages.ts: ensureFutureMessageMatchesForEvent 内の
    // `prisma.futureMessage.findMany({ where: { userId: event.userId, archivedAt: null } })`
    // と同じ where 条件（イベントの持ち主＝userB を渡す）
    const messagesVisibleToB = await prisma.futureMessage.findMany({
      where: { userId: userB.id, archivedAt: null },
    });
    check(
      "② userB のイベントに対する一致判定で userA のメッセージが候補に出ない",
      messagesVisibleToB.length === 0,
      `${messagesVisibleToB.length}件見えてしまっている`,
    );
    const messagesVisibleToA = await prisma.futureMessage.findMany({
      where: { userId: userA.id, archivedAt: null },
    });
    check(
      "② （前提確認）userA 自身のメッセージは候補に出る",
      messagesVisibleToA.length === 1,
      "テストデータの前提が崩れている可能性",
    );

    // ── ③ recallBaseChecklist（似た予定からの再利用）の候補取得 ──
    const future = new Date(Date.now() + 7 * 86_400_000);
    const eventA = await prisma.event.create({
      data: {
        userId: userA.id,
        categoryId: catA.id,
        title: "ハワイ旅行",
        eventDatetime: future,
        listReviewedAt: new Date(),
      },
    });
    await prisma.checklistItem.create({
      data: {
        eventId: eventA.id,
        kind: "task",
        title: "パスポートを確認する",
        isSuggested: false,
      },
    });
    const eventB = await prisma.event.create({
      data: {
        userId: userB.id,
        categoryId: catB.id,
        title: "ハワイ旅行",
        eventDatetime: future,
      },
    });
    // lib/recall.ts: recallBaseChecklist 内の候補取得と同じ where 条件
    // （userId, categoryId をイベントの持ち主＝userB でスコープ）
    const candidatesForB = await prisma.event.findMany({
      where: {
        userId: userB.id,
        categoryId: catB.id,
        id: { not: eventB.id },
        AND: [
          {
            OR: [
              { checklistItems: { some: { isSuggested: false } } },
              { listCleared: true },
            ],
          },
          {
            OR: [
              { editRecords: { some: {} } },
              { listCustomized: true },
              { listReviewedAt: { not: null } },
            ],
          },
        ],
      },
      select: { id: true },
    });
    check(
      "③ userB の「似た予定」再利用候補に userA の予定が出ない",
      candidatesForB.length === 0,
      `${candidatesForB.length}件見えてしまっている`,
    );

    console.log(
      failures === 0
        ? "\n✅ すべての分離テストに合格しました。"
        : `\n🚨 ${failures}件の分離テストが失敗しました。上のログを確認してください。`,
    );
    process.exitCode = failures === 0 ? 0 : 1;
  } finally {
    for (const u of [userA, userB]) {
      if (!u) continue;
      await prisma.user.delete({ where: { id: u.id } }).catch(() => {});
    }
    await prisma.$disconnect();
    console.log("後始末: テストユーザー2人（と関連レコード）を削除しました。");
  }
}

main().catch((e) => {
  console.error("\nエラー:", e.message ?? e);
  process.exitCode = 1;
});
