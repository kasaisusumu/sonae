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
  tone,
}: {
  logId: string;
  target: "prevented" | "not_prevented" | "irrelevant";
  active: boolean;
  label: string;
  tone: "teal" | "warn" | "muted";
}) {
  const base =
    "rounded-full px-3.5 py-1.5 text-xs font-medium transition-colors";
  const cls = active
    ? tone === "teal"
      ? "bg-teal text-white"
      : tone === "warn"
        ? "bg-warn text-white"
        : "bg-foreground/70 text-white"
    : "border border-border bg-surface text-muted hover:border-teal hover:text-teal-dark";
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
            tone="teal"
          />
          <OutcomeButton
            logId={l.id}
            target="not_prevented"
            active={l.outcome === "not_prevented"}
            label="😓 防げなかった"
            tone="warn"
          />
          <OutcomeButton
            logId={l.id}
            target="irrelevant"
            active={l.outcome === "irrelevant"}
            label="今回は関係ない"
            tone="muted"
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
          <div className="flex flex-wrap items-center gap-2">
            <label className="text-xs text-muted">
              金額（円）
              <input
                type="number"
                name="estimatedLossYen"
                min={0}
                step={100}
                defaultValue={l.estimatedLossYen || ""}
                placeholder="任意"
                className="ml-1 w-24 rounded-md border bg-background px-2 py-1 text-sm"
              />
            </label>
            <label className="text-xs text-muted">
              日付
              <input
                type="date"
                name="occurredAt"
                defaultValue={toDateInputValue(l.occurredAt)}
                className="ml-1 rounded-md border bg-background px-2 py-1 text-sm"
              />
            </label>
            <SubmitButton variant="ghost">更新</SubmitButton>
          </div>
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
  const reviewable = (l: (typeof logs)[number]) =>
    !l.event || (l.event.endDatetime ?? l.event.eventDatetime) <= now;
  const unreviewed = logs.filter((l) => !l.outcome && reviewable(l));
  const pendingFuture = logs.filter((l) => !l.outcome && !reviewable(l));
  const reviewed = logs.filter((l) => l.outcome);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">失敗ログ</h1>
        <p className="mt-1.5 text-sm text-muted">
          うっかりは誰にでもあります。責めるための記録ではありません。
          残しておくと、次に似た予定が来たときに先回りできます。
        </p>
      </div>

      {/* ── 記入：まずは「ひとこと」だけでOK ── */}
      <section
        data-coach="fail-new"
        className="rounded-2xl border border-teal/20 bg-surface p-5"
      >
        <h2 className="flex items-center gap-1.5 text-sm font-semibold text-teal-dark">
          ✍️ ひとこと記録する
        </h2>
        <form action={createFailureLog} className="mt-3 space-y-3">
          <textarea
            name="description"
            required
            rows={2}
            placeholder="何があった？（例: 集合時間に遅刻した／保険証を忘れた）"
            className="w-full rounded-xl border bg-background px-3 py-2.5 text-sm"
          />

          <details className="[&_summary::-webkit-details-marker]:hidden">
            <summary className="cursor-pointer list-none text-xs text-teal-dark">
              くわしく（予定・金額・日付など・すべて任意）▾
            </summary>
            <div className="mt-2 grid gap-3 sm:grid-cols-2">
              <label className="text-xs text-muted sm:col-span-2">
                どの予定で起きた？（過去の予定）
                <select
                  name="eventId"
                  defaultValue=""
                  className="mt-1 w-full rounded-lg border bg-background px-3 py-2 text-sm text-foreground"
                >
                  <option value="">
                    — 予定に紐づけない（カテゴリ全体の記録）—
                  </option>
                  {events.map((e) => (
                    <option key={e.id} value={e.id}>
                      {formatDateOnly(e.eventDatetime)} {e.title}
                    </option>
                  ))}
                </select>
                <span className="mt-1 block text-[11px]">
                  紐づけると、その予定に似た予定でだけ先回りします。
                </span>
              </label>
              <label className="text-xs text-muted">
                だいたいの損失額（円）
                <input
                  type="number"
                  name="estimatedLossYen"
                  min={0}
                  step={100}
                  placeholder="なくてもOK"
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
              <label className="text-xs text-muted sm:col-span-2">
                いつ？
                <input
                  type="date"
                  name="occurredAt"
                  defaultValue={todayValue()}
                  className="mt-1 w-full rounded-lg border bg-background px-3 py-2 text-sm sm:w-56"
                />
              </label>
            </div>
          </details>

          <SubmitButton>記録する</SubmitButton>
          <p className="text-[11px] text-muted">
            くわしく開かなければ、日付は今日・予定なしで記録します（あとから直せます）。
          </p>
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
            {unreviewed.length > 0 && (
              <div className="space-y-2 rounded-2xl border border-teal/20 bg-teal-soft p-4">
                <div>
                  <h3 className="text-sm font-semibold text-teal-dark">
                    🤔 ふりかえり（{unreviewed.length}件）
                  </h3>
                  <p className="mt-0.5 text-[11px] text-teal-dark/80">
                    終わった予定、どうでしたか？ ワンタップで大丈夫です。「防げた」にしたものだけが
                    <a href="/savings" className="underline">
                      節約額
                    </a>
                    に積み上がります。
                  </p>
                </div>
                <ul className="space-y-2">
                  {unreviewed.map((l) => (
                    <FailureRow key={l.id} log={l} />
                  ))}
                </ul>
              </div>
            )}

            {pendingFuture.length > 0 && (
              <details className="[&_summary::-webkit-details-marker]:hidden">
                <summary className="cursor-pointer list-none text-xs font-semibold text-muted">
                  まだ先の予定の記録（{pendingFuture.length}件）— 予定が終わってから振り返り
                </summary>
                <ul className="mt-2 space-y-2">
                  {pendingFuture.map((l) => (
                    <FailureRow key={l.id} log={l} reviewable={false} />
                  ))}
                </ul>
              </details>
            )}

            {reviewed.length > 0 && (
              <div className="space-y-2">
                <h3 className="text-xs font-semibold text-muted">
                  ふりかえり済み（{reviewed.length}件）
                </h3>
                <ul className="space-y-2">
                  {reviewed.map((l) => (
                    <FailureRow key={l.id} log={l} />
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );
}
