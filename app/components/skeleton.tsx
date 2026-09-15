// ちらつき防止のためアニメーションなし（静止したプレースホルダー）。
// animate-pulse は明滅して見えると不評だったため使わない（今後の骨組みも同様に）。
export function PageSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="space-y-4" aria-hidden>
      <div className="h-7 w-40 rounded bg-surface-muted" />
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="h-20 rounded-2xl bg-surface-muted" />
      ))}
    </div>
  );
}
