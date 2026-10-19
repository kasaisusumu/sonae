#!/usr/bin/env node
/**
 * 機能モード切替（テスト版／本番版）の軽い巻き戻し。
 *
 * 接続先が test ブランチ（ホスト名に ep-bitter-queen を含む）以外なら即中止する。
 * 既定は dry-run（何をするかの一覧と件数だけ表示）。実行するには --execute を付ける。
 *
 * 使い方:
 *   DATABASE_URL=<testブランチの接続文字列> node scripts/rollback-mode-switch.mjs
 *   DATABASE_URL=<testブランチの接続文字列> node scripts/rollback-mode-switch.mjs --execute
 *
 * 行うこと（この順）:
 *   1. prisma/rollback/20261014090000_feature_mode.down.sql を実行
 *      （User.featureMode, LearnedRule/ChecklistScopeRule の変換用の列、
 *       FeatureModeChange テーブルを削除。_prisma_migrations の記録も取り消す）。
 *   2. 作業後にユーザーが作ったデータ（予定・メッセージ・編集など）は一切触らない。
 *
 * コードの巻き戻し（git revert）は別に行うこと（このスクリプトはDBだけ）。
 */
import fs from "fs";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const EXECUTE = process.argv.includes("--execute");

const DATABASE_URL = process.env.DATABASE_URL || "";
const DIRECT_URL = process.env.DIRECT_URL || DATABASE_URL;

function safetyCheck() {
  const ok = (url) => /ep-bitter-queen/.test(url);
  if (!DATABASE_URL || !ok(DATABASE_URL) || !ok(DIRECT_URL)) {
    console.error(
      "SAFETY ABORT: DATABASE_URL/DIRECT_URL がテスト用ブランチ（ep-bitter-queen）を指していません。",
    );
    console.error("  DATABASE_URL:", DATABASE_URL ? DATABASE_URL.replace(/:[^:@]+@/, ":***@") : "(未設定)");
    process.exit(1);
  }
}

async function main() {
  safetyCheck();

  const { PrismaClient } = await import(
    pathToFileURL(path.join(ROOT, "generated", "prisma", "index.js")).href
  );
  const prisma = new PrismaClient({ datasourceUrl: DIRECT_URL });

  const downSqlPath = path.join(
    ROOT,
    "prisma",
    "rollback",
    "20261014090000_feature_mode.down.sql",
  );
  const downSql = fs
    .readFileSync(downSqlPath, "utf8")
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");
  const statements = downSql
    .split(/;\s*\n/)
    .map((s) => s.trim())
    .filter(Boolean);

  // 事前確認（削除対象の件数）
  const featureModeChangeCount = await safeCount(prisma, "FeatureModeChange");
  const usersWithNonDefaultMode = await safeCount(
    prisma,
    "User",
    `"featureMode" <> 'test'`,
  );
  // 自動変換の派生行（まだ誰も触っていない＝archivedAt が無い状態のまま）。
  // down SQL で列ごと消す前に、この行だけ削除する（触られたものは autoConverted=false
  // の新しい行に置き換わっている＝既に対象外なので、安全に削除できる）。
  const dormantLearnedRuleCount = await safeCount(
    prisma,
    "LearnedRule",
    `"autoConverted" = true`,
  );
  const dormantScopeRuleCount = await safeCount(
    prisma,
    "ChecklistScopeRule",
    `"autoConverted" = true and "archivedAt" is null`,
  );

  console.log(EXECUTE ? "=== 実行モード ===" : "=== dry-run（--execute を付けると実行） ===");
  console.log("接続先:", DATABASE_URL.replace(/:[^:@]+@/, ":***@"));
  console.log("");
  console.log("削除される行:");
  console.log(`  - FeatureModeChange（切替履歴）: ${featureModeChangeCount} 行`);
  console.log(`  - 自動変換された LearnedRule（まだ誰も触っていない分）: ${dormantLearnedRuleCount} 行`);
  console.log(`  - 自動変換された ChecklistScopeRule（まだ誰も触っていない分）: ${dormantScopeRuleCount} 行`);
  console.log(`  - User.featureMode 列（現在 "production" の利用者: ${usersWithNonDefaultMode} 名）`);
  console.log(`  - LearnedRule.autoConverted / convertedFromScopeRuleId 列`);
  console.log(`  - ChecklistScopeRule.autoConverted / convertedFromLearnedRuleId 列`);
  console.log("");
  console.log("残る（削除しない）もの:");
  console.log("  - 予定・項目・メモ・EditRecord・メッセージ本文・失敗ログの記録内容など、すべての元データ");
  console.log("  - ユーザーが自分で選んだ・固定した LearnedRule / ChecklistScopeRule（触られた行）");
  console.log("");
  console.log("実行する SQL 文:", statements.length, "件");
  for (const s of statements) console.log("  -", s.split("\n")[0].slice(0, 90));

  if (!EXECUTE) {
    console.log("\ndry-run のみ。実行するには --execute を付けてください。");
    await prisma.$disconnect();
    return;
  }

  // 1) 自動変換の派生行を先に削除する（down SQL が列を消すと判別できなくなるため）。
  await prisma.$executeRawUnsafe(`DELETE FROM "LearnedRule" WHERE "autoConverted" = true`);
  await prisma.$executeRawUnsafe(
    `DELETE FROM "ChecklistScopeRule" WHERE "autoConverted" = true AND "archivedAt" IS NULL`,
  );
  // 2) down SQL（列・テーブルの削除）。
  for (const stmt of statements) {
    await prisma.$executeRawUnsafe(stmt);
  }
  console.log("\n完了: 自動変換の派生行を削除し、down SQL を適用しました。");
  await prisma.$disconnect();
}

async function safeCount(prisma, table, where) {
  try {
    const rows = await prisma.$queryRawUnsafe(
      `select count(*)::int as c from "${table}"${where ? ` where ${where}` : ""}`,
    );
    return rows[0]?.c ?? 0;
  } catch {
    return 0;
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
