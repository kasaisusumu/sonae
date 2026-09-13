import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { formatYen, formatDateOnly } from "@/lib/format";
import { jstDayKey } from "@/lib/activity";
import { isAdminEmail, consumeAdminLoginToken } from "@/lib/admin-auth";
import {
  PAGE_KEYS,
  FEATURE_KEYS,
  INFOHINT_KEYS,
  POPUP_KEYS,
  type TrackedKey,
} from "@/lib/track-catalog";

/**
 * 運営者だけが見る管理一覧。ADMIN_EMAIL（.env / Vercel）に一致するユーザー以外は 404。
 * さらに、アクセスのたびに毎回 Google 再ログインを挟む（有効な使い切りトークンが
 * 無ければ /api/auth/google?dest=admin に飛ばす。lib/admin-auth.ts 参照）。
 * フィードバック（WTP アンケート）に加え、利用者ごとのアナリティクス
 * （オンボーディング進捗・利用時間・使用量）と全体サマリーを見られる。
 * 個々の失敗ログ・準備リストの中身は載せない（件数・金額などの集計のみ）。
 */
export const dynamic = "force-dynamic";

const DAYS_SHOWN = 14; // 日別利用時間で遡る日数

function fmtDateTime(d: Date): string {
  return d.toLocaleString("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** 分数を「◯時間◯分」に。60分未満は「◯分」、0は「0分」。 */
function formatMinutes(min: number): string {
  if (min <= 0) return "0分";
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h === 0) return `${m}分`;
  if (m === 0) return `${h}時間`;
  return `${h}時間${m}分`;
}

/** JST 暦日どうしの日数差（切り捨て）。「登録から◯日」「最終アクセスから◯日」に使う。 */
function daysSince(d: Date, now: Date): number {
  const a = jstDayKey(d);
  const b = jstDayKey(now);
  const ad = Date.parse(`${a}T00:00:00+09:00`);
  const bd = Date.parse(`${b}T00:00:00+09:00`);
  return Math.max(0, Math.round((bd - ad) / 86_400_000));
}

/** 直近 N 日ぶんの JST 日付キーと表示ラベル（月/日）。古い→新しい順。 */
function recentDayKeys(n: number, now: Date): { key: string; label: string }[] {
  const out: { key: string; label: string }[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(now.getTime() - i * 86_400_000);
    const key = jstDayKey(d);
    const [, m, day] = key.split("-");
    out.push({ key, label: `${Number(m)}/${Number(day)}` });
  }
  return out;
}

type UsageRow = {
  key: string;
  label: string;
  perUser: number[];
  total: number;
  avg: number;
};

/**
 * カタログ（PAGE_KEYS 等）の全項目を、利用者ごとの内訳＋合計＋平均つきで
 * 合計の多い順に並べる。一度も使われていない項目も 0 件のまま含める
 * （＝そのままテーブルの下の方＝ワーストランキングとして見える）。
 */
function buildUsageRows(
  catalog: TrackedKey[],
  usageByKey: Map<string, Map<string, number>>,
  userIds: string[],
): UsageRow[] {
  return catalog
    .map(({ key, label }) => {
      const byUser = usageByKey.get(key);
      const perUser = userIds.map((uid) => byUser?.get(uid) ?? 0);
      const total = perUser.reduce((a, b) => a + b, 0);
      const avg = userIds.length > 0 ? total / userIds.length : 0;
      return { key, label, perUser, total, avg };
    })
    .sort((a, b) => b.total - a.total);
}

/**
 * 利用状況の表（項目 × 利用者のマトリクス）。合計の多い順に並んでいるので、
 * 上のほうがランキング、下のほう（特に 0 件）がワーストランキングとして読める。
 * 「ユーザー別」＝各列、「一ユーザーあたり」＝平均列、「全体の総数」＝合計列。
 */
function UsageMatrix({
  title,
  hint,
  rows,
  userLabels,
}: {
  title: string;
  hint?: string;
  rows: UsageRow[];
  userLabels: string[];
}) {
  if (rows.length === 0) return null;
  const usedCount = rows.filter((r) => r.total > 0).length;
  return (
    <div className="space-y-2">
      <h3 className="flex items-center gap-1.5 text-sm font-semibold">
        {title}
        <span className="text-xs font-normal text-muted">
          （使われたことがあるもの {usedCount} / {rows.length}）
        </span>
      </h3>
      {hint && <p className="text-[11px] text-muted">{hint}</p>}
      <div className="overflow-x-auto rounded-2xl border border-border bg-surface shadow-sm">
        <table className="w-full text-left text-[11px]">
          <thead className="border-b border-border bg-surface-muted text-muted">
            <tr>
              <th className="sticky left-0 whitespace-nowrap bg-surface-muted px-3 py-2 font-medium">
                多い順（下ほどワースト）
              </th>
              {userLabels.map((label, i) => (
                <th
                  key={i}
                  className="whitespace-nowrap px-2 py-2 text-center font-medium"
                >
                  {label}
                </th>
              ))}
              <th className="whitespace-nowrap px-3 py-2 text-right font-medium">
                合計
              </th>
              <th className="whitespace-nowrap px-3 py-2 text-right font-medium">
                1人あたり平均
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((r) => (
              <tr key={r.key} className={r.total === 0 ? "opacity-50" : undefined}>
                <td className="sticky left-0 whitespace-nowrap bg-surface px-3 py-2 font-medium text-foreground">
                  {r.label}
                </td>
                {r.perUser.map((n, i) => (
                  <td
                    key={i}
                    className="whitespace-nowrap px-2 py-2 text-center tabular-nums text-muted"
                  >
                    {n > 0 ? n : "・"}
                  </td>
                ))}
                <td className="whitespace-nowrap px-3 py-2 text-right font-semibold tabular-nums">
                  {r.total}
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-muted">
                  {r.avg.toFixed(1)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default async function AdminPage({
  searchParams,
}: {
  searchParams: Promise<{ a?: string }>;
}) {
  const me = await getCurrentUser();
  if (!me) redirect("/");
  if (!isAdminEmail(me.email)) notFound();

  // ここまでは「管理者アカウントでログイン中」の確認。ここから先は
  // 「たった今 Google に再ログインしてきたか」を毎回確かめる（使い切りトークン）。
  // 無ければ常に Google 再ログインへ飛ばすので、非管理者には何も見せない。
  const { a } = await searchParams;
  const verifiedJustNow = await consumeAdminLoginToken(a, me.id);
  if (!verifiedJustNow) {
    redirect("/api/auth/google?dest=admin");
  }

  const now = new Date();
  const todayKey = jstDayKey(now);
  const days = recentDayKeys(DAYS_SHOWN, now);

  const [
    users,
    feedback,
    eventCount,
    failureLogCount,
    checklistEvents,
    savingsByUser,
    activityByUser,
    activityByUserDay,
    usageByKeyUser,
  ] = await Promise.all([
    prisma.user.findMany({
      orderBy: { createdAt: "asc" },
      include: {
        googleAccount: {
          select: { googleAccountEmail: true, writeDescriptionEnabled: true },
        },
        _count: {
          select: {
            events: true,
            failureLogs: true,
            pushSubscriptions: true,
            feedback: true,
          },
        },
      },
    }),
    prisma.feedback.findMany({
      orderBy: { createdAt: "desc" },
      include: { user: { select: { id: true, email: true, name: true } } },
    }),
    prisma.event.count(),
    prisma.failureLog.count(),
    // 準備リストの項目が1件でもある予定を持つユーザー（=はじめかたの「リスト確認」済み）。
    prisma.event.findMany({
      where: { checklistItems: { some: {} } },
      select: { userId: true },
      distinct: ["userId"],
    }),
    prisma.savingsEntry.groupBy({
      by: ["userId"],
      where: { confirmedByUser: true },
      _sum: { amountYen: true },
    }),
    // 利用時間（累計＝行数）＋最終アクセス。
    prisma.activityMinute.groupBy({
      by: ["userId"],
      _count: { _all: true },
      _max: { minuteAt: true },
    }),
    // 日別の利用時間（1行=1分）。全期間ぶん取って「アクティブ日数」も同じ結果から出す。
    prisma.activityMinute.groupBy({
      by: ["userId", "dayKey"],
      _count: { _all: true },
    }),
    // ページ・機能・ⓘ・案内ポップアップの利用状況（すべて FeatureEvent に集約）。
    prisma.featureEvent.groupBy({
      by: ["userId", "eventKey"],
      _count: { _all: true },
    }),
  ]);

  const hasChecklistSet = new Set(checklistEvents.map((e) => e.userId));
  const savingsMap = new Map(
    savingsByUser.map((s) => [s.userId, s._sum.amountYen ?? 0]),
  );
  const activityMap = new Map(
    activityByUser.map((a) => [
      a.userId,
      { totalMinutes: a._count._all, lastActiveAt: a._max.minuteAt },
    ]),
  );
  const minutesByUserDay = new Map<string, Map<string, number>>();
  const activeDaysByUser = new Map<string, number>();
  for (const row of activityByUserDay) {
    let m = minutesByUserDay.get(row.userId);
    if (!m) {
      m = new Map();
      minutesByUserDay.set(row.userId, m);
    }
    m.set(row.dayKey, row._count._all);
    activeDaysByUser.set(row.userId, (activeDaysByUser.get(row.userId) ?? 0) + 1);
  }
  const feedbackByUser = new Map<string, typeof feedback>();
  for (const f of feedback) {
    if (!f.user) continue;
    const arr = feedbackByUser.get(f.user.id) ?? [];
    arr.push(f);
    feedbackByUser.set(f.user.id, arr);
  }

  // ページ・機能・ⓘ・案内ポップアップの利用状況: eventKey → userId → 回数。
  const usageByKey = new Map<string, Map<string, number>>();
  for (const row of usageByKeyUser) {
    let m = usageByKey.get(row.eventKey);
    if (!m) {
      m = new Map();
      usageByKey.set(row.eventKey, m);
    }
    m.set(row.userId, row._count._all);
  }

  const rows = users.map((u) => {
    const activity = activityMap.get(u.id);
    const byDay = minutesByUserDay.get(u.id);
    const signupDays = daysSince(u.createdAt, now);
    const activeDays = activeDaysByUser.get(u.id) ?? 0;
    const steps = {
      step1Google: !!u.googleAccount,
      step2Event: u._count.events > 0,
      step3List: hasChecklistSet.has(u.id),
      step5Notify: u._count.pushSubscriptions > 0,
      tutorial: !!u.tutorialSeenAt,
    };
    const onboardingDone =
      steps.step1Google && steps.step2Event && steps.step3List && steps.step5Notify;
    return {
      id: u.id,
      email: u.email,
      name: u.name,
      createdAt: u.createdAt,
      signupDays,
      steps,
      onboardingDone,
      eventCount: u._count.events,
      failureLogCount: u._count.failureLogs,
      savingsYen: savingsMap.get(u.id) ?? 0,
      todayMinutes: byDay?.get(todayKey) ?? 0,
      totalMinutes: activity?.totalMinutes ?? 0,
      activeDays,
      // 経過日数のうち実際にアプリを開いた日の割合（継続率の目安）。登録当日は 1 日扱い。
      activeDayRatio: activity ? activeDays / Math.max(1, signupDays + 1) : 0,
      lastActiveAt: activity?.lastActiveAt ?? null,
      wtpYen:
        feedbackByUser.get(u.id)?.find((f) => f.wtpYen !== null)?.wtpYen ?? null,
      byDay: days.map((d) => byDay?.get(d.key) ?? 0),
    };
  });

  const userIds = users.map((u) => u.id);
  const userLabels = rows.map((r) => r.name || r.email.split("@")[0]);
  const pageUsageRows = buildUsageRows(PAGE_KEYS, usageByKey, userIds);
  const featureUsageRows = buildUsageRows(FEATURE_KEYS, usageByKey, userIds);
  const infohintUsageRows = buildUsageRows(INFOHINT_KEYS, usageByKey, userIds);
  const popupUsageRows = buildUsageRows(POPUP_KEYS, usageByKey, userIds);

  const wtp = feedback
    .map((f) => f.wtpYen)
    .filter((v): v is number => typeof v === "number")
    .sort((a, b) => a - b);
  const wtpAvg =
    wtp.length > 0 ? Math.round(wtp.reduce((a, b) => a + b, 0) / wtp.length) : 0;
  const wtpMedian =
    wtp.length > 0
      ? wtp.length % 2
        ? wtp[(wtp.length - 1) / 2]
        : Math.round((wtp[wtp.length / 2 - 1] + wtp[wtp.length / 2]) / 2)
      : 0;
  const withComment = feedback.filter((f) => f.comment).length;

  // 全体サマリー（利用者全体で役立つもの）。
  const activeUserCount = rows.filter((r) => r.totalMinutes > 0).length;
  const dau = rows.filter((r) => r.todayMinutes > 0).length;
  const wau = rows.filter((r) =>
    days.slice(-7).some((d) => (minutesByUserDay.get(r.id)?.get(d.key) ?? 0) > 0),
  ).length;
  const onboardingDoneCount = rows.filter((r) => r.onboardingDone).length;
  const googleConnectedCount = rows.filter((r) => r.steps.step1Google).length;
  const notifyOnCount = rows.filter((r) => r.steps.step5Notify).length;
  const avgTotalMinutes =
    users.length > 0
      ? Math.round(rows.reduce((s, r) => s + r.totalMinutes, 0) / users.length)
      : 0;
  const avgActiveDayRatio =
    activeUserCount > 0
      ? rows.reduce((s, r) => s + r.activeDayRatio, 0) / activeUserCount
      : 0;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">管理（運営者のみ）</h1>
        <p className="mt-1 text-sm text-muted">
          このページは ADMIN_EMAIL に一致するアカウントだけが開けます。
          個々の失敗ログ・準備リストの中身は表示せず、件数や利用時間などの集計のみ扱います。
        </p>
      </div>

      {/* ── 全体サマリー ── */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold">全体サマリー</h2>
        <div className="grid gap-3 sm:grid-cols-3">
          {[
            ["ユーザー数", String(users.length)],
            ["取り込んだ予定数", String(eventCount)],
            ["失敗ログ数", String(failureLogCount)],
            ["今日アクティブ（DAU）", `${dau} / ${users.length}`],
            ["直近7日アクティブ（WAU）", `${wau} / ${users.length}`],
            [
              "はじめかた完了（G連携+予定+リスト+通知）",
              `${onboardingDoneCount} / ${users.length}`,
            ],
            ["Google連携率", `${googleConnectedCount} / ${users.length}`],
            ["通知オン率", `${notifyOnCount} / ${users.length}`],
            ["平均累計利用時間", formatMinutes(avgTotalMinutes)],
            [
              "平均継続率（登録日数のうち利用日）",
              `${Math.round(avgActiveDayRatio * 100)}%`,
            ],
            ["フィードバック件数", String(feedback.length)],
            ["うち WTP 回答", String(wtp.length)],
            ["うちコメントあり", String(withComment)],
          ].map(([label, value]) => (
            <div
              key={label}
              className="rounded-xl border border-border bg-surface p-4 shadow-sm"
            >
              <p className="text-xs text-muted">{label}</p>
              <p className="mt-1 text-xl font-bold tabular-nums">{value}</p>
            </div>
          ))}
        </div>

        {wtp.length > 0 && (
          <div className="rounded-2xl border border-border bg-surface p-5 shadow-sm">
            <h3 className="text-sm font-semibold">WTP（月いくらなら払う）</h3>
            <div className="mt-2 flex flex-wrap gap-x-6 gap-y-1 text-sm">
              <span>
                中央値 <strong>{formatYen(wtpMedian)}</strong>
              </span>
              <span>
                平均 <strong>{formatYen(wtpAvg)}</strong>
              </span>
              <span>
                最小 {formatYen(wtp[0])} / 最大 {formatYen(wtp[wtp.length - 1])}
              </span>
            </div>
            <p className="mt-2 text-xs text-muted">回答: {wtp.join(" / ")}</p>
          </div>
        )}
      </section>

      {/* ── 利用者別アナリティクス ── */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold">利用者別アナリティクス</h2>
        <div className="overflow-x-auto rounded-2xl border border-border bg-surface shadow-sm">
          <table className="w-full min-w-[860px] text-left text-xs">
            <thead className="border-b border-border bg-surface-muted text-muted">
              <tr>
                <th className="whitespace-nowrap px-3 py-2 font-medium">利用者</th>
                <th className="whitespace-nowrap px-3 py-2 font-medium">登録日</th>
                <th className="whitespace-nowrap px-3 py-2 font-medium">
                  はじめかた
                </th>
                <th className="whitespace-nowrap px-3 py-2 font-medium">予定</th>
                <th className="whitespace-nowrap px-3 py-2 font-medium">失敗ログ</th>
                <th className="whitespace-nowrap px-3 py-2 font-medium">節約額</th>
                <th className="whitespace-nowrap px-3 py-2 font-medium">
                  今日の利用
                </th>
                <th className="whitespace-nowrap px-3 py-2 font-medium">
                  累計利用時間
                </th>
                <th className="whitespace-nowrap px-3 py-2 font-medium">
                  アクティブ日数
                </th>
                <th className="whitespace-nowrap px-3 py-2 font-medium">
                  最終アクセス
                </th>
                <th className="whitespace-nowrap px-3 py-2 font-medium">WTP</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="whitespace-nowrap px-3 py-2">
                    <p className="font-medium text-foreground">
                      {r.name || "（名前未設定）"}
                    </p>
                    <p className="text-[11px] text-muted">{r.email}</p>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-muted">
                    {formatDateOnly(r.createdAt)}
                    <br />
                    {r.signupDays}日前
                  </td>
                  <td className="whitespace-nowrap px-3 py-2">
                    <div className="flex flex-wrap gap-1">
                      <StepBadge ok={r.steps.step1Google} label="連携" />
                      <StepBadge ok={r.steps.step2Event} label="予定" />
                      <StepBadge ok={r.steps.step3List} label="リスト" />
                      <StepBadge ok={r.steps.step5Notify} label="通知" />
                      <StepBadge ok={r.steps.tutorial} label="導入" />
                    </div>
                    <p className="mt-0.5 text-[10px] text-muted">
                      ホーム画面追加は端末側の自己申告のみで管理画面では不明
                    </p>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 tabular-nums">
                    {r.eventCount}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 tabular-nums">
                    {r.failureLogCount}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 tabular-nums">
                    {formatYen(r.savingsYen)}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 tabular-nums">
                    {formatMinutes(r.todayMinutes)}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 tabular-nums">
                    {formatMinutes(r.totalMinutes)}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 tabular-nums">
                    {r.activeDays}日
                    <span className="text-muted">
                      {" "}
                      ({Math.round(r.activeDayRatio * 100)}%)
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-muted">
                    {r.lastActiveAt ? fmtDateTime(r.lastActiveAt) : "—"}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 tabular-nums">
                    {r.wtpYen !== null ? formatYen(r.wtpYen) : "—"}
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={11} className="px-3 py-6 text-center text-muted">
                    まだユーザーがいません。
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <p className="text-[11px] text-muted">
          「アクティブ日数」の（%）は登録からの経過日数のうち実際に開いた日の割合です。
          「今日の利用」「累計利用時間」はログイン中のアクセスを1分単位で数えた近似値で、
          ページの中身や操作内容は記録していません。
        </p>
      </section>

      {/* ── 利用者別・日付別の利用時間 ── */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold">
          利用者別・日付別の利用時間（直近{DAYS_SHOWN}日）
        </h2>
        <div className="overflow-x-auto rounded-2xl border border-border bg-surface shadow-sm">
          <table className="w-full text-left text-[11px]">
            <thead className="border-b border-border bg-surface-muted text-muted">
              <tr>
                <th className="sticky left-0 whitespace-nowrap bg-surface-muted px-3 py-2 font-medium">
                  利用者
                </th>
                {days.map((d) => (
                  <th
                    key={d.key}
                    className={`whitespace-nowrap px-2 py-2 text-center font-medium ${
                      d.key === todayKey ? "text-teal-dark" : ""
                    }`}
                  >
                    {d.label}
                  </th>
                ))}
                <th className="whitespace-nowrap px-3 py-2 text-right font-medium">
                  累計
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="sticky left-0 whitespace-nowrap bg-surface px-3 py-2 font-medium text-foreground">
                    {r.name || r.email}
                  </td>
                  {r.byDay.map((min, i) => (
                    <td
                      key={days[i].key}
                      className="whitespace-nowrap px-2 py-2 text-center tabular-nums text-muted"
                    >
                      {min > 0 ? formatMinutes(min) : "・"}
                    </td>
                  ))}
                  <td className="whitespace-nowrap px-3 py-2 text-right font-medium tabular-nums">
                    {formatMinutes(r.totalMinutes)}
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={DAYS_SHOWN + 2} className="px-3 py-6 text-center text-muted">
                    まだユーザーがいません。
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* ── 利用状況ランキング（ページ・機能・ⓘ・案内ポップアップ） ── */}
      <section className="space-y-6">
        <div>
          <h2 className="text-sm font-semibold">利用状況ランキング</h2>
          <p className="mt-1 text-[11px] text-muted">
            どの表も「利用者ごとの回数」「1人あたり平均」「全体の合計」を同時に見られ、
            合計の多い順に並んでいます。上位＝よく使われている、下位（特に0件）＝
            ワーストランキング（ほぼ使われていない・気づかれていない機能）として読めます。
          </p>
        </div>

        <UsageMatrix
          title="ページ閲覧"
          rows={pageUsageRows}
          userLabels={userLabels}
        />
        <UsageMatrix
          title="機能の利用"
          hint="話して作る・一括追加・カテゴリ作成/削除・通知テストなど、押された/使われた回数。"
          rows={featureUsageRows}
          userLabels={userLabels}
        />
        <UsageMatrix
          title="ⓘ 説明ポップアップ"
          hint="各画面のⓘボタンが実際に押されて開かれた回数。"
          rows={infohintUsageRows}
          userLabels={userLabels}
        />
        <UsageMatrix
          title="案内ポップアップ（表示・スキップ・最後まで見た）"
          hint="導入チュートリアル・はじめかた誘導・コーチマークの表示回数と、スキップされた/されなかった（最後まで見た）回数。「表示」に対して「スキップ」が多いほど、早々に離脱されていることを示します。"
          rows={popupUsageRows}
          userLabels={userLabels}
        />
      </section>

      {/* ── フィードバック一覧 ── */}
      <section className="space-y-2">
        <h2 className="text-sm font-semibold">フィードバック一覧（新しい順）</h2>
        {feedback.length === 0 ? (
          <p className="rounded-xl border border-border bg-surface p-4 text-sm text-muted">
            まだフィードバックはありません。
          </p>
        ) : (
          <ul className="space-y-2">
            {feedback.map((f) => (
              <li
                key={f.id}
                className="rounded-xl border border-border bg-surface p-4 shadow-sm"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                  <span className="text-sm font-medium">
                    {f.wtpYen !== null ? `月 ${formatYen(f.wtpYen)}` : "金額なし"}
                  </span>
                  <span className="text-xs text-muted">
                    {fmtDateTime(f.createdAt)}
                    {f.screen ? ` ・ ${f.screen}` : ""}
                  </span>
                </div>
                {f.comment && (
                  <p className="mt-1.5 whitespace-pre-wrap break-words text-sm">
                    {f.comment}
                  </p>
                )}
                <p className="mt-1.5 text-[11px] text-muted">
                  {f.user?.name ? `${f.user.name}（${f.user.email}）` : f.user?.email}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function StepBadge({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span
      className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${
        ok
          ? "bg-teal-soft text-teal-dark"
          : "border border-border text-muted"
      }`}
    >
      {ok ? "✓" : "・"} {label}
    </span>
  );
}
