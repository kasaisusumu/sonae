import Link from "next/link";
import { getSavingsSummary, getFailureRetrospective } from "@/lib/savings";
import { formatDateOnly, formatYen } from "@/lib/format";
import { setFailureOutcome, updateFailureAmount } from "@/app/actions";
import { PreventedChart } from "@/app/components/prevented-chart";

/** ホームに表示する節約額ダッシュボード。防げたことも並べる。 */
export async function SavingsDashboard({ userId }: { userId: string }) {
  const [s, retro] = await Promise.all([
    getSavingsSummary(userId),
    getFailureRetrospective(userId),
  ]);
  const maxCategory = Math.max(1, ...s.byCategory.map((c) => c.amountYen));

  return (
    <section className="space-y-3">
      <div className="flex items-baseline justify-between">
        <h2 className="text-lg font-semibold">節約額ダッシュボード</h2>
        <Link
          href="/failures"
          className="text-xs text-muted no-underline hover:text-teal-dark"
        >
          失敗ログ →
        </Link>
      </div>

      <div className="rounded-2xl bg-teal-soft px-6 py-6">
        <p className="text-sm text-teal-dark">今月の推定節約額（参考値）</p>
        <p className="mt-1 text-4xl font-bold text-teal-dark">
          {formatYen(s.thisMonthYen)}
        </p>
        <p className="mt-2 text-xs text-teal-dark/80">
          累計 {formatYen(s.totalYen)} ・ {s.entryCount} 件
        </p>

        {s.thisMonthItems.length > 0 ? (
          <div className="mt-4 rounded-xl bg-surface/70 p-4">
            <p className="text-xs font-semibold text-teal-dark">今月防げたこと</p>
            <ul className="mt-2 space-y-1 text-sm text-teal-dark/90">
              {s.thisMonthItems.map((it, i) => (
                <li key={i} className="flex items-baseline justify-between gap-3">
                  <span className="min-w-0 truncate">
                    ・{it.description}
                    {it.eventTitle ? (
                      <span className="text-teal-dark/60"> （{it.eventTitle}）</span>
                    ) : null}
                  </span>
                  <span className="shrink-0 tabular-nums">
                    {it.amountYen > 0 ? formatYen(it.amountYen) : "±0"}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="mt-3 text-xs text-muted">
            <Link href="/failures" className="underline">
              失敗ログ
            </Link>
            で「防げた」を選ぶと、ここに防げたことと金額が積み上がります。
          </p>
        )}

        <p className="mt-3 text-[11px] text-muted">
          ※ 金額はすべて<strong>推定値</strong>です。あなたが記録した失敗の推定損失額のうち「防げた」と選んだものの合計で、自動判定はしていません。
        </p>
      </div>

      {/* 防げた失敗の推移（金額＋件数の二軸）。常に表示。 */}
      <PreventedChart series={s.series} />

      {(s.entryCount > 0 || retro.totalCount > 0) && (
        <details className="rounded-2xl bg-surface p-4 [&_summary::-webkit-details-marker]:hidden">
          <summary className="cursor-pointer list-none text-sm font-semibold text-teal-dark">
            もっと見る（カテゴリ別・防げた失敗の一覧）
          </summary>

          {s.entryCount > 0 && (
            <>
              <div className="mt-4">
                <h3 className="text-xs font-semibold text-muted">
                  カテゴリ別の内訳（参考値）
                </h3>
                <ul className="mt-3 space-y-3">
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
                          style={{
                            width: `${(c.amountYen / maxCategory) * 100}%`,
                          }}
                        />
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            </>
          )}

          {retro.totalCount > 0 && (
            <div className="mt-5">
              <div className="flex items-baseline justify-between gap-3">
                <h3 className="text-xs font-semibold text-muted">
                  防げた失敗（カテゴリ別）
                </h3>
                <span className="text-[11px] text-muted">
                  防げた {retro.totalCount}件
                  {retro.totalEstimatedLossYen > 0
                    ? ` ・ 回避 累計 ${formatYen(retro.totalEstimatedLossYen)}`
                    : ""}
                </span>
              </div>
              <p className="mt-1 text-[11px] text-muted">
                未選択のものは
                <Link href="/failures" className="underline">
                  失敗ログ
                </Link>
                で「防げた／防げなかった」を選べます。
              </p>
              <div className="mt-3 space-y-2">
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
                          : ""}
                      </span>
                    </summary>
                    <ul className="mt-2 divide-y divide-border">
                      {c.items.slice(0, 8).map((it) => (
                        <li key={it.id} className="py-2">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <p className="whitespace-pre-wrap text-sm">
                                {it.description}
                              </p>
                              <p className="text-[11px] text-muted">
                                {formatDateOnly(it.occurredAt)}
                                {it.eventTitle ? ` ・ 「${it.eventTitle}」` : ""}
                              </p>
                            </div>
                            <span className="shrink-0 text-xs text-teal-dark tabular-nums">
                              {it.estimatedLossYen > 0
                                ? formatYen(it.estimatedLossYen)
                                : "±0"}
                            </span>
                          </div>
                          <div className="mt-1.5 flex flex-wrap items-center gap-3 text-[11px]">
                            <form
                              action={updateFailureAmount}
                              className="flex items-center gap-1"
                            >
                              <input
                                type="hidden"
                                name="failureLogId"
                                value={it.id}
                              />
                              <input
                                type="number"
                                name="estimatedLossYen"
                                min={0}
                                step={100}
                                defaultValue={it.estimatedLossYen || ""}
                                placeholder="円"
                                className="w-20 rounded-md border bg-surface px-2 py-0.5 text-[11px]"
                              />
                              <button
                                type="submit"
                                className="text-teal-dark underline hover:text-foreground"
                              >
                                金額を直す
                              </button>
                            </form>
                            <form action={setFailureOutcome}>
                              <input
                                type="hidden"
                                name="failureLogId"
                                value={it.id}
                              />
                              <input
                                type="hidden"
                                name="outcome"
                                value="unset"
                              />
                              <button
                                type="submit"
                                className="text-muted underline hover:text-foreground"
                              >
                                取り消す
                              </button>
                            </form>
                            <form action={setFailureOutcome}>
                              <input
                                type="hidden"
                                name="failureLogId"
                                value={it.id}
                              />
                              <input
                                type="hidden"
                                name="outcome"
                                value="not_prevented"
                              />
                              <button
                                type="submit"
                                className="text-muted underline hover:text-warn"
                              >
                                防げなかったに変更
                              </button>
                            </form>
                            <form action={setFailureOutcome}>
                              <input
                                type="hidden"
                                name="failureLogId"
                                value={it.id}
                              />
                              <input
                                type="hidden"
                                name="outcome"
                                value="irrelevant"
                              />
                              <button
                                type="submit"
                                className="text-muted underline hover:text-foreground"
                              >
                                今回は関係ない
                              </button>
                            </form>
                          </div>
                        </li>
                      ))}
                    </ul>
                  </details>
                ))}
              </div>
            </div>
          )}
        </details>
      )}
    </section>
  );
}
