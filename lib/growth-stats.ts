import { prisma } from "@/lib/prisma";
import { describeScopeRule } from "@/lib/item-scope";

export interface GrowthDetailItem {
  title: string;
  detail: string;
}

export interface GrowthStats {
  /** 学習した項目数（本番版 LearnedRule ＋ テスト版 ChecklistScopeRule の合計）。 */
  learnedItemCount: number;
  /** 学習が紐づく予定の種類数（LearnedRule はカテゴリ単位、ChecklistScopeRule は元になった予定名単位）。 */
  learnedEventCount: number;
  /** 完了した準備項目の累計（提案のまま未確認のものは含めない）。 */
  completedTaskCount: number;
  /** 複数回・複数の予定で確認できた「共通パターン」の数。 */
  commonPatternCount: number;
  /** 直近で新しく学習した項目名（無ければ null）。 */
  recentLearned: { title: string; at: Date } | null;
  /** 4つのタイル詳細（ホームでタップしたときの一覧。多すぎる場合は上限件数まで）。 */
  learnedItems: GrowthDetailItem[];
  learnedEvents: GrowthDetailItem[];
  completedTasks: GrowthDetailItem[];
  commonPatterns: GrowthDetailItem[];
}

const DETAIL_LIMIT = 50;

const RULE_TYPE_LABEL: Record<string, string> = {
  exclude_item: "出さない",
  fixed_item: "出す",
  timing_override: "タイミングを調整",
  notify_override: "通知を調整",
  pattern_item: "カテゴリ横断の候補",
};

/**
 * ホーム画面「そなえさんの成長」カード用の集計と、タップ時の詳細一覧。
 * モード（ver1/ver2）を問わず、両方の学習テーブルを合算する
 * （ユーザー指摘により2026-10-19：過去にどちらのモードで学習した分も成長として見せたいため）。
 */
export async function getGrowthStats(userId: string): Promise<GrowthStats> {
  const [
    learnedRules,
    scopeRules,
    completedTaskCount,
    recentCompletedTasks,
    recentLearnedRule,
    recentScopeRule,
  ] = await Promise.all([
    prisma.learnedRule.findMany({
      where: { category: { userId } },
      include: { category: { select: { name: true } } },
      orderBy: { createdAt: "desc" },
    }),
    prisma.checklistScopeRule.findMany({
      where: { userId, archivedAt: null },
      orderBy: { createdAt: "desc" },
    }),
    prisma.checklistItem.count({
      where: { isDone: true, isSuggested: false, event: { userId } },
    }),
    prisma.checklistItem.findMany({
      where: { isDone: true, isSuggested: false, event: { userId } },
      orderBy: { createdAt: "desc" },
      take: DETAIL_LIMIT,
      select: { title: true, createdAt: true, event: { select: { title: true } } },
    }),
    prisma.learnedRule.findFirst({
      where: { category: { userId } },
      orderBy: { createdAt: "desc" },
      select: { target: true, createdAt: true },
    }),
    prisma.checklistScopeRule.findFirst({
      where: { userId, archivedAt: null },
      orderBy: { createdAt: "desc" },
      select: { title: true, createdAt: true },
    }),
  ]);

  const recentLearned = [
    recentLearnedRule && { title: recentLearnedRule.target, at: recentLearnedRule.createdAt },
    recentScopeRule && { title: recentScopeRule.title, at: recentScopeRule.createdAt },
  ]
    .filter((r): r is { title: string; at: Date } => !!r)
    .sort((a, b) => b.at.getTime() - a.at.getTime())[0] ?? null;

  const learnedItemCount = learnedRules.length + scopeRules.length;

  // 「学習した予定数」＝学習の元になった予定の種類数。LearnedRule はカテゴリ単位、
  // ChecklistScopeRule は元になった予定名（sourceEventTitle）単位で数える
  // （項目名ではなく、どの予定から学んだかを見るほうが「予定数」の実態に近い）。
  const learnedEventCount =
    new Set(learnedRules.map((r) => r.categoryId)).size +
    new Set(
      scopeRules.map((r) => r.sourceEventTitle?.trim()).filter((t): t is string => !!t),
    ).size;

  // 「共通パターン」＝1回きりでなく、複数回・複数の予定で裏付けが取れた学習
  // （LearnedRule は confirmedCount>=2、ChecklistScopeRule は予定横断で効く
  // scope="similar"/"genre" を対象にする。event_only は1予定限定なので対象外）。
  const commonPatternLearnedRules = learnedRules.filter((r) => r.confirmedCount >= 2);
  const commonPatternScopeRules = scopeRules.filter(
    (r) => r.scope === "similar" || r.scope === "genre",
  );
  const commonPatternCount =
    commonPatternLearnedRules.length + commonPatternScopeRules.length;

  const learnedItems: GrowthDetailItem[] = [
    ...learnedRules.map((r) => ({
      title: r.target,
      detail: `${r.category.name} ・ ${RULE_TYPE_LABEL[r.ruleType] ?? r.ruleType}（本番版）`,
    })),
    ...scopeRules.map((r) => ({
      title: r.title,
      detail: `${describeScopeRule(r)}（テスト版）`,
    })),
  ]
    .sort((a, b) => a.title.localeCompare(b.title, "ja"))
    .slice(0, DETAIL_LIMIT);

  const learnedEvents: GrowthDetailItem[] = [
    ...[...new Set(learnedRules.map((r) => r.categoryId))].map((cid) => {
      const r = learnedRules.find((x) => x.categoryId === cid)!;
      const count = learnedRules.filter((x) => x.categoryId === cid).length;
      return { title: r.category.name, detail: `学習した項目 ${count}件（本番版）` };
    }),
    ...[...new Set(scopeRules.map((r) => r.sourceEventTitle?.trim()).filter((t): t is string => !!t))].map(
      (title) => {
        const count = scopeRules.filter((r) => r.sourceEventTitle?.trim() === title).length;
        return { title, detail: `学習した項目 ${count}件（テスト版）` };
      },
    ),
  ].slice(0, DETAIL_LIMIT);

  const completedTasks: GrowthDetailItem[] = recentCompletedTasks.map((t) => ({
    title: t.title,
    detail: t.event.title,
  }));

  const commonPatterns: GrowthDetailItem[] = [
    ...commonPatternLearnedRules.map((r) => ({
      title: r.target,
      detail: `${r.category.name} ・ ${r.confirmedCount}回確認（本番版）`,
    })),
    ...commonPatternScopeRules.map((r) => ({
      title: r.title,
      detail: `${describeScopeRule(r)}（テスト版）`,
    })),
  ].slice(0, DETAIL_LIMIT);

  return {
    learnedItemCount,
    learnedEventCount,
    completedTaskCount,
    commonPatternCount,
    recentLearned,
    learnedItems,
    learnedEvents,
    completedTasks,
    commonPatterns,
  };
}
