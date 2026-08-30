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
      include: { category: true, checklistItems: true },
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
  const past = events.filter((e) => e.eventDatetime < now);

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-xl font-semibold">予定</h1>
      </div>

      {connected === "1" && (
        <p className="rounded-lg bg-accent-soft px-4 py-3 text-sm text-teal-dark">
          Google カレンダーに接続しました。「カレンダーから取り込む」を押すと予定が読み込まれます。
        </p>
      )}

      {/* Google 連携 / 同期 */}
      <section className="rounded-2xl bg-surface p-5">
        {account ? (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="text-sm">
              <p className="font-medium">{account.googleAccountEmail}</p>
              <p className="text-xs text-muted">
                {account.lastSyncedAt
                  ? `最終取り込み: ${formatDateTime(account.lastSyncedAt)}`
                  : "まだ取り込んでいません"}
              </p>
            </div>
            <form action={syncCalendar}>
              <SubmitButton>カレンダーから取り込む</SubmitButton>
            </form>
          </div>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-muted">
              Google カレンダーがまだ接続されていません。
            </p>
            <a
              href="/api/auth/google"
              className="rounded-lg bg-teal px-4 py-2 text-sm font-medium text-white no-underline hover:bg-teal-dark"
            >
              Google カレンダーと接続
            </a>
          </div>
        )}
      </section>

      {/* 手動登録 */}
      <section className="rounded-2xl bg-surface p-5">
        <h2 className="text-sm font-semibold text-muted">手動で予定を追加</h2>
        <p className="mt-1 text-xs text-muted">
          カレンダーに入れる前に試したいときに。
        </p>
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
            <span className="text-muted">カテゴリ</span>
            <input
              name="categoryName"
              list="category-options"
              defaultValue="その他"
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
      </section>

      {/* 予定一覧 */}
      <section className="space-y-3">
        <h2 className="text-lg font-semibold">これからの予定</h2>
        {upcoming.length === 0 ? (
          <p className="rounded-xl bg-surface px-4 py-6 text-center text-sm text-muted">
            まだ予定がありません。
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

        {past.length > 0 && (
          <details className="mt-4">
            <summary className="cursor-pointer text-sm text-muted">
              過去の予定（{past.length}）
            </summary>
            <ul className="mt-2 space-y-2">
              {past.map((ev) => (
                <EventRow key={ev.id} ev={ev} categoryNames={categoryNames} past />
              ))}
            </ul>
          </details>
        )}
      </section>
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
  const done = ev.checklistItems.filter((c) => c.isDone).length;
  return (
    <li
      className={`rounded-xl bg-surface p-4 ${past ? "opacity-70" : ""}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <Link
            href={`/events/${ev.id}`}
            className="font-medium text-foreground no-underline hover:text-teal-dark"
          >
            {ev.title}
          </Link>
          {warn && (
            <span className="ml-2 rounded bg-warn-soft px-1.5 py-0.5 text-[10px] text-warn">
              過去に失敗あり
            </span>
          )}
          <p className="text-xs text-muted">
            {formatDateShort(ev.eventDatetime)}
            {ev.source === "google" ? " ・ Google" : " ・ 手動"}
            {ev.checklistItems.length > 0
              ? ` ・ 準備 ${done}/${ev.checklistItems.length}`
              : ""}
          </p>
        </div>
        <CategorySelect
          eventId={ev.id}
          current={ev.category?.name ?? "その他"}
          options={categoryNames}
        />
      </div>
    </li>
  );
}
