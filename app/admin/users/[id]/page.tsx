import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { jstDayKey } from "@/lib/activity";
import { requireAdminVerified } from "@/lib/require-admin";

/**
 * 管理画面・利用者別アナリティクスの「詳細」から開く、1 利用者ぶんの全期間の
 * 利用履歴（カレンダー形式）。個々のページ内容・操作内容は記録・表示しない
 * （「その日アプリを使ったか・何分くらいか」だけ）。§11 の方針（本文は載せない）に合わせる。
 */
export const dynamic = "force-dynamic";

function formatMinutes(min: number): string {
  if (min <= 0) return "0分";
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h === 0) return `${m}分`;
  if (m === 0) return `${h}時間`;
  return `${h}時間${m}分`;
}

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

/** JST の年月キー "YYYY-MM"。 */
function jstMonthKey(d: Date): string {
  return jstDayKey(d).slice(0, 7);
}

/** start〜end の月を新しい→古い順に列挙（"YYYY-MM"）。 */
function monthKeysDesc(startMonthKey: string, endMonthKey: string): string[] {
  const out: string[] = [];
  let [y, m] = endMonthKey.split("-").map(Number);
  const [sy, sm] = startMonthKey.split("-").map(Number);
  while (y > sy || (y === sy && m >= sm)) {
    out.push(`${y}-${String(m).padStart(2, "0")}`);
    m -= 1;
    if (m === 0) {
      m = 12;
      y -= 1;
    }
  }
  return out;
}

/** 活動量 → 色の濃さ（白黒基調の例外として、この画面だけ teal の濃淡で見やすくする）。 */
function intensityClass(minutes: number): string {
  if (minutes <= 0) return "bg-surface-muted text-muted";
  if (minutes < 15) return "bg-teal-soft text-teal-dark";
  if (minutes < 60) return "bg-[var(--teal)]/40 text-teal-dark font-medium";
  return "bg-[var(--teal)] text-white font-semibold";
}

