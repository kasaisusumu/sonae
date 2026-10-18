import { getGrowthStats } from "@/lib/growth-stats";

/** ホームに表示する「そなえさんの成長」カード（テスト版の主役）。 */
export async function GrowthDashboard({ userId }: { userId: string }) {
  const s = await getGrowthStats(userId);

  const tiles: { label: string; value: number; unit: string }[] = [
    { label: "学習した項目数", value: s.learnedItemCount, unit: "個" },
    { label: "学習した予定数", value: s.learnedEventCount, unit: "件" },
    { label: "完了したタスク数", value: s.completedTaskCount, unit: "件" },
    { label: "見つけた共通パターン", value: s.commonPatternCount, unit: "個" },
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

      <div className="grid grid-cols-2 gap-3">
        {tiles.map((t) => (
          <div key={t.label} className="rounded-xl bg-surface-muted p-4">
            <p className="text-xs text-muted">{t.label}</p>
            <p className="mt-1 text-2xl font-bold text-chart-count">
              {t.value}
              <span className="ml-0.5 text-xs font-normal text-muted">
                {t.unit}
              </span>
            </p>
          </div>
        ))}
      </div>

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
