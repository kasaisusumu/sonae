import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { formatYen } from "@/lib/format";

/**
 * 運営者だけが見る管理一覧。ADMIN_EMAIL（.env / Vercel）に一致するユーザー以外は 404。
 * いまはフィードバック（WTP アンケート）の一覧と要約のみ。
 */
export const dynamic = "force-dynamic";

function isAdmin(email: string | null | undefined): boolean {
  const allow = (process.env.ADMIN_EMAIL ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return !!email && allow.includes(email.toLowerCase());
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

export default async function AdminPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/");
  if (!isAdmin(user.email)) notFound();

  const [feedback, userCount, eventCount, failureLogCount] = await Promise.all([
    prisma.feedback.findMany({
      orderBy: { createdAt: "desc" },
      include: { user: { select: { email: true, name: true } } },
    }),
    prisma.user.count(),
    prisma.event.count(),
    prisma.failureLog.count(),
  ]);

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

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">管理（運営者のみ）</h1>
        <p className="mt-1 text-sm text-muted">
          このページは ADMIN_EMAIL に一致するアカウントだけが開けます。
        </p>
      </div>

      <section className="grid gap-3 sm:grid-cols-3">
        {[
          ["ユーザー数", String(userCount)],
          ["取り込んだ予定数", String(eventCount)],
          ["失敗ログ数", String(failureLogCount)],
          ["フィードバック件数", String(feedback.length)],
          ["うち WTP 回答", String(wtp.length)],
          ["うちコメントあり", String(withComment)],
        ].map(([label, value]) => (
          <div
            key={label}
            className="rounded-xl border border-border bg-surface p-4 shadow-sm"
          >
            <p className="text-xs text-muted">{label}</p>
            <p className="mt-1 text-2xl font-bold tabular-nums">{value}</p>
          </div>
        ))}
      </section>

      {wtp.length > 0 && (
        <section className="rounded-2xl border border-border bg-surface p-5 shadow-sm">
          <h2 className="text-sm font-semibold">WTP（月いくらなら払う）</h2>
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
        </section>
      )}

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