/** 1 か月ぶんのカレンダー（日曜始まり）。日ごとの分数は dayMinutes から。 */
function MonthCalendar({
  monthKey,
  dayMinutes,
}: {
  monthKey: string;
  dayMinutes: Map<string, number>;
}) {
  const [y, m] = monthKey.split("-").map(Number);
  const firstWeekday = new Date(y, m - 1, 1).getDay(); // 0=日
  const daysInMonth = new Date(y, m, 0).getDate();
  const cells: (number | null)[] = [
    ...Array(firstWeekday).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];
  while (cells.length % 7 !== 0) cells.push(null);

  let monthTotal = 0;
  let activeDays = 0;
  for (const min of dayMinutes.values()) {
    monthTotal += min;
    if (min > 0) activeDays++;
  }

  return (
    <div className="rounded-xl border border-border bg-surface p-3 shadow-sm">
      <div className="mb-2 flex items-baseline justify-between">
        <p className="text-sm font-semibold text-foreground">
          {y}年{m}月
        </p>
        <p className="text-[11px] text-muted">
          {activeDays}日利用・計{formatMinutes(monthTotal)}
        </p>
      </div>
      <div className="grid grid-cols-7 gap-1 text-center text-[10px]">
        {["日", "月", "火", "水", "木", "金", "土"].map((w) => (
          <div key={w} className="text-muted">
            {w}
          </div>
        ))}
        {cells.map((day, i) => {
          if (day === null) return <div key={i} />;
          const key = `${monthKey}-${String(day).padStart(2, "0")}`;
          const min = dayMinutes.get(key) ?? 0;
          return (
            <div
              key={i}
              title={`${key}: ${formatMinutes(min)}`}
              className={`flex aspect-square items-center justify-center rounded ${intensityClass(min)}`}
            >
              {day}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default async function AdminUserDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ err?: string; who?: string }>;
}) {
  const admin = await requireAdminVerified(await searchParams);
  if (!admin.ok) return admin.node;

  const { id } = await params;
  const user = await prisma.user.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      email: true,
      createdAt: true,
      googleAccount: {
        select: {
          googleAccountEmail: true,
          lastSyncedAt: true,
          syncError: true,
          syncErrorAt: true,
        },
      },
    },
  });
  if (!user) notFound();

  const [dayRows, totalAgg, feedbackRows] = await Promise.all([
    prisma.activityMinute.groupBy({
      by: ["dayKey"],
      where: { userId: id },
      _count: { _all: true },
    }),
    prisma.activityMinute.aggregate({
      where: { userId: id },
      _count: { _all: true },
      _max: { minuteAt: true },
    }),
    prisma.feedback.findMany({
      where: { userId: id },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true, wtpYen: true, comment: true },
    }),
  ]);

  const dayMinutes = new Map(dayRows.map((r) => [r.dayKey, r._count._all]));
  const now = new Date();
  const startMonthKey = jstMonthKey(user.createdAt);
  const endMonthKey = jstMonthKey(now);
  const months = monthKeysDesc(startMonthKey, endMonthKey);

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/admin"
          className="text-xs text-muted underline hover:text-foreground"
        >
          ← 管理画面にもどる
        </Link>
        <h1 className="mt-2 text-xl font-semibold tracking-tight">
          {user.name || "（名前未設定）"}
        </h1>
        <p className="text-sm text-muted">{user.email}</p>
      </div>

      <section className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-border bg-surface p-4 shadow-sm">
          <p className="text-xs text-muted">登録日</p>
          <p className="mt-1 text-sm font-medium">{fmtDateTime(user.createdAt)}</p>
        </div>
        <div className="rounded-xl border border-border bg-surface p-4 shadow-sm">
          <p className="text-xs text-muted">累計利用時間・最終アクセス</p>
          <p className="mt-1 text-sm font-medium">
            {formatMinutes(totalAgg._count._all)}
          </p>
          <p className="text-[11px] text-muted">
            {totalAgg._max.minuteAt ? fmtDateTime(totalAgg._max.minuteAt) : "—"}
          </p>
        </div>
        <div className="rounded-xl border border-border bg-surface p-4 shadow-sm">
          <p className="text-xs text-muted">Google 連携</p>
          {user.googleAccount ? (
            <>
              <p className="mt-1 text-sm font-medium">
                {user.googleAccount.googleAccountEmail}
              </p>
              {user.googleAccount.syncError ? (
                <p className="mt-0.5 rounded bg-warn-soft px-1.5 py-0.5 text-[11px] text-warn">
                  ⚠ 連携切れ
                  {user.googleAccount.syncErrorAt &&
                    `（${fmtDateTime(user.googleAccount.syncErrorAt)}ごろから）`}
                </p>
              ) : (
                <p className="text-[11px] text-muted">
                  最終取り込み{" "}
                  {user.googleAccount.lastSyncedAt
                    ? fmtDateTime(user.googleAccount.lastSyncedAt)
                    : "未取り込み"}
                </p>
              )}
            </>
          ) : (
            <p className="mt-1 text-sm text-muted">未連携</p>
          )}
        </div>
      </section>

      {feedbackRows.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold">フィードバック</h2>
          <ul className="space-y-1.5 text-sm">
            {feedbackRows.map((f, i) => (
              <li
                key={i}
                className="rounded-xl border border-border bg-surface p-3"
              >
                <p className="text-[11px] text-muted">
                  {fmtDateTime(f.createdAt)}
                  {f.wtpYen !== null && ` ・ 月 ¥${f.wtpYen.toLocaleString()}`}
                </p>
                {f.comment && <p className="mt-1">{f.comment}</p>}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="space-y-3">
        <h2 className="text-sm font-semibold">
          利用履歴カレンダー（登録日から今日まで・新しい月から順）
        </h2>
        <p className="text-[11px] text-muted">
          色が濃いほどその日の利用時間が長いことを示します（ページの中身・操作内容は
          記録していません）。
        </p>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {months.map((mk) => (
            <MonthCalendar key={mk} monthKey={mk} dayMinutes={dayMinutes} />
          ))}
        </div>
      </section>
    </div>
  );
}
