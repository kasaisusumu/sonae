/** 学習ページは集計が重めなので、控えめな読み込み表示だけ出す（全面スケルトンは出さない）。 */
export default function Loading() {
  return (
    <div className="space-y-4" aria-hidden>
      <div className="h-6 w-28 rounded bg-surface-muted" />
      <div className="h-10 rounded-xl bg-surface-muted" />
      <p className="pt-2 text-xs text-muted">学習内容を読み込んでいます…</p>
    </div>
  );
}
