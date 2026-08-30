import Link from "next/link";
import { after } from "next/server";
import { getCurrentUser } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { formatYen } from "@/lib/format";
import { isDevLoginEnabled } from "@/lib/dev-login";
import { getUpcomingWarnings } from "@/lib/failures";
import { primeNotifiedChecklists } from "@/lib/checklist";

// after() で準備リストを先行生成することがあるため長めに
export const maxDuration = 60;

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ auth?: string }>;
}) {
  const { auth } = await searchParams;
  const user = await getCurrentUser();
  const authMessage =
    auth === "config"
      ? "Google 連携の設定（環境変数）が未完了です。GOOGLE_CLIENT_ID などを確認してください。"
      : auth === "failed"
        ? "ログインに失敗しました。もう一度お試しください。"
        : null;

  if (!user) {
    return (
      <div className="mx-auto max-w-md text-center">
        <h1 className="text-2xl font-semibold text-teal-dark">
          予定の準備を、わすれない。
        </h1>
        <p className="mt-4 text-muted">
          Google
          カレンダーの予定から、必要な準備リストを自動でつくります。あなたの編集を覚えて、少しずつ「自分に合ったリスト」に育っていきます。
        </p>

        {authMessage && (
          <p className="mt-4 rounded-lg bg-warn-soft px-4 py-3 text-sm text-warn">
            {authMessage}
          </p>
        )}

        <a
          href="/api/auth/google"
          className="mt-8 inline-flex items-center justify-center rounded-xl bg-teal px-6 py-3 font-medium text-white no-underline transition-colors hover:bg-teal-dark"
        >
          Google でログイン
        </a>
        <p className="mt-3 text-xs text-muted">
          カレンダーは基本は読み取りのみ。設定でオンにしたときだけ、予定の説明欄に準備リストを追記します。
        </p>

        {isDevLoginEnabled() && (
          <p className="mt-6 text-xs text-muted">
            <a href="/api/auth/dev-login" className="underline">
              開発用ログイン
            </a>
            （Google 連携なしで手動登録から試す・本番では無効）
          </p>
        )}
      </div>
    );
  }

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  const [upcoming, savingsAgg, warnings] = await Promise.all([
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
    prisma.savingsEntry.aggregate({
      where: {
        userId: user.id,
        confirmedByUser: true,
        createdAt: { gte: monthStart },
      },
      _sum: { amountYen: true },
    }),
    getUpcomingWarnings(user.id),
  ]);

  const monthlySavings = savingsAgg._sum.amountYen ?? 0;

  // 表示後に、通知済みで準備リスト未作成の予定を先行生成（レスポンスはブロックしない）
  after(() => primeNotifiedChecklists(user.id));

  return (
    <div className="space-y-8">
      <Link
        href="/savings"
        className="block rounded-2xl bg-teal-soft px-6 py-5 no-underline transition-colors hover:bg-teal-soft/70"
      >
        <p className="text-sm text-teal-dark">今月の推定節約額（参考値）</p>
        <p className="mt-1 text-4xl font-bold text-teal-dark">
          {formatYen(monthlySavings)}
        </p>
        <p className="mt-2 text-xs text-muted">
          失敗ログから「防げた」と確認した項目の推定損失額の合計です。断定ではなく目安として表示しています。内訳を見る →
        </p>
      </Link>

      {warnings.length > 0 && (
        <section className="rounded-2xl border border-warn/30 bg-warn-soft p-5">
          <h2 className="text-sm font-semibold text-warn">
            気をつけたい予定があります
          </h2>
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
                    {w.event.categoryName} で過去に「
                    {w.logs[0]?.description.slice(0, 30)}
                    {(w.logs[0]?.description.length ?? 0) > 30 ? "…" : ""}」
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
              予定を取り込む
            </Link>
          </p>
        ) : (
          <ul className="space-y-2">
            {upcoming.map((ev) => {
              const done = ev.checklistItems.filter((c) => c.isDone).length;
              return (
                <li key={ev.id}>
                  <Link
                    href={`/events/${ev.id}`}
                    className="flex items-center justify-between gap-3 rounded-xl bg-surface px-4 py-3 no-underline transition-colors hover:bg-surface-muted"
                  >
                    <span>
                      <span className="block font-medium text-foreground">
                        {ev.title}
                      </span>
                      <span className="block text-xs text-muted">
                        {formatDateTime(ev.eventDatetime)}
                        {ev.category ? ` ・ ${ev.category.name}` : ""}
                      </span>
                    </span>
                    <span className="shrink-0 text-xs text-muted">
                      準備 {done}/{ev.checklistItems.length}
                    </span>
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
    month: "numeric",
    day: "numeric",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}
