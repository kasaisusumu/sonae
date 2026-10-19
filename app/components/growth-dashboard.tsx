import { getGrowthStats } from "@/lib/growth-stats";
import { GrowthTiles } from "@/app/components/growth-tiles";

/** ホームに表示する「そなえさんの成長」カード（テスト版の主役）。タイルはタップで内訳を見られる。 */
export async function GrowthDashboard({ userId }: { userId: string }) {
  const s = await getGrowthStats(userId);

  const tiles = [
    { label: "学習した項目数", value: s.learnedItemCount, unit: "個", items: s.learnedItems },
    { label: "学習した予定数", value: s.learnedEventCount, unit: "件", items: s.learnedEvents },
    { label: "完了したタスク数", value: s.completedTaskCount, unit: "件", items: s.completedTasks },
    { label: "見つけた共通パターン", value: s.commonPatternCount, unit: "個", items: s.commonPatterns },
  ];

  return (
    <section className="space-y-3 rounded-2xl bg-surface p-5">
      <div className="flex items-start gap-2">
        <span aria-hidden className="text-xl">
          🌱
        </span>
        <div>
          <h2 className="text-lg font-semibold">そなえさんの成長</h2>
          <p className="text-xs text-muted">
            あなたと過ごす中で、少しずつ学んでいます。
          </p>
        </div>
      </div>

      <GrowthTiles tiles={tiles} />

      {s.recentLearned && (
        <div className="flex items-start gap-2 border-t border-border pt-3">
          <span aria-hidden className="text-base">
            ✨
          </span>
          <div className="min-w-0">
            <p className="text-xs font-semibold text-teal-dark">最近の成長</p>
            <p className="truncate text-xs text-muted">
              「{s.recentLearned.title}」を覚えました
            </p>
          </div>
        </div>
      )}
    </section>
  );
}
