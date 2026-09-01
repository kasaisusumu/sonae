import Link from "next/link";
import { after } from "next/server";
import { getCurrentUser } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { isDevLoginEnabled } from "@/lib/dev-login";
import { getUpcomingWarnings } from "@/lib/failures";
import { primeNotifiedChecklists } from "@/lib/checklist";
import { SavingsDashboard } from "@/app/components/savings-dashboard";
import { GettingStarted } from "@/app/components/getting-started";

export const maxDuration = 60;

const STEPS = [
  "Google カレンダーに予定を入れる（またはアプリで手動追加）",
  "予定ごとに「準備すること」と「持ち物」が自動で用意される",
  "いる／いらない・タイミングを直すと、次から精度が上がる",
  "うっかりは「失敗ログ」に記録 → 似た予定で先回り＆節約額を可視化",
];

function HowTo({ open = false }: { open?: boolean }) {
  return (
    <details
      open={open}
      data-coach="how-to"
      className="rounded-2xl bg-surface p-5 [&_summary::-webkit-details-marker]:hidden"
    >
      <summary className="cursor-pointer list-none text-sm font-semibold text-teal-dark">
        このアプリの使い方
      </summary>
      <ol className="mt-3 space-y-2 text-sm text-muted">
        {STEPS.map((s, i) => (
          <li key={i} className="flex gap-2">
            <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-teal-soft text-xs font-semibold text-teal-dark">
              {i + 1}
            </span>
            <span>{s}</span>
          </li>
        ))}
      </ol>
      <p className="mt-3 text-xs text-muted">
        学習でリストが「太る」ことはありません。増えた情報は、出す項目・タイミングの精度を上げるために使います。
      </p>
    </details>
  );
}

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ auth?: string; loggedout?: string }>;
}) {
  const { auth, loggedout } = await searchParams;
  const user = await getCurrentUser();
  const authMessage =
    auth === "config"
      ? "Google 連携の設定（環境変数）が未完了です。GOOGLE_CLIENT_ID などを確認してください。"
      : auth === "failed"
        ? "ログインに失敗しました。もう一度お試しください。"
        : null;

  if (!user) {
    return (
      <div className="mx-auto max-w-md">
        <div className="text-center">
          <h1 className="text-2xl font-semibold text-teal-dark">
            予定の準備を、わすれない。
          </h1>
          <p className="mt-4 text-muted">
            カレンダーに予定を入れるだけ。「準備すること」と「持ち物」が自動で用意されて、
            当日までに通知します。
          </p>

          <ol className="mx-auto mt-6 max-w-xs space-y-2 text-left text-sm">
            {[
              "Google でログイン（約30秒）",
              "予定ごとに準備リストが出る",
              "いる／いらないを直すと、次から賢くなる",
            ].map((s, i) => (
              <li key={i} className="flex gap-2">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-teal-soft text-xs font-semibold text-teal-dark">
                  {i + 1}
                </span>
                <span className="text-muted">{s}</span>
              </li>
            ))}
          </ol>

          {loggedout && (
            <p className="mt-4 rounded-lg bg-accent-soft px-4 py-3 text-sm text-teal-dark">
              ログアウトしました。データは保存されています。
              <br />
              同じ Google アカウントで入り直すと、そのまま元に戻ります。
            </p>
          )}
          {authMessage && (
            <p className="mt-4 rounded-lg bg-warn-soft px-4 py-3 text-sm text-warn">
              {authMessage}
            </p>
          )}
          <a
            href="/api/auth/google"
            className="mt-7 inline-flex w-full items-center justify-center rounded-xl bg-teal px-6 py-3.5 font-medium text-white no-underline transition-colors hover:bg-teal-dark"
          >
            {loggedout ? "Google で入り直す" : "Google ではじめる"}
          </a>
          <p className="mt-3 text-xs text-muted">
            カレンダーは読み取りのみ。設定でオンにしたときだけ、予定の説明欄に準備リストを書き込みます。
          </p>
          <p className="mt-2 text-xs text-muted">
            途中で「このアプリは確認されていません」と出たら、「詳細」→「
            {"（アプリ名）"}に移動」で進めます（検証中のため）。
          </p>
          {isDevLoginEnabled() && (
            <p className="mt-6 text-xs text-muted">
              <a href="/api/auth/dev-login" className="underline">
                開発用ログイン
              </a>
              （本番では無効）
            </p>
          )}
        </div>
      </div>
    );
  }

  const now = new Date();

  const [upcoming, warnings] = await Promise.all([
    prisma.event.findMany({
      where: { userId: user.id, eventDatetime: { gte: now } },
      orderBy: { eventDatetime: "asc" },
      take: 5,
      select: {
        id: true,
        title: true,
        eventDatetime: true,
        category: { select: { name: true } },
        checklistItems: { select: { isDone: true } },
      },
    }),
    getUpcomingWarnings(user.id),
  ]);

  after(() => primeNotifiedChecklists(user.id));

  return (
    <div className="space-y-6">
      <GettingStarted userId={user.id} />

      <HowTo open={upcoming.length === 0} />

      <div data-coach="savings">
        <SavingsDashboard userId={user.id} />
      </div>

      {warnings.length > 0 && (
        <section className="rounded-2xl border border-warn/30 bg-warn-soft p-5">
          <h2 className="text-sm font-semibold text-warn">気をつけたい予定</h2>
          <ul className="mt-3 space-y-2">
            {warnings.slice(0, 4).map((w) => (
              <li key={w.event.id}>
                <Link
                  href={`/events/${w.event.id}`}
                  className="block rounded-xl bg-surface px-4 py-3 no-underline hover:bg-surface-muted"
                >
                  <span className="block text-sm font-medium text-foreground">
                    {w.event.title}
                  </span>
                  <span className="block text-xs text-muted">
                    {w.event.categoryName}で過去に「
                    {w.logs[0]?.description.slice(0, 28)}
                    {(w.logs[0]?.description.length ?? 0) > 28 ? "…" : ""}」
                    {w.logs.length > 1 ? ` ほか${w.logs.length - 1}件` : ""}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold">これからの予定</h2>
          <Link href="/events" className="text-sm no-underline hover:text-teal-dark">
            すべて見る →
          </Link>
        </div>

        {upcoming.length === 0 ? (
          <p className="rounded-xl bg-surface px-4 py-6 text-center text-sm text-muted">
            予定がまだありません。
            <Link href="/events" className="ml-1 no-underline">
              取り込む / 追加する
            </Link>
          </p>
        ) : (
          <ul className="space-y-2">
            {upcoming.map((ev) => {
              const total = ev.checklistItems.length;
              const done = ev.checklistItems.filter((c) => c.isDone).length;
              return (
                <li key={ev.id}>
                  <Link
                    href={`/events/${ev.id}`}
                    className="flex items-center justify-between gap-3 rounded-xl bg-surface px-4 py-3 no-underline transition-colors hover:bg-surface-muted"
                  >
                    <span className="min-w-0">
                      <span className="block truncate font-medium text-foreground">
                        {ev.title}
                      </span>
                      <span className="block text-xs text-muted">
                        {formatDateTime(ev.eventDatetime)}
                        {ev.category ? ` ・ ${ev.category.name}` : ""}
                      </span>
                    </span>
                    {total > 0 && (
                      <span className="shrink-0 text-xs text-muted">
                        {done}/{total}
                      </span>
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}

function formatDateTime(d: Date): string {
  return d.toLocaleString("ja-JP", {
    timeZone: "Asia/Tokyo",
    month: "numeric",
    day: "numeric",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}
