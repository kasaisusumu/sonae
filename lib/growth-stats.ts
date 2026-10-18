import { prisma } from "@/lib/prisma";

export interface GrowthStats {
  /** 学習した項目数（本番版 LearnedRule ＋ テスト版 ChecklistScopeRule の合計）。 */
  learnedItemCount: number;
  /** 学習が紐づく予定の種類数（LearnedRule はカテゴリ単位、ChecklistScopeRule は予定名単位）。 */
  learnedEventCount: number;
  /** 完了した準備項目の累計（提案のまま未確認のものは含めない）。 */
  completedTaskCount: number;
  /** 複数回・複数の予定で確認できた「共通パターン」の数。 */
  commonPatternCount: number;
  /** 直近で新しく学習した項目名（無ければ null）。 */
  recentLearned: { title: string; at: Date } | null;
}

/**
 * ホーム画面「そなえさんの成長」カード用の集計。
 * モード（ver1/ver2）を問わず、両方の学習テーブルを合算する
 * （ユーザー指摘により2026-10-19：過去にどちらのモードで学習した分も成長として見せたいため）。
 */
export async function getGrowthStats(userId: string): Promise<GrowthStats> {
  const [
    learnedRules,
    scopeRules,
    completedTaskCount,
    recentLearnedRule,
    recentScopeRule,
  ] = await Promise.all([
    prisma.learnedRule.findMany({
      where: { category: { userId } },
      select: { categoryId: true, confirmedCount: true },
    }),
    prisma.checklistScopeRule.findMany({
      where: { userId, archivedAt: null },
      select: { normTitle: true, scope: true },
    }),
    prisma.checklistItem.count({
      where: { isDone: true, isSuggested: false, event: { userId } },
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

  const learnedEventCount =
    new Set(learnedRules.map((r) => r.categoryId)).size +
    new Set(scopeRules.map((r) => r.normTitle)).size;

  // 「共通パターン」＝1回きりでなく、複数回・複数の予定で裏付けが取れた学習
  // （LearnedRule は confirmedCount>=2、ChecklistScopeRule は予定横断で効く
  // scope="similar"/"genre" を対象にする。event_only は1予定限定なので対象外）。
  const commonPatternCount =
    learnedRules.filter((r) => r.confirmedCount >= 2).length +
    scopeRules.filter((r) => r.scope === "similar" || r.scope === "genre").length;

  return {
    learnedItemCount,
    learnedEventCount,
    completedTaskCount,
    commonPatternCount,
    recentLearned,
  };
}
