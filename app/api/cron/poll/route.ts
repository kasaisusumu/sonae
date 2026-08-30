import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { syncUserCalendar } from "@/lib/sync";
import { sendPushToUser } from "@/lib/push";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 全ユーザーの Google カレンダーを取り込み、新規予定があれば通知する。
 * Render の Cron Job から数分おきに叩く想定。
 *   curl -fsS -X POST -H "x-cron-secret: $CRON_SECRET" "$APP_BASE_URL/api/cron/poll"
 */
async function handler(req: NextRequest) {
  const expected = process.env.CRON_SECRET;
  const provided =
    req.headers.get("x-cron-secret") ??
    req.nextUrl.searchParams.get("secret") ??
    "";
  if (!expected || provided !== expected) {
    return new NextResponse("forbidden", { status: 403 });
  }

  const accounts = await prisma.userGoogleAccount.findMany({
    select: { userId: true },
  });

  let totalNew = 0;
  let notified = 0;
  let errors = 0;

  for (const { userId } of accounts) {
    try {
      const result = await syncUserCalendar(userId);
      totalNew += result.newEvents.length;

      if (!result.isFirstSync) {
        for (const ev of result.newEvents) {
          const r = await sendPushToUser(userId, {
            title: "新しい予定が追加されました",
            body: `「${ev.title}」の準備リストを確認しましょう`,
            url: `/events/${ev.id}`,
            tag: `event-${ev.id}`,
          });
          notified += r.sent;
        }
      }
    } catch (e) {
      errors++;
      console.error("[cron/poll] userId=%s の同期に失敗", userId, e);
    }
  }

  return NextResponse.json({
    ok: true,
    accounts: accounts.length,
    totalNew,
    notified,
    errors,
    at: new Date().toISOString(),
  });
}

export { handler as GET, handler as POST };
