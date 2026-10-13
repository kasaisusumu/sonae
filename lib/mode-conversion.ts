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
 * 「触られた」の判定:
 * - LearnedRule: `isUserLocked === true`（既存の「学習内容の確認」での固定フラグをそのまま使う）。
 * - ChecklistScopeRule: `autoConverted === false`（自動変換で作った行ではない＝ユーザーの
 *   選択やAI推奨から通常の経路でできた、テスト版自身の学習結果）。
 *
 * 変換は冪等（`autoConverted` 行は上書き、他は作り直さない）・非破壊（元データは消さない）。
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
    if (!categoryId) {
      dormant++;
      continue;
    }
    const ruleType = rule.action === "exclude" ? "exclude_item" : "fixed_item";
    const target = rule.title;
    const itemKind = rule.kind;
    const featureSignature = "{}";

    const existing = await prisma.learnedRule.findUnique({
      where: {
        categoryId_itemKind_ruleType_target_featureSignature: {
          categoryId,
          itemKind,
          ruleType,
          target,
          featureSignature,
        },
      },
    });

    if (existing && (existing.isUserLocked || !existing.autoConverted)) {
      // ユーザーが固定した、または本番版で独自に育った行（触られたもの）は上書きしない。
      dormant++;
      continue;
    }

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

    // 「触られた」= autoConverted ではない（＝テスト版で独自に選んだ・AIが提案して
    // 選んだ）既存の有効ルールが、同じ項目名・枠にあれば上書きしない。
    const existing = await prisma.checklistScopeRule.findFirst({
      where: { userId, kind, normTitle: nt, archivedAt: null },
      orderBy: { updatedAt: "desc" },
    });
    if (existing && !existing.autoConverted) {
      dormant++;
      continue;
    }

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
