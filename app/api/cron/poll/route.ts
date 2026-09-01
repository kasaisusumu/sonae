import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { syncAndNotify } from "@/lib/sync";
import { ensureWatch } from "@/lib/google";
import { notifyPostEventFailureChecks } from "@/lib/failures";
import {
  sendDueItemNotifications,
  sendDueListReminders,
} from "@/lib/notify-items";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * 全ユーザーのカレンダーを差分同期し、新規予定を通知する保険のポーリング。
 * あわせて push 通知の watch チャンネルを期限前に張り直す。
 * 定期実行から:
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
  let generated = 0;
  let watches = 0;
  let postChecks = 0;
  let prepNotified = 0;
  let errors = 0;
  // 1 回の実行で生成する準備リストの上限（タイムアウト対策・全ユーザー合算）
  let genBudget = 4;

  for (const { userId } of accounts) {
    try {
      const result = await syncAndNotify(userId, {
        generateBudget: Math.max(0, genBudget),
      });
      totalNew += result.newEvents.length;
      notified += result.isFirstSync ? 0 : result.newEvents.length;
      generated += result.generated;
      genBudget -= result.generated;
      if (await ensureWatch(userId)) watches++;
      postChecks += await notifyPostEventFailureChecks(userId);
    } catch (e) {
      errors++;
      console.error("[cron/poll] userId=%s の処理に失敗", userId, e);
    }
  }

  // 準備項目の「◯分前」通知＋予定単位の「準備リストのリマインド」は全ユーザー対象
  const users = await prisma.user.findMany({ select: { id: true } });
  for (const { id } of users) {
    try {
      prepNotified += await sendDueItemNotifications(id);
      prepNotified += await sendDueListReminders(id);
    } catch (e) {
      errors++;
      console.error("[cron/poll] 準備通知に失敗 userId=%s", id, e);
    }
  }

  return NextResponse.json({
    ok: true,
    accounts: accounts.length,
    totalNew,
    notified,
    generated,
    watches,
    postChecks,
    prepNotified,
    errors,
    at: new Date().toISOString(),
  });
}

export { handler as GET, handler as POST };
