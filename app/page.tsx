import Link from "next/link";
import { after } from "next/server";
import { getCurrentUser } from "@/lib/session";
import { isDevLoginEnabled } from "@/lib/dev-login";
import { listFutureMessages } from "@/lib/future-messages";
import { getUpcomingWarnings } from "@/lib/failures";
import { primeNotifiedChecklists } from "@/lib/checklist";
import { loadPriorityHomeLists } from "@/lib/priority-home";
import { priorityExtrasEnabledOf } from "@/lib/priority-mode";
import { trackEvent } from "@/lib/track";
import { prisma } from "@/lib/prisma";
import { featureModeOf, isFailureLogEnabled } from "@/lib/feature-mode";
import { GettingStarted } from "@/app/components/getting-started";
import { Landing } from "@/app/components/landing";
import { NotifyOffBanner } from "@/app/components/notify-off-banner";
import { SavingsDashboard } from "@/app/components/savings-dashboard";
import { GrowthDashboard } from "@/app/components/growth-dashboard";
import { PriorityHomeContainer } from "@/app/components/priority-home-container";
import { MessageList } from "@/app/failures/message-list";

export const maxDuration = 60;

const STEPS_TEST = [
  "Google カレンダーに予定を入れる（またはアプリで手動追加）",
  "予定ごとに「準備すること」と「持ち物」が自動で用意される",
  "いる／いらない・タイミングを直すと、次から精度が上がる",
  "思い出したいことは「未来の自分へ」に記録 → 似た予定で自動的に知らせる",
];
const STEPS_PRODUCTION = [
  "Google カレンダーに予定を入れる（またはアプリで手動追加）",
  "予定ごとに「準備すること」と「持ち物」が自動で用意される",
  "いる／いらない・タイミングを直すと、次から精度が上がる",
  "うっかりは「失敗ログ」に記録 → 似た予定で先回り＆節約額を可視化",
];

function HowTo({
  open = false,
  steps,
}: {
  open?: boolean;
  steps: string[];
}) {
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
        {steps.map((s, i) => (
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
      <Landing
        loggedout={!!loggedout}
        authMessage={authMessage}
        devLogin={isDevLoginEnabled()}
      />
    );
  }

  const mode = featureModeOf(user);
  const isProd = isFailureLogEnabled(mode);
  const priorityExtrasEnabled = priorityExtrasEnabledOf(user);

  const [warnings, pushCount, futureMessages, priorityLists] = await Promise.all([
    isProd ? getUpcomingWarnings(user.id) : Promise.resolve([]),
    prisma.pushSubscription.count({ where: { userId: user.id } }),
    isProd ? Promise.resolve([]) : listFutureMessages(user.id),
    priorityExtrasEnabled
      ? loadPriorityHomeLists(user.id)
      : Promise.resolve({ urgent: [], later: [] }),
  ]);
  const vapidPublicKey = process.env.VAPID_PUBLIC_KEY ?? null;

  trackEvent(user.id, "page:/");
  after(() => primeNotifiedChecklists(user.id));

  return (
    <div className="space-y-6">
      {/* 未オンボーディングのときだけ出る。出ているならこれがこのページの主役。 */}
      <GettingStarted userId={user.id} />

      {/* はじめかたが済んだあとに通知だけオフへ戻った人にも気づかせる、常時表示の警告。 */}
      {pushCount === 0 && <NotifyOffBanner publicKey={vapidPublicKey} />}

      {/* 「急ぎ」「そのうち」一覧。ver2.1（priorityExtrasEnabled）がONのときだけ出す
          （2026-10-23追加、2026-10-24にver2.1として独立したスイッチの対象にした）。
          本番版・テスト版（ver1/ver2）どちらでも、ver2.1さえONなら出す。
          同じ名前の項目・メッセージは1行にまとめ、直近の予定を代表として出す。
          表示するかどうか・内容は PriorityHomeContainer がマウント時の値で固定する
          （チェックした瞬間にセクションごと消えるのを防ぐ）。 */}
      {priorityExtrasEnabled && (
        <PriorityHomeContainer
          urgent={priorityLists.urgent.map((r) => ({
            ...r,
            eventDate: r.eventDate ? r.eventDate.toISOString() : null,
          }))}
          later={priorityLists.later.map((r) => ({
            ...r,
            eventDate: r.eventDate ? r.eventDate.toISOString() : null,
          }))}
        />
      )}

      {isProd ? (
        <>
          {/* ── このページの主役: これまでの節約 ── */}
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
                      className="block rounded-xl bg-surface px-4 py-3 no-underline transition-colors hover:bg-surface-muted active:bg-accent-soft"
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
        </>
      ) : (
        <>
          {/* ── このページの主役（テスト版）: そなえさんの成長 ── */}
          <div data-coach="growth">
            <GrowthDashboard userId={user.id} />
          </div>

          <MessageList
            messages={futureMessages.map((m) => ({
              id: m.id,
              body: m.body,
              keywords: m.keywords,
              genres: m.genres,
              categoryIds: m.categoryIds,
              scope: m.scope,
              archivedAt: m.archivedAt,
              confirmedCount: m.confirmedCount,
              upcomingEvents: m.upcomingEvents,
              sourceEventTitle: m.sourceEventTitle,
            }))}
          />
        </>
      )}

      {/* 使い方は一番下に、たたんで置く */}
      <HowTo steps={isProd ? STEPS_PRODUCTION : STEPS_TEST} />
    </div>
  );
}
