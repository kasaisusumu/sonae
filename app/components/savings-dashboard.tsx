import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { getSavingsSummary, getFailureRetrospective } from "@/lib/savings";
import { formatDateOnly, formatYen } from "@/lib/format";
import { setFailureOutcome, updateFailureAmount } from "@/app/actions";
import { PreventedChart } from "@/app/components/prevented-chart";
import { MonthlyPreventedPopup } from "@/app/components/monthly-prevented-popup";
import { type FRRow } from "@/app/components/failure-review-row";
import { ConfirmButton } from "@/app/components/confirm-button";

/** その Date が（JST 暦で）今月かどうか。 */
function isThisJstMonth(d: Date, now: Date): boolean {
  const f = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
  });
  return f.format(d) === f.format(now);
}

/** ホームに表示する節約額ダッシュボード。防げたことも並べる。 */
export async function SavingsDashboard({ userId }: { userId: string }) {
  const [s, retro, recentLogs] = await Promise.all([
    getSavingsSummary(userId),
    getFailureRetrospective(userId),
    // ポップアップを「結果を変えても消えない」ようにするため、今月ぶんは結果に
    // かかわらず渡す（新しい順）。件数は多くならない想定なので take で軽く上限。
    prisma.failureLog.findMany({
      where: { userId },
      orderBy: { occurredAt: "desc" },
      take: 300,
      select: {
        id: true,
        description: true,
        occurredAt: true,
        estimatedLossYen: true,
        outcome: true,
        category: { select: { name: true } },
        event: { select: { title: true } },
      },
    }),
  ]);
  const maxCategory = Math.max(1, ...s.byCategory.map((c) => c.amountYen));

  const now = new Date();
  const thisMonthRows: FRRow[] = recentLogs
    .filter((l) => isThisJstMonth(l.occurredAt, now))
    .map((l) => ({
      id: l.id,
      description: l.description,
      occurredAt: l.occurredAt,
      estimatedLossYen: l.estimatedLossYen,
      outcome: l.outcome,
      categoryName: l.category?.name ?? null,
      eventTitle: l.event?.title ?? null,
    }));

  // まだ「防げた」記録が無いあいだは、金額欄に「例」を出す。
  // 本物の記録が1件でも入ったら hasAny が true になり、例は自動で消える。
  const hasAny = s.entryCount > 0;
  const EXAMPLE_YEN = 800; // 表示専用のダミー。DB・集計には一切入らない。

  return (
    <section className="space-y-3">
      <div className="flex items-baseline justify-between">
        <h2 className="text-lg font-semibold">うっかり、いくら防げた？</h2>
        <Link
          href="/failures"
          className="text-xs text-muted no-underline hover:text-foreground"
        >
          失敗ログ →
        </Link>
      </div>

      {/* このページの主役。白黒ベースなので、濃い面で反転させて目立たせる。 */}
      <div className="rounded-2xl bg-foreground px-6 py-6 text-surface">
        {hasAny ? (
          <>
            <p className="text-sm text-surface/70">今月、防げた分（推定）</p>
            <p className="mt-1 text-4xl font-bold">{formatYen(s.thisMonthYen)}</p>
            <p className="mt-1.5 text-xs text-surface/70">
              防げたうっかり {retro.totalCount} 件 ・ 累計 {formatYen(s.totalYen)}
            </p>
          </>
        ) : (
          <>
            <div className="flex items-center gap-2">
              <p className="text-sm text-surface/70">今月、防げた分（推定）</p>
              <span className="rounded border border-surface/40 px-1.5 py-0.5 text-[10px] font-semibold text-surface/80">
                例
              </span>
            </div>
            <p className="mt-1 text-4xl font-bold">{formatYen(EXAMPLE_YEN)}</p>
            <p className="mt-1.5 text-xs text-surface/65">
              これは<strong className="text-surface">例</strong>。1件記録すると本物の数字に変わります。
            </p>
          </>
        )}

        {/* 仕組みを 3 ステップで一目に */}
        <ol className="mt-4 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-surface/75">
          <li className="rounded-full bg-surface/12 px-2 py-0.5">
            ① うっかりを一言記録
          </li>
          <li aria-hidden>→</li>
          <li className="rounded-full bg-surface/12 px-2 py-0.5">
            ② 予定のあと「防げた？」に回答
          </li>
          <li aria-hidden>→</li>
          <li className="rounded-full bg-surface/12 px-2 py-0.5">
            ③ 防げた分がここに貯まる
          </li>
        </ol>

        {hasAny && thisMonthRows.length > 0 && (
          <MonthlyPreventedPopup rows={thisMonthRows} />
        )}

        <Link
          href="/failures"
          className="mt-4 inline-flex items-center justify-center rounded-lg bg-surface px-4 py-2 text-sm font-semibold text-foreground no-underline hover:opacity-90"
        >
          {hasAny ? "うっかりを記録する →" : "さっそく1つ記録してみる →"}
        </Link>

        <p className="mt-3 text-[11px] text-surface/55">
          ※ すべて<strong>推定値</strong>（「防げた」と選んだ損失額の合計・自動判定なし）
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
                              <ConfirmButton
                                message="「防げた」の計上を取り消しますか？（節約額から外れます）"
                                className="text-muted underline hover:text-foreground"
                              >
                                取り消す
                              </ConfirmButton>
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
                              <ConfirmButton
                                message="「防げなかった」に変更しますか？（節約額から外れます）"
                                className="text-muted underline hover:text-warn"
                              >
                                防げなかったに変更
                              </ConfirmButton>
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
                              <ConfirmButton
                                message="「今回は関係ない」に変更しますか？（節約額から外れます）"
                                className="text-muted underline hover:text-foreground"
                              >
                                今回は関係ない
                              </ConfirmButton>
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
