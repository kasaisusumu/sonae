/**
 * 機能モード切替（lib/feature-mode.ts）のための、学習結果の自動変換。
 *
 * 対応関係（変換表。詳しくは docs/機能仕様_エンジニア向け.md §13 参照）:
 * - LearnedRule（本番版の学習エンジン）の ruleType="exclude_item"/"fixed_item" は、
 *   ChecklistScopeRule（テスト版）の scope="genre"（カテゴリ一致）と相互に変換できる。
 * - ChecklistScopeRule の scope="keyword"/"similar" は、カテゴリに基づかない一致条件
 *   （キーワード・AIの言い換え語）なので、LearnedRule（カテゴリ単位）には変換できない
 *   → 休眠（本番版モードでは使われないだけで、データは消えない。テスト版に戻せば復帰する）。
 * - LearnedRule の ruleType="timing_override"/"notify_override"/"pattern_item" は、
 *   項目を出す/出さないの範囲の話ではないので、どちらの方向でも変換対象外 → 常に休眠。
 *
 * 変換は毎回「全部」を無条件に反映する（2026-10-19〜。以前は切替先に既存の
 * 学習があると上書きしない「触られた分は除く」仕様だったが、ユーザー指摘
 * 「触ってないだけってどういう意味? 普通に全部引き継いでくれ」によりこの
 * 保護を撤廃した。切替元の内容が常に優先される）。
 * 変換は冪等（同じ内容なら何度実行しても結果は同じ）・非破壊（元データは消さない）。
 * AI は呼ばない（ルールベースのみ）。
 */
import { prisma } from "@/lib/prisma";
import { normTitle, extractKeywords } from "@/lib/text-norm";
import { stringifyStrArray } from "@/lib/future-messages";

export interface ConversionResult {
  converted: number;
  dormant: number;
}

/**
 * スイッチ先が production のとき: test 版の ChecklistScopeRule から
 * LearnedRule を作る/更新する（本番版の自動学習エンジンに反映する）。
 */
export async function convertScopeRulesToLearnedRules(
  userId: string,
): Promise<ConversionResult> {
  const rules = await prisma.checklistScopeRule.findMany({
    where: { userId, archivedAt: null },
  });

  // categoryIds は実カテゴリへの外部キーではない JSON 文字列なので、カテゴリ削除で
  // 自動的には掃除されない（ChecklistScopeRule 自体は残る）。変換先の LearnedRule は
  // 本物の外部キーを持つため、存在しないカテゴリを参照する行はここで休眠にする
  // （convertLearnedRulesToScopeRules 側と同じ防御。無いとここで例外になり切替全体が失敗する）。
  const existingCategoryIds = new Set(
    (await prisma.category.findMany({ where: { userId }, select: { id: true } })).map(
      (c) => c.id,
    ),
  );

  let converted = 0;
  let dormant = 0;

  for (const rule of rules) {
    if (rule.scope !== "genre") {
      // keyword / similar はカテゴリに基づかないため LearnedRule に変換できない（休眠）。
      dormant++;
      continue;
    }
    const categoryIds = parseIds(rule.categoryIds);
    const categoryId = categoryIds[0];
    if (!categoryId || !existingCategoryIds.has(categoryId)) {
      dormant++;
      continue;
    }
    const ruleType = rule.action === "exclude" ? "exclude_item" : "fixed_item";
    const target = rule.title;
    const itemKind = rule.kind;
    const featureSignature = "{}";

    await prisma.learnedRule.upsert({
      where: {
        categoryId_itemKind_ruleType_target_featureSignature: {
          categoryId,
          itemKind,
          ruleType,
          target,
          featureSignature,
        },
      },
      create: {
        categoryId,
        itemKind,
        ruleType,
        target,
        featureSignature,
        autoConverted: true,
        convertedFromScopeRuleId: rule.id,
      },
      update: {
        autoConverted: true,
        convertedFromScopeRuleId: rule.id,
      },
    });
    converted++;
  }

  return { converted, dormant };
}

/**
 * スイッチ先が test のとき: 本番版の LearnedRule から ChecklistScopeRule を
 * 作る/更新する（テスト版の範囲つきルールに反映する）。
 */
export async function convertLearnedRulesToScopeRules(
  userId: string,
): Promise<ConversionResult> {
  const categories = await prisma.category.findMany({
    where: { userId },
    select: { id: true, name: true },
  });
  const categoryIds = new Set(categories.map((c) => c.id));
  const categoryName = new Map(categories.map((c) => [c.id, c.name]));

  const rules = await prisma.learnedRule.findMany({
    where: { categoryId: { in: [...categoryIds] } },
  });

  let converted = 0;
  let dormant = 0;

  for (const rule of rules) {
    if (rule.ruleType !== "exclude_item" && rule.ruleType !== "fixed_item") {
      // timing_override / notify_override / pattern_item は範囲ルールの対象外（休眠）。
      dormant++;
      continue;
    }
    const action = rule.ruleType === "exclude_item" ? "exclude" : "include";
    const kind = rule.itemKind;
    const nt = normTitle(rule.target);
    const genre = categoryName.get(rule.categoryId) ?? "カテゴリ";

    const existing = await prisma.checklistScopeRule.findFirst({
      where: { userId, kind, normTitle: nt, action, archivedAt: null },
      orderBy: { updatedAt: "desc" },
    });

    const data = {
      userId,
      action,
      kind,
      normTitle: nt,
      title: rule.target,
      scope: "genre",
      genres: stringifyStrArray([genre]),
      genreKeywords: "[]",
      keywords: "[]",
      categoryIds: stringifyStrArray([rule.categoryId]),
      signature: null,
      reason: "本番版の学習から自動で反映しました",
      autoConverted: true,
      convertedFromLearnedRuleId: rule.id,
    };

    // この項目名に対して他に残っているアクティブなルール（例えばユーザーが別の予定で
    // 明示的に選んだ「この名前」）があれば archive する（ユーザー指摘により2026-10-20:
    // 変換で作った「genre」ルールと、ユーザーが選んだ「keyword」ルールが両方アクティブに
    // 残り、新しい予定の判定でどちらが当たるか不安定になっていた＝「勝手に似た予定に
    // 変わる」ように見える不具合があった）。切替元（本番版）の内容を優先する方針のため、
    // ここでは existing 以外の同名ルールも含めて置き換える。
    await prisma.checklistScopeRule.updateMany({
      where: {
        userId,
        kind,
        normTitle: nt,
        action,
        archivedAt: null,
        ...(existing ? { id: { not: existing.id } } : {}),
      },
      data: { archivedAt: new Date() },
    });

    if (existing) {
      await prisma.checklistScopeRule.update({ where: { id: existing.id }, data });
    } else {
      await prisma.checklistScopeRule.create({ data });
    }
    converted++;
  }

  return { converted, dormant };
}

