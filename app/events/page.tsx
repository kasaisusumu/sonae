import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { syncCalendar } from "@/app/actions";
import { DEFAULT_CATEGORIES } from "@/lib/categories";
import { formatDateShort, formatDateTime } from "@/lib/format";
import { CategorySelect } from "./category-select";
import { CalendarLinkTip } from "./calendar-link-tip";
import { CardLink } from "@/app/components/card-link";
import { SubmitButton } from "@/app/components/submit-button";
import { EventSearch, type SearchRow } from "./event-search";
import { eventDateKey, eventDateLabel, eventHaystack } from "./haystack";
import { getUpcomingWarnings } from "@/lib/failures";

export default async function EventsPage({
  searchParams,
}: {
  searchParams: Promise<{ connected?: string }>;
}) {
  const { connected } = await searchParams;
  const user = await getCurrentUser();
  if (!user) redirect("/");

  const [categories, events, linkedLogs, warnings] = await Promise.all([
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
        memo: true,
        category: { select: { name: true } },
        checklistItems: { select: { isDone: true, title: true } },
      },
    }),
    // この予定で実際に失敗が記録／確定している＝「過去に失敗あり」（赤）。
    // "linked"（提案を紐付けただけ）や "irrelevant" は含めない。
    prisma.failureLog.findMany({
      where: {
        userId: user.id,
        eventId: { not: null },
        OR: [
          { outcome: null },
          { outcome: { in: ["not_prevented", "prevented"] } },
        ],
      },
      select: { eventId: true },
      distinct: ["eventId"],
    }),
    // ひもづいてはいないが、似た予定・カテゴリで先回り警告が出ている＝「危険性あり」
    // （ackEventWarning で却下済みのものは含まれない）
    getUpcomingWarnings(user.id),
  ]);

  const categoryNames = Array.from(
    new Set([...DEFAULT_CATEGORIES, ...categories.map((c) => c.name)]),
  );
  const loggedEventIds = new Set(
    linkedLogs.map((l) => l.eventId).filter((v): v is string => !!v),
  );
  const suspectedEventIds = new Set(warnings.map((w) => w.event.id));
  const riskOf = (id: string): "logged" | "suspected" | undefined =>
    loggedEventIds.has(id)
      ? "logged"
      : suspectedEventIds.has(id)
        ? "suspected"
        : undefined;
  const account = user.googleAccount;
  const now = new Date();
  const upcoming = events.filter((e) => e.eventDatetime >= now);
  const past = [...events.filter((e) => e.eventDatetime < now)].reverse();

  // 未接続なら「つなぐ」ことがこのページで唯一のやること → それだけを大きく出す
  if (!account) {
    return (
      <div className="mx-auto max-w-md">
        <section className="rounded-2xl border border-teal/25 bg-teal-soft p-7 text-center">
          <h1 className="text-lg font-semibold text-teal-dark">
            まず Google カレンダーとつなぐ
          </h1>
          <p className="mt-2 text-sm text-muted">
            つなぐと、予定を入れるだけで「準備すること」と「持ち物」が
            自動で用意されます。カレンダーは読み取りのみ。
          </p>
          <a
            href="/api/auth/google"
            className="mt-5 inline-flex w-full items-center justify-center rounded-xl bg-foreground px-6 py-3 text-sm font-medium text-surface no-underline shadow-sm transition-colors hover:opacity-90"
          >
            接続する（約30秒）
          </a>
        </section>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {connected === "1" && (
        <p className="rounded-xl bg-accent-soft px-4 py-3 text-sm text-teal-dark">
          Google カレンダーに接続しました。予定を取り込んでいます。
        </p>
      )}

      {/* 目玉: カレンダーの説明欄のリンクから準備リストへ飛べる、の説明（大きく・閉じられる） */}
      <CalendarLinkTip
        writeEnabled={account.writeDescriptionEnabled ?? false}
      />

      {/* ── このページの主役: これからの予定 ── */}
      <section className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-xl font-semibold tracking-tight">
            これからの予定
          </h1>
          <form action={syncCalendar} data-coach="sync">
            <SubmitButton variant="ghost">↻ 取り込む</SubmitButton>
          </form>
        </div>

        {upcoming.length === 0 ? (
          <div className="rounded-2xl bg-surface px-4 py-10 text-center text-sm text-muted">
            これからの予定がありません。
            <br />
            Google カレンダーに予定を入れると、ここに並びます。
          </div>
        ) : (
          <EventSearch
            rows={upcoming.map(
              (ev): SearchRow => ({
                id: ev.id,
                haystack: eventHaystack(ev, now),
                dateKey: eventDateKey(ev.eventDatetime),
                dateLabel: eventDateLabel(ev.eventDatetime, now),
                node: (
                  <EventRow
                    ev={ev}
                    categoryNames={categoryNames}
                    risk={riskOf(ev.id)}
                  />
                ),
              }),
            )}
          />
        )}
      </section>

      {/* 済んだ予定は折りたたんで、主役の邪魔をしない */}
      {past.length > 0 && (
        <details className="rounded-2xl bg-surface p-4 [&_summary::-webkit-details-marker]:hidden">
          <summary className="cursor-pointer list-none text-sm font-semibold text-muted">
            済んだ予定（{past.length}）
          </summary>
          <ul className="mt-3 space-y-2.5">
            {past.map((ev) => (
              <EventRow
                key={ev.id}
                ev={ev}
                categoryNames={categoryNames}
                past
              />
            ))}
          </ul>
        </details>
      )}

      <p className="px-1 text-[11px] text-muted">
        {account.googleAccountEmail}
        {account.lastSyncedAt
          ? ` ・ 最終取り込み ${formatDateTime(account.lastSyncedAt)}`
          : ""}
      </p>
    </div>
  );
}

function EventRow({
  ev,
  categoryNames,
  past,
  risk,
}: {
  ev: {
    id: string;
    title: string;
    eventDatetime: Date;
    source: string;
    category: { name: string } | null;
    checklistItems: { isDone: boolean; title?: string | null }[];
  };
  categoryNames: string[];
  past?: boolean;
  /** logged=この予定に失敗ログあり（赤）／suspected=提案段階の危険性（黄）／なし=非表示 */
  risk?: "logged" | "suspected";
}) {
  const total = ev.checklistItems.length;
  const done = ev.checklistItems.filter((c) => c.isDone).length;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;

  return (
    <li
      data-coach="event-card"
      className={`relative rounded-xl bg-surface p-4 transition-colors hover:bg-surface-muted active:bg-accent-soft ${
        past ? "opacity-80" : ""
      }`}
    >
      {/* カード全体を準備詳細へのタップ領域にする（ストレッチリンク）。
          カテゴリ選択だけはこのリンクより手前（z-20）に置いて操作可能にする。 */}
      <CardLink
        href={`/events/${ev.id}`}
        ariaLabel={`${ev.title} の準備を開く`}
      />
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="font-medium text-foreground">
            {ev.title}
            {risk === "logged" && (
              <span className="ml-2 rounded bg-warn-soft px-1.5 py-0.5 text-[10px] font-medium text-warn">
                過去に失敗あり
              </span>
            )}
            {risk === "suspected" && (
              <span className="ml-2 rounded border border-amber-300 bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-800">
                失敗の危険性あり
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
