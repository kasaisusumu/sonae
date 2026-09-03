import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { syncCalendar } from "@/app/actions";
import { DEFAULT_CATEGORIES } from "@/lib/categories";
import { formatDateShort, formatDateTime } from "@/lib/format";
import { CategorySelect } from "./category-select";
import { CardLink } from "@/app/components/card-link";
import { InfoHint } from "@/app/components/info-hint";
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
    // この予定に付いている失敗ログ（紐付け＝赤／未確認＝黄）。
    prisma.failureLog.findMany({
      where: {
        userId: user.id,
        eventId: { not: null },
        OR: [{ outcome: "linked" }, { outcome: null }],
      },
      select: { eventId: true, outcome: true },
    }),
    // 失敗ログはまだ無いが、似た予定・カテゴリで先回り提案が出ている
    // ＝「失敗の可能性あり」（黄）。ackEventWarning で却下済みは含まれない。
    getUpcomingWarnings(user.id),
  ]);

  const categoryNames = Array.from(
    new Set([...DEFAULT_CATEGORIES, ...categories.map((c) => c.name)]),
  );
  const linkedEventIds = new Set(
    linkedLogs
      .filter((l) => l.outcome === "linked")
      .map((l) => l.eventId)
      .filter((v): v is string => !!v),
  );
  const suspectedEventIds = new Set<string>([
    ...warnings.map((w) => w.event.id),
    ...linkedLogs
      .filter((l) => l.outcome === null)
      .map((l) => l.eventId)
      .filter((v): v is string => !!v),
  ]);
  const riskOf = (id: string): "linked" | "suspected" | undefined =>
    linkedEventIds.has(id)
      ? "linked"
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
            自動で用意されます。予定の説明欄にも準備リストを書き込みます
            （日時・タイトルは変えません／設定でオフに）。
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

      {/* ── このページの主役: これからの予定 ── */}
      <section className="space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="flex items-center gap-1.5 text-xl font-semibold tracking-tight">
              これからの予定
              <InfoHint>
                <span className="block font-semibold text-foreground">
                  カレンダーの説明欄から、そのまま準備リストへ
                </span>
                <span className="mt-1.5 block">
                  各予定の説明欄に「準備リスト」のリンクを自動で書き込みます。
                  カレンダーでそのリンクをタップすると、その予定の準備リストが
                  そのまま開きます。
                </span>
                <span className="mt-2 block rounded-lg border border-border bg-surface-muted p-2 text-[11px] leading-relaxed text-muted">
                  <span className="block">（予定のメモ）</span>
                  <span className="mt-1.5 block">--- 私の準備マニュアル ---</span>
                  <span className="block text-teal-dark underline">
                    準備リスト: https://…/events/xxxx ← ここをタップ
                  </span>
                  <span className="mt-1 block">【準備すること】 1/3</span>
                  <span className="block">☑ お茶を買う（1時間前）</span>
                  <span className="block">☐ 集合時間を確認</span>
                </span>
                <span className="mt-2 block text-muted">
                  連携より前の予定は、アプリで1回編集するか「確認しました」を
                  押すまで書き込まれません（勝手に書き換えないため）。
                  {account.writeDescriptionEnabled ? (
                    "設定でオフにもできます。"
                  ) : (
                    <>
                      いまは書き込みがオフです（
                      <a href="/settings" className="underline">
                        設定
                      </a>
                      でオンに）。
                    </>
                  )}
                </span>
              </InfoHint>
            </h1>
            <p className="mt-1 text-sm text-muted">
              カレンダーの予定と、その準備リストの一覧です。
            </p>
          </div>
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
  /** linked=この予定に「紐付け」した失敗ログあり（赤）／suspected=提案・未確認（黄）／なし=非表示 */
  risk?: "linked" | "suspected";
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
            {risk === "linked" && (
              <span className="ml-2 rounded bg-warn-soft px-1.5 py-0.5 text-[10px] font-medium text-warn">
                登録された失敗あり
              </span>
            )}
            {risk === "suspected" && (
              <span className="ml-2 rounded border border-amber-300 bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-800">
                失敗の可能性あり
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