function parseIds(raw: string): string[] {
  try {
    const a = JSON.parse(raw);
    return Array.isArray(a) ? a.map((x) => String(x)) : [];
  } catch {
    return [];
  }
}

/**
 * ver1→ver2 切替時、三択がまだ決まっていない項目（EventChecklistScope が無い＝
 * 画面では「この名前」として表示される項目）に、キーワードを自動で設定する
 * （ユーザー指摘により2026-10-20:「キーワード抽出はAIじゃないんだから、バージョン2に
 * 変える時に、三択が定まってない予定（＝この名前）はキーワードも自動抽出して設定して」）。
 * キーワードは予定名を分解した複数語（`lib/text-norm.ts` の `extractKeywords`、AND判定）。
 * AI は呼ばない。
 * 項目名（kind+normTitle）が同じなら1つのルールにまとめ、代表の予定名は
 * その項目名の中で最も新しい予定のものを使う。
 */
export async function backfillKeywordScopesOnModeSwitch(
  userId: string,
): Promise<{ created: number }> {
  const [items, existingScopes] = await Promise.all([
    prisma.checklistItem.findMany({
      where: { event: { userId }, isSuggested: false },
      orderBy: { event: { eventDatetime: "desc" } },
      select: {
        kind: true,
        title: true,
        eventId: true,
        event: { select: { title: true } },
      },
    }),
    prisma.eventChecklistScope.findMany({
      where: { userId, action: "include", status: { not: "dropped" } },
      select: { eventId: true, kind: true, normTitle: true },
    }),
  ]);

  const decided = new Set(
    existingScopes.map((s) => `${s.eventId}:${s.kind}:${s.normTitle}`),
  );

  // items は予定日の新しい順。項目名（kind:normTitle）ごとに最初に出てきたもの
  // （＝最新の予定）の予定名を、その項目名の代表キーワード元として使う。
  const representativeTitle = new Map<string, string>();
  const targets: {
    eventId: string;
    kind: string;
    title: string;
    normTitle: string;
  }[] = [];
  for (const it of items) {
    const nt = normTitle(it.title);
    if (!nt) continue;
    const eventKey = `${it.eventId}:${it.kind}:${nt}`;
    if (decided.has(eventKey)) continue;
    const ruleKey = `${it.kind}:${nt}`;
    if (!representativeTitle.has(ruleKey)) {
      representativeTitle.set(ruleKey, it.event.title);
    }
    targets.push({ eventId: it.eventId, kind: it.kind, title: it.title, normTitle: nt });
  }

  let created = 0;
  const ruleIdByKey = new Map<string, string>();
  for (const t of targets) {
    const ruleKey = `${t.kind}:${t.normTitle}`;
    let ruleId = ruleIdByKey.get(ruleKey);
    if (!ruleId) {
      const existingRule = await prisma.checklistScopeRule.findFirst({
        where: {
          userId,
          kind: t.kind,
          normTitle: t.normTitle,
          action: "include",
          archivedAt: null,
        },
        orderBy: { updatedAt: "desc" },
      });
      if (existingRule) {
        ruleId = existingRule.id;
      } else {
        const eventTitle = representativeTitle.get(ruleKey) ?? t.title;
        const kws = extractKeywords(eventTitle);
        const rule = await prisma.checklistScopeRule.create({
          data: {
            userId,
            action: "include",
            kind: t.kind,
            normTitle: t.normTitle,
            title: t.title,
            scope: "keyword",
            keywords: stringifyStrArray(kws),
            reason: "バージョン切替時に自動でキーワードを設定しました",
            autoConverted: true,
          },
        });
        ruleId = rule.id;
      }
      ruleIdByKey.set(ruleKey, ruleId);
    }

    await prisma.eventChecklistScope.upsert({
      where: {
        eventId_kind_normTitle: {
          eventId: t.eventId,
          kind: t.kind,
          normTitle: t.normTitle,
        },
      },
      update: {},
      create: {
        userId,
        eventId: t.eventId,
        kind: t.kind,
        normTitle: t.normTitle,
        title: t.title,
        action: "include",
        scope: "keyword",
        ruleId,
        reason: "バージョン切替時に自動でキーワードを設定しました",
        source: "default",
        status: "chosen",
      },
    });
    created++;
  }

  return { created };
}
