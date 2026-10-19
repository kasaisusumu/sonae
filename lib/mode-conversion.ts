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
import { normTitle } from "@/lib/text-norm";
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
      where: { userId, kind, normTitle: nt, archivedAt: null },
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
