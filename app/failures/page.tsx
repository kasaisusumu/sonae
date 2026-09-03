import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { createFailureLog } from "@/app/actions";
import { DEFAULT_CATEGORIES } from "@/lib/categories";
import { formatDateOnly, jstToday } from "@/lib/format";
import { SubmitButton } from "@/app/components/submit-button";
import { InfoHint } from "@/app/components/info-hint";
import {
  FailureReviewRow,
  type FRRow,
} from "@/app/components/failure-review-row";
import { StickyReviewRows } from "@/app/components/sticky-review-rows";
import { FailureQuickInput } from "./failure-quick-input";
import { ReviewQueue, type RQLog } from "./review-queue";

function todayValue(): string {
  return jstToday();
}

type LogRow = {
  id: string;
  description: string;
  occurredAt: Date;
  estimatedLossYen: number;
  outcome: string | null;
  category: { name: string } | null;
  event: {
    title: string;
    eventDatetime: Date;
    endDatetime: Date | null;
  } | null;
};

const toFR = (l: LogRow): FRRow => ({
  id: l.id,
  description: l.description,
  occurredAt: l.occurredAt,
  estimatedLossYen: l.estimatedLossYen,
  outcome: l.outcome,
  categoryName: l.category?.name ?? null,
  eventTitle: l.event?.title ?? null,
});

