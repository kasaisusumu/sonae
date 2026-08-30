import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { createManualEvent, syncCalendar } from "@/app/actions";
import { DEFAULT_CATEGORIES } from "@/lib/categories";
import { formatDateShort, formatDateTime } from "@/lib/format";
import { CategorySelect } from "./category-select";
import { SubmitButton } from "@/app/components/submit-button";

export default async function EventsPage({
  searchParams,
}: {
  searchParams: Promise<{ connected?: string }>;
}) {
  const { connected } = await searchParams;
  const user = await getCurrentUser();
  if (!user) redirect("/");

  const [categories, events, failureCats] = await Promise.all([
    prisma.category.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "asc" },
    }),
    prisma.event.findMany({
      where: { userId: user.id },
      orderBy: { eventDatetime: "asc" },
      select: {
        id: true,
        title: true,
        eventDatetime: true,
        source: true,
        categoryId: true,
        failureWarningAckAt: true,
        category: { select: { name: true } },
        checklistItems: { select: { isDone: true } },
      },
    }),
    prisma.failureLog.findMany({
      where: { userId: user.id, categoryId: { not: null } },
      select: { categoryId: true },
      distinct: ["categoryId"],
    }),
  ]);

  const categoryNames = Array.from(
    new Set([...DEFAULT_CATEGORIES, ...categories.map((c) => c.name)]),
  );
  const riskyCategoryIds = new Set(
    failureCats.map((f) => f.categoryId).filter((v): v is string => v !== null),
  );
  const account = user.googleAccount;
  const now = new Date();
  const upcoming = events.filter((e) => e.eventDatetime >= now);
  const past = [...events.filter((e) => e.eventDatetime < now)].reverse();

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">予定</h1>

      {connected === "1" && (
        <p className="rounded-lg bg-accent-soft px-4 py-3 text-sm text-teal-dark">
          Google カレンダーに接続しました。「カレンダーから取り込む」で予定が読み込まれます。
        </p>
      )}

      {/* Google 連携 / 同期 */}
      <section className="rounded-2xl bg-surface p-4">
        {account ? (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs text-muted">
              {account.googleAccountEmail}
              {" ・ "}
              {account.lastSyncedAt
                ? `最終取り込み ${formatDateTime(account.lastSyncedAt)}`
                : "未取り込み"}
            </p>
            <form action={syncCalendar}>
              <SubmitButton>カレンダーから取り込む</SubmitButton>
            </form>
          </div>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-muted">Google カレンダー未接続</p>
            <a
              href="/api/auth/google"
              className="rounded-lg bg-teal px-4 py-2 text-sm font-medium text-white no-underline hover:bg-teal-dark"
            >
              接続する
            </a>
          </div>
        )}
      </section>

      {/* 手動登録（折りたたみ） */}
      <details className="rounded-2xl bg-surface p-4">
        <summary className="cursor-pointer text-sm font-medium text-teal-dark">
          ＋ 手動で予定を追加
        </summary>
        <form action={createManualEvent} className="mt-4 grid gap-3 sm:grid-cols-2">
          <label className="text-sm sm:col-span-2">
            <span className="text-muted">予定タイトル</span>
            <input
              name="title"
              required
              placeholder="例: 大阪へ出張"
              className="mt-1 w-full rounded-lg border bg-background px-3 py-2"
            />
          </label>
          <label className="text-sm">
            <span className="text-muted">日時</span>
            <input
              type="datetime-local"
              name="eventDatetime"
              required
              className="mt-1 w-full rounded-lg border bg-background px-3 py-2"
            />
          </label>
          <label className="text-sm">
            <span className="text-muted">カテゴリ（空欄で自動判定）</span>
            <input
              name="categoryName"
              list="category-options"
              placeholder="自動"
              className="mt-1 w-full rounded-lg border bg-background px-3 py-2"
            />
            <datalist id="category-options">
              {categoryNames.map((n) => (
                <option key={n} value={n} />
              ))}
            </datalist>
          </label>
          <label className="text-sm sm:col-span-2">
            <span className="text-muted">メモ（任意）</span>
            <textarea
              name="memo"
              rows={2}
              className="mt-1 w-full rounded-lg border bg-background px-3 py-2"
            />
          </label>
          <div className="sm:col-span-2">
            <SubmitButton>追加して準備リストを作る</SubmitButton>
          </div>
        </form>
      </details>

      {/* これからの予定 */}
      <section className="space-y-2">
        <h2 className="text-lg font-semibold">これからの予定</h2>
        {upcoming.length === 0 ? (
          <p className="rounded-xl bg-surface px-4 py-6 text-center text-sm text-muted">
            まだありません。
          </p>
        ) : (
          <ul className="space-y-2">
            {upcoming.map((ev) => (
              <EventRow
                key={ev.id}
                ev={ev}
                categoryNames={categoryNames}
                warn={
                  !ev.failureWarningAckAt &&
                  ev.categoryId !== null &&
                  riskyCategoryIds.has(ev.categoryId)
                }
              />
            ))}
          </ul>
        )}
      </section>

      {/* 済んだ予定（チェックリストはいつでも開ける） */}
      {past.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-lg font-semibold">済んだ予定</h2>
          <ul className="space-y-2">
            {past.map((ev) => (
              <EventRow key={ev.id} ev={ev} categoryNames={categoryNames} past />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function EventRow({
  ev,
  categoryNames,
  past,
  warn,
}: {
  ev: {
    id: string;
    title: string;
    eventDatetime: Date;
    source: string;
    category: { name: string } | null;
    checklistItems: { isDone: boolean }[];
  };
  categoryNames: string[];
  past?: boolean;
  warn?: boolean;
}) {
  const total = ev.checklistItems.length;
  const done = ev.checklistItems.filter((c) => c.isDone).length;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;

  return (
    <li
      className={`relative rounded-xl bg-surface p-4 transition-colors hover:bg-surface-muted ${
        past ? "opacity-80" : ""
      }`}
    >
      {/* カード全体を準備詳細へのタップ領域にする（カテゴリ選択より下のレイヤー） */}
      <Link
        href={`/events/${ev.id}`}
        aria-label={`${ev.title} の準備を開く`}
        className="absolute inset-0 z-0 rounded-xl"
      />
      <div className="relative z-10 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="font-medium text-foreground">
            {ev.title}
            {warn && (
              <span className="ml-2 rounded bg-warn-soft px-1.5 py-0.5 text-[10px] text-warn">
                過去に失敗あり
              </span>
            )}
          </p>
          <p className="text-xs text-muted">
            {formatDateShort(ev.eventDatetime)}
            {ev.source === "google" ? " ・ Google" : " ・ 手動"}
          </p>
          {total > 0 && (
            <div className="mt-2 flex items-center gap-2">
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-muted">
                <div
                  className="h-full rounded-full bg-accent"
                  style={{ width: `${pct}%` }}
                />
              </div>
              <span className="shrink-0 text-[11px] text-muted">
                準備 {done}/{total}
              </span>
            </div>
          )}
          <p className="mt-1 text-[11px] text-teal-dark">準備を開く →</p>
        </div>
        {/* z-20 でリンクより手前。タップしても遷移しない */}
        <div className="relative z-20">
          <CategorySelect
            eventId={ev.id}
            current={ev.category?.name ?? "その他"}
            options={categoryNames}
          />
        </div>
      </div>
    </li>
  );
}
