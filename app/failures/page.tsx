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
  event: { title: string } | null;
};

function OutcomeButton({
  logId,
  target,
  active,
  label,
  tone,
}: {
  logId: string;
  target: "prevented" | "not_prevented";
  active: boolean;
  label: string;
  tone: "teal" | "warn";
}) {
  const base = "rounded-full px-3 py-1 text-xs transition-colors";
  const cls = active
    ? tone === "teal"
      ? "bg-teal text-white"
      : "bg-warn text-white"
    : "border border-border text-muted hover:border-foreground/40";
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

function FailureRow({ log: l }: { log: LogRow }) {
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
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <OutcomeButton
          logId={l.id}
          target="prevented"
          active={l.outcome === "prevented"}
          label="防げた"
          tone="teal"
        />
        <OutcomeButton
          logId={l.id}
          target="not_prevented"
          active={l.outcome === "not_prevented"}
          label="防げなかった"
          tone="warn"
        />
      </div>

      <details className="mt-2 [&_summary::-webkit-details-marker]:hidden">
        <summary className="cursor-pointer list-none text-[11px] text-teal-dark">
          内容・金額・日付を編集
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
      include: { category: true, event: { select: { title: true } } },
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
  const total = logs.reduce((s, l) => s + l.estimatedLossYen, 0);
  const unreviewed = logs.filter((l) => !l.outcome);
  const reviewed = logs.filter((l) => l.outcome);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-xl font-semibold">失敗ログ</h1>
        <p className="mt-1 text-sm text-muted">
          うっかりは誰にでもあります。責めるためではなく、似た予定で先回りするための記録です。金額がなくても記録できます。
        </p>
      </div>

      <section data-coach="fail-new" className="rounded-2xl bg-surface p-5">
        <h2 className="text-sm font-semibold text-muted">記録する</h2>
        <form action={createFailureLog} className="mt-4 grid gap-3 sm:grid-cols-2">
          <label className="text-sm sm:col-span-2">
            <span className="text-muted">何が起きた？</span>
            <textarea
              name="description"
              required
              rows={2}
              placeholder="例: 集合時間に遅刻した／保険証を忘れた／新幹線に乗り遅れた"
              className="mt-1 w-full rounded-lg border bg-background px-3 py-2"
            />
          </label>
          <label className="text-sm sm:col-span-2">
            <span className="text-muted">どの予定で起きた？（過去の予定・任意）</span>
            <select
              name="eventId"
              defaultValue=""
              className="mt-1 w-full rounded-lg border bg-background px-3 py-2"
            >
              <option value="">— 予定に紐づけない（カテゴリ全体の記録）—</option>
              {events.map((e) => (
                <option key={e.id} value={e.id}>
                  {formatDateOnly(e.eventDatetime)} {e.title}
                </option>
              ))}
            </select>
            <span className="mt-1 block text-xs text-muted">
              紐づけると、その予定に似た予定でだけ警告します。
            </span>
          </label>
          <label className="text-sm">
            <span className="text-muted">推定損失額（円・任意）</span>
            <input
              type="number"
              name="estimatedLossYen"
              min={0}
              step={100}
              placeholder="なくてもOK"
              className="mt-1 w-full rounded-lg border bg-background px-3 py-2"
            />
          </label>
          <label className="text-sm">
            <span className="text-muted">関連カテゴリ（任意）</span>
            <input
              name="categoryName"
              list="failure-category-options"
              placeholder="予定を選べば自動で入ります"
              className="mt-1 w-full rounded-lg border bg-background px-3 py-2"
            />
            <datalist id="failure-category-options">
              {categoryNames.map((n) => (
                <option key={n} value={n} />
              ))}
            </datalist>
          </label>
          <label className="text-sm sm:col-span-2">
            <span className="text-muted">いつ？</span>
            <input
              type="date"
              name="occurredAt"
              defaultValue={todayValue()}
              className="mt-1 w-full rounded-lg border bg-background px-3 py-2 sm:w-56"
            />
          </label>
          <div className="sm:col-span-2">
            <SubmitButton>記録する</SubmitButton>
          </div>
        </form>
      </section>

      <section data-coach="fail-list" className="space-y-3">
        <div className="flex items-baseline justify-between">
          <h2 className="text-lg font-semibold">これまでの記録</h2>
          {logs.length > 0 && (
            <span className="text-xs text-muted">
              推定損失の合計 {formatYen(total)}（参考値）
            </span>
          )}
        </div>

        {logs.length === 0 ? (
          <p className="rounded-xl bg-surface px-4 py-6 text-center text-sm text-muted">
            まだ記録はありません。
          </p>
        ) : (
          <>
            <p className="text-xs text-muted">
              各記録について「防げた／防げなかった」を選べます。「防げた」にしたものだけが
              <a href="/savings" className="underline">
                節約額ダッシュボード
              </a>
              に残ります。
            </p>

            {unreviewed.length > 0 && (
              <div className="space-y-2">
                <h3 className="text-xs font-semibold text-warn">
                  まだ振り返っていない記録（{unreviewed.length}件）
                </h3>
                <ul className="space-y-2">
                  {unreviewed.map((l) => (
                    <FailureRow key={l.id} log={l} />
                  ))}
                </ul>
              </div>
            )}

            {reviewed.length > 0 && (
              <div className="space-y-2">
                {unreviewed.length > 0 && (
                  <h3 className="text-xs font-semibold text-muted">振り返り済み</h3>
                )}
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
