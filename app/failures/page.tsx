import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import {
  createFailureLog,
  deleteFailureLog,
  setFailureOutcome,
  updateFailureLog,
} from "@/app/actions";
import { DEFAULT_CATEGORIES } from "@/lib/categories";
import {
  formatDateOnly,
  formatYen,
  jstToday,
  toDateInputValue,
} from "@/lib/format";
import { SubmitButton } from "@/app/components/submit-button";
import { ConfirmButton } from "@/app/components/confirm-button";
import { InfoHint } from "@/app/components/info-hint";
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

function OutcomeButton({
  logId,
  target,
  active,
  label,
}: {
  logId: string;
  target: "prevented" | "not_prevented" | "irrelevant";
  active: boolean;
  label: string;
}) {
  const base =
    "rounded-full px-3.5 py-1.5 text-xs font-medium transition-colors";
  // 白黒ベース。選択中＝前景色ベタ、未選択＝枠線のみ。意味は絵文字と✓で示す。
  const cls = active
    ? "bg-foreground text-surface"
    : "border border-border bg-surface text-muted hover:border-foreground/40 hover:text-foreground";
  return (
    <form action={setFailureOutcome}>
      <input type="hidden" name="failureLogId" value={logId} />
      <input
        type="hidden"
        name="outcome"
        value={active ? "unset" : target}
      />
      <button type="submit" className={`${base} ${cls}`}>
        {active ? `✓ ${label}` : label}
      </button>
    </form>
  );
}

function FailureRow({
  log: l,
  reviewable = true,
}: {
  log: LogRow;
  reviewable?: boolean;
}) {
  return (
    <li className="rounded-xl bg-surface p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="whitespace-pre-wrap text-sm">{l.description}</p>
          <p className="mt-1 text-xs text-muted">
            {formatDateOnly(l.occurredAt)}
            {l.category ? ` ・ ${l.category.name}` : " ・ カテゴリなし"}
            {l.event ? ` ・ 「${l.event.title}」` : ""}
            {l.estimatedLossYen > 0
              ? ` ・ 推定 ${formatYen(l.estimatedLossYen)}`
              : ""}
          </p>
        </div>
        <form action={deleteFailureLog}>
          <input type="hidden" name="id" value={l.id} />
          <ConfirmButton
            message="この失敗ログを削除しますか？"
            className="shrink-0 rounded px-2 py-1 text-xs text-muted hover:bg-warn-soft hover:text-warn"
          >
            削除
          </ConfirmButton>
        </form>
      </div>
      {reviewable ? (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <OutcomeButton
            logId={l.id}
            target="prevented"
            active={l.outcome === "prevented"}
            label="🛡️ 防げた"
          />
          <OutcomeButton
            logId={l.id}
            target="not_prevented"
            active={l.outcome === "not_prevented"}
            label="😓 防げなかった"
          />
          <OutcomeButton
            logId={l.id}
            target="irrelevant"
            active={l.outcome === "irrelevant"}
            label="今回は関係ない"
          />
        </div>
      ) : (
        <p className="mt-2 text-[11px] text-muted">
          この予定が終わってから振り返れます。
        </p>
      )}

      <details className="mt-2 [&_summary::-webkit-details-marker]:hidden">
        <summary className="cursor-pointer list-none text-[11px] text-teal-dark">
          ✏️ 内容・金額・日付を直す
        </summary>
        <form action={updateFailureLog} className="mt-2 space-y-2">
          <input type="hidden" name="id" value={l.id} />
          <textarea
            name="description"
            required
            rows={2}
            defaultValue={l.description}
            className="w-full rounded-lg border bg-background px-3 py-2 text-sm"
          />
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="block text-xs text-muted">
              金額（円）
              <input
                type="number"
                name="estimatedLossYen"
                min={0}
                step={100}
                defaultValue={l.estimatedLossYen || ""}
                placeholder="任意"
                className="mt-0.5 w-full rounded-md border bg-background px-3 py-2 text-sm"
              />
            </label>
            <label className="block text-xs text-muted">
              日付
              <input
                type="date"
                name="occurredAt"
                defaultValue={toDateInputValue(l.occurredAt)}
                className="mt-0.5 w-full rounded-md border bg-background px-3 py-2 text-sm"
              />
            </label>
          </div>
          <SubmitButton variant="ghost">更新</SubmitButton>
        </form>
      </details>
    </li>
  );
}

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
  // 予定に紐づく記録は、その予定が終わってから振り返る。
  const now = new Date();
  const eventEnded = (l: (typeof logs)[number]) =>
    !l.event || (l.event.endDatetime ?? l.event.eventDatetime) <= now;
  // アプリが提案しただけで、その予定に採用（linked）されなかった失敗は「記録」では
  // ない。結果の確認はしない（一覧の各セクションにも出さない）。
  const isUnadopted = (l: (typeof logs)[number]) =>
    !!l.event && l.outcome === null;

  const reviewableLogs = logs.filter((l) => !isUnadopted(l) && eventEnded(l));
  // これまでの記録は 2 つだけ:
  //  - これからの失敗予測 = 採用済みで、予定がまだ先のもの
  //  - 過去の失敗予測の振り返り = 予定が終わっていて、結果が決まっているもの
  const upcomingPredictions = logs.filter(
    (l) => !isUnadopted(l) && !!l.event && !eventEnded(l),
  );
  const pastReviewed = logs.filter(
    (l) => !isUnadopted(l) && eventEnded(l) && !!l.outcome,
  );

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
                    <FailureRow key={l.id} log={l} reviewable={false} />
                  ))}
                </ul>
              </details>
            )}

            {pastReviewed.length > 0 && (
              <details className="rounded-xl border border-border bg-surface p-3 [&_summary::-webkit-details-marker]:hidden">
                <summary className="cursor-pointer list-none text-xs font-semibold text-muted">
                  ▸ 過去の失敗予測の振り返りを見る（{pastReviewed.length}件）
                </summary>
                <ul className="mt-2 space-y-2">
                  {pastReviewed.map((l) => (
                    <FailureRow key={l.id} log={l} />
                  ))}
                </ul>
              </details>
            )}

            {upcomingPredictions.length === 0 && pastReviewed.length === 0 && (
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
