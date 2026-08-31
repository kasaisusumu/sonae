import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { getSavingsSummary, getFailureRetrospective } from "@/lib/savings";
import { formatYen } from "@/lib/format";

export default async function SavingsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/");

  const [s, retro] = await Promise.all([
    getSavingsSummary(user.id),
    getFailureRetrospective(user.id),
  ]);
  const maxMonthly = Math.max(1, ...s.monthly.map((m) => m.amountYen));
  const maxCategory = Math.max(1, ...s.byCategory.map((c) => c.amountYen));

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-xl font-semibold">節約額ダッシュボード</h1>
        <p className="mt-1 text-sm text-muted">
          失敗ログのうち「これは防げた」と確認したものの推定損失額を積み上げています。
        </p>
      </div>

      <section className="rounded-2xl bg-teal-soft px-6 py-6">
        <p className="text-sm text-teal-dark">今月の推定節約額（参考値）</p>
        <p className="mt-1 text-5xl font-bold text-teal-dark">
          {formatYen(s.thisMonthYen)}
        </p>
        <p className="mt-3 text-sm text-teal-dark/80">
          累計 {formatYen(s.totalYen)} ・ {s.entryCount} 件
        </p>
        <p className="mt-3 text-xs text-muted">
          ※ これは<strong>推定値</strong>です。断定ではありません。
          推定ロジック: あなたが記録した失敗の「推定損失額」のうち、同じカテゴリの予定で「防げた」と自己申告したものを合計しています。実際に防げたかどうかの自動判定は行っていません。
        </p>

        {s.thisMonthItems.length > 0 && (
          <div className="mt-4 rounded-xl bg-surface/70 p-4">
            <p className="text-xs font-semibold text-teal-dark">
              今月防げたこと
            </p>
            <ul className="mt-2 space-y-1 text-sm text-teal-dark/90">
              {s.thisMonthItems.map((it, i) => (
                <li key={i} className="flex items-baseline justify-between gap-3">
                  <span className="min-w-0 truncate">
                    ・{it.description}
                    {it.eventTitle ? (
                      <span className="text-teal-dark/60">
                        {" "}
                        （{it.eventTitle}）
                      </span>
                    ) : null}
                  </span>
                  <span className="shrink-0 tabular-nums">
                    {it.amountYen > 0 ? formatYen(it.amountYen) : "±0"}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      {s.entryCount === 0 ? (
        <p className="rounded-xl bg-surface px-4 py-8 text-center text-sm text-muted">
          まだ計上はありません。
          <br />
          <Link href="/failures" className="no-underline">
            失敗ログ
          </Link>
          を記録し、同じカテゴリの予定で「これは防げた」を押すとここに積み上がります。
        </p>
      ) : (
        <>
          <section className="rounded-2xl bg-surface p-5">
            <h2 className="text-sm font-semibold text-muted">月ごとの推移（直近6ヶ月・参考値）</h2>
            <div className="mt-4 flex items-end gap-2" style={{ height: 140 }}>
              {s.monthly.map((m) => (
                <div key={m.key} className="flex flex-1 flex-col items-center gap-1">
                  <span className="text-[10px] text-muted">
                    {m.amountYen > 0 ? formatYen(m.amountYen) : ""}
                  </span>
                  <div
                    className="w-full rounded-t bg-teal"
                    style={{
                      height: `${Math.round((m.amountYen / maxMonthly) * 110)}px`,
                      minHeight: m.amountYen > 0 ? 4 : 1,
                      opacity: m.amountYen > 0 ? 1 : 0.25,
                    }}
                  />
                  <span className="text-xs text-muted">{m.label}</span>
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-2xl bg-surface p-5">
            <h2 className="text-sm font-semibold text-muted">カテゴリ別の内訳（参考値）</h2>
            <ul className="mt-4 space-y-3">
              {s.byCategory.map((c) => (
                <li key={c.categoryName}>
                  <div className="flex items-baseline justify-between text-sm">
                    <span>{c.categoryName}</span>
                    <span className="text-muted">
                      {formatYen(c.amountYen)}（{c.count}件）
                    </span>
                  </div>
                  <div className="mt-1 h-2 rounded-full bg-surface-muted">
                    <div
                      className="h-2 rounded-full bg-accent"
                      style={{ width: `${(c.amountYen / maxCategory) * 100}%` }}
                    />
                  </div>
                </li>
              ))}
            </ul>
          </section>

          <section className="rounded-2xl bg-surface p-5">
            <h2 className="text-sm font-semibold text-muted">最近の計上</h2>
            <ul className="mt-3 divide-y divide-border">
              {s.recent.map((r) => (
                <li key={r.id} className="flex items-start justify-between gap-3 py-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm">{r.description}</p>
                    <p className="text-xs text-muted">
                      {r.categoryName}
                      {r.eventTitle ? ` ・ ${r.eventTitle}` : ""} ・{" "}
                      {r.createdAt.toLocaleDateString("ja-JP")}
                    </p>
                  </div>
                  <span className="shrink-0 text-sm text-teal-dark">
                    {formatYen(r.amountYen)}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        </>
      )}

      {retro.totalCount > 0 && (
        <section className="rounded-2xl bg-surface p-5">
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="text-sm font-semibold text-muted">
              これまでの失敗ログの振り返り
            </h2>
            <Link
              href="/failures"
              className="text-xs text-muted underline hover:text-foreground"
            >
              失敗ログを開く
            </Link>
          </div>
          <p className="mt-1 text-xs text-muted">
            責めるためではありません。溜まった記録を見返して、次に先回りするための場所です。
          </p>
          <p className="mt-3 text-sm">
            合計 <strong>{retro.totalCount}件</strong>
            {retro.totalEstimatedLossYen > 0 && (
              <>
                {" "}
                ・ 推定損失の累計 {formatYen(retro.totalEstimatedLossYen)}
              </>
            )}
            {retro.preventedTotal > 0 && (
              <>
                {" "}
                ・ うち「防げた」{retro.preventedTotal}回
              </>
            )}
          </p>

          <div className="mt-4 space-y-3">
            {retro.byCategory.map((c) => (
              <details
                key={c.categoryName}
                className="rounded-xl bg-background p-3 [&_summary::-webkit-details-marker]:hidden"
              >
                <summary className="flex cursor-pointer list-none items-baseline justify-between gap-3 text-sm">
                  <span className="font-medium">{c.categoryName}</span>
                  <span className="text-xs text-muted">
                    {c.count}件
                    {c.estimatedLossYen > 0
                      ? ` ・ 推定 ${formatYen(c.estimatedLossYen)}`
                      : ""}{" "}
                    ・ 直近 {c.lastOccurredAt.toLocaleDateString("ja-JP")}
                  </span>
                </summary>
                <ul className="mt-2 divide-y divide-border">
                  {c.items.slice(0, 8).map((it) => (
                    <li
                      key={it.id}
                      className="flex items-start justify-between gap-3 py-2"
                    >
                      <div className="min-w-0">
                        <p className="whitespace-pre-wrap text-sm">
                          {it.description}
                        </p>
                        <p className="text-[11px] text-muted">
                          {it.occurredAt.toLocaleDateString("ja-JP")}
                          {it.eventTitle ? ` ・ 「${it.eventTitle}」` : ""}
                          {it.preventedTimes > 0
                            ? ` ・ 防げた ${it.preventedTimes}回`
                            : ""}
                        </p>
                      </div>
                      {it.estimatedLossYen > 0 && (
                        <span className="shrink-0 text-xs text-muted tabular-nums">
                          {formatYen(it.estimatedLossYen)}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
                {c.items.length > 8 && (
                  <p className="mt-2 text-[11px] text-muted">
                    ほか {c.items.length - 8} 件（
                    <Link href="/failures" className="underline">
                      失敗ログ
                    </Link>
                    で全部見られます）
                  </p>
                )}
              </details>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