export default async function FailuresPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/");

  const [categories, logs, events] = await Promise.all([
    prisma.category.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "asc" },
    }),
    prisma.failureLog.findMany({
      where: { userId: user.id },
      orderBy: { occurredAt: "desc" },
      include: {
        category: true,
        event: {
          select: { title: true, eventDatetime: true, endDatetime: true },
        },
      },
    }),
    prisma.event.findMany({
      // 失敗 log は「もう起きたこと」なので、選べるのは過去の予定だけ
      where: { userId: user.id, eventDatetime: { lte: new Date() } },
      orderBy: { eventDatetime: "desc" },
      take: 80,
      select: { id: true, title: true, eventDatetime: true },
    }),
  ]);

  const categoryNames = Array.from(
    new Set([...DEFAULT_CATEGORIES, ...categories.map((c) => c.name)]),
  );
  const now = new Date();
  // 「予定が終わっている」の判定。lib/failures.ts の eventEndedWhere（ナビのドットが
  // 使う Prisma 条件）と必ず同じ意味に保つこと（= (endDatetime ?? eventDatetime) <= now）。
  const eventEnded = (l: (typeof logs)[number]) =>
    !!l.event && (l.event.endDatetime ?? l.event.eventDatetime) <= now;

  // 「結果を記録しよう」に出すのは、本当にその予定に採用（linked）されていて、
  // その予定が過ぎていて、まだ結果が入力されていないものだけ。予定に紐づかない
  // 記録や、採用されなかった提案（outcome=null）は出さない。
  //（決着済み行も渡してスナップショット表示を続ける＝離脱まで消えない）
  const reviewableLogs = logs.filter(
    (l) => !!l.event && eventEnded(l) && l.outcome !== null,
  );
  // 「これまでの記録」の折りたたみ:
  const upcomingPredictions = logs.filter(
    (l) => !!l.event && !eventEnded(l) && l.outcome !== null,
  ); // 採用済み・予定が先
  const pastReviewed = logs.filter(
    (l) =>
      !!l.event &&
      eventEnded(l) &&
      l.outcome !== null &&
      l.outcome !== "linked",
  ); // 予定が終わって結果も決まっている
  const unlinkedLogs = logs.filter((l) => !l.event); // 予定に紐づかない記録（状態問わず）

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">失敗ログ</h1>
        <p className="mt-1 text-sm text-muted">
          うっかりを記録すると、似た予定が発生した時に私が思い出させます。
          <InfoHint>
            責めるための記録ではありません。書くほど先回りの精度が上がります。
          </InfoHint>
        </p>
      </div>

      {/* ── 結果記録待ち（振り返り）。押しても離れるまで消えない。 ── */}
      <ReviewQueue logs={reviewableLogs as RQLog[]} />

      {/* ── 記入：まずは「ひとこと」だけでOK ── */}
      <section
        data-coach="fail-new"
        className="rounded-2xl border border-border bg-surface p-5"
      >
        <h2 className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
          ✍️ ひとこと記録する
          <InfoHint>
            よくあるものはボタンで一発。必須は「何が起きたか」だけ。金額は空なら 0、
            日付は予定を選べばその日になります。あとから直せます。
          </InfoHint>
        </h2>
        <form action={createFailureLog} className="mt-3 space-y-3">
          <FailureQuickInput />

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-xs text-muted">
              どの予定？
              <select
                name="eventId"
                defaultValue=""
                className="mt-1 w-full rounded-lg border bg-background px-3 py-2 text-sm text-foreground"
              >
                <option value="">— 紐づけない（カテゴリ全体の記録）—</option>
                {events.map((e) => (
                  <option key={e.id} value={e.id}>
                    {formatDateOnly(e.eventDatetime)} {e.title}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs text-muted">
              損失額（円・任意）
              <input
                type="number"
                name="estimatedLossYen"
                min={0}
                step={100}
                placeholder="なければ空欄（0）"
                className="mt-1 w-full rounded-lg border bg-background px-3 py-2 text-sm"
              />
            </label>
          </div>

          <details className="[&_summary::-webkit-details-marker]:hidden">
            <summary className="cursor-pointer list-none text-xs text-teal-dark">
              くわしく（日付・カテゴリ・任意）▾
            </summary>
            <div className="mt-2 grid gap-3 sm:grid-cols-2">
              <label className="text-xs text-muted">
                いつ？
                <input
                  type="date"
                  name="occurredAt"
                  defaultValue={todayValue()}
                  className="mt-1 w-full rounded-lg border bg-background px-3 py-2 text-sm"
                />
              </label>
              <label className="text-xs text-muted">
                関連カテゴリ
                <input
                  name="categoryName"
                  list="failure-category-options"
                  placeholder="予定を選べば自動で入ります"
                  className="mt-1 w-full rounded-lg border bg-background px-3 py-2 text-sm"
                />
                <datalist id="failure-category-options">
                  {categoryNames.map((n) => (
                    <option key={n} value={n} />
                  ))}
                </datalist>
              </label>
            </div>
          </details>

          <SubmitButton>記録する</SubmitButton>
        </form>
      </section>

      <section data-coach="fail-list" className="space-y-3">
        <h2 className="text-lg font-semibold">これまでの記録</h2>

        {logs.length === 0 ? (
          <p className="rounded-2xl bg-surface px-4 py-10 text-center text-sm text-muted">
            まだ記録はありません。上の「✍️ ひとこと記録する」からどうぞ。
          </p>
        ) : (
          <>
            {upcomingPredictions.length > 0 && (
              <details className="rounded-xl border border-border bg-surface p-3 [&_summary::-webkit-details-marker]:hidden">
                <summary className="cursor-pointer list-none text-xs font-semibold text-muted">
                  ▸ これからの失敗予測を見る（{upcomingPredictions.length}件）
                </summary>
                <ul className="mt-2 space-y-2">
                  {upcomingPredictions.map((l) => (
                    <FailureReviewRow
                      key={l.id}
                      log={toFR(l)}
                      reviewable={false}
                    />
                  ))}
                </ul>
              </details>
            )}

            {pastReviewed.length > 0 && (
              <details className="rounded-xl border border-border bg-surface p-3 [&_summary::-webkit-details-marker]:hidden">
                <summary className="cursor-pointer list-none text-xs font-semibold text-muted">
                  ▸ 過去の失敗予測の振り返りを見る（{pastReviewed.length}件）
                </summary>
                {/* 新しい順。結果を変えても並びは変わらず、行も消えない
                    （このページを離れて戻ると片付く）。 */}
                <StickyReviewRows
                  className="mt-2 space-y-2"
                  rows={pastReviewed.map(toFR)}
                />
              </details>
            )}

            {unlinkedLogs.length > 0 && (
              <details className="rounded-xl border border-border bg-surface p-3 [&_summary::-webkit-details-marker]:hidden">
                <summary className="cursor-pointer list-none text-xs font-semibold text-muted">
                  ▸ 予定に紐づかない記録を見る（{unlinkedLogs.length}件）
                </summary>
                {/* カテゴリ全体の記録。ここでも結果を選べるが、確認コーナーには出さない。 */}
                <StickyReviewRows
                  className="mt-2 space-y-2"
                  rows={unlinkedLogs.map(toFR)}
                />
              </details>
            )}

            {upcomingPredictions.length === 0 &&
              pastReviewed.length === 0 &&
              unlinkedLogs.length === 0 && (
                <p className="rounded-2xl bg-surface px-4 py-6 text-center text-sm text-muted">
                  済んだ記録はまだありません。
                </p>
              )}
          </>
        )}
      </section>
    </div>
  );
}
