import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { syncUserCalendar } from "@/lib/sync";
import { sendPushToUser } from "@/lib/push";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * 全ユーザーの Google カレンダーを取り込み、新規予定があれば通知する。
 * 定期実行（GitHub Actions 等）から数分おきに叩く想定。
 *   curl -fsS -X POST -H "x-cron-secret: $CRON_SECRET" "$APP_BASE_URL/api/cron/poll"
 * ※ 前後の空白・改行はコピペ事故対策で無視する。
 */
async function handler(req: NextRequest) {
  const expected = (process.env.CRON_SECRET ?? "").trim();
  const provided = (
    req.headers.get("x-cron-secret") ??
    req.nextUrl.searchParams.get("secret") ??
    ""
  ).trim();
  if (!expected || provided !== expected) {
    // 値は返さず、切り分け用に「設定有無」と「長さ」だけ返す
    return NextResponse.json(
      {
        error: "forbidden",
        serverSecretConfigured: expected.length > 0,
        serverSecretLength: expected.length,
        receivedSecretLength: provided.length,
      },
      { status: 403 },
    );
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
