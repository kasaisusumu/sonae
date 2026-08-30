import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { syncAndNotify } from "@/lib/sync";
import { verifyWatchToken } from "@/lib/google";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Google Calendar push 通知の受け口。
 * カレンダーに変更があると Google がここに POST してくる（本文は空）。
 * ヘッダのチャンネル ID とトークンで本人確認し、差分同期＋通知する。
 */
export async function POST(req: NextRequest) {
  const channelId = req.headers.get("x-goog-channel-id");
  const token = req.headers.get("x-goog-channel-token");
  const state = req.headers.get("x-goog-resource-state");

  // チャンネル開設直後の疎通確認。何もしない。
  if (state === "sync") {
    return new NextResponse(null, { status: 200 });
  }
  if (!channelId) {
    return new NextResponse(null, { status: 200 });
  }

  const account = await prisma.userGoogleAccount.findFirst({
    where: { watchChannelId: channelId },
    select: { userId: true },
  });
  if (!account || !verifyWatchToken(account.userId, token)) {
    // 不明なチャンネルには 200 を返して Google に再送させない
    return new NextResponse(null, { status: 200 });
  }

  try {
    const result = await syncAndNotify(account.userId, { generateBudget: 3 });
    return NextResponse.json({
      ok: true,
      new: result.newEvents.length,
      updated: result.updatedCount,
      deleted: result.deletedCount,
      generated: result.generated,
    });
  } catch (e) {
    console.error("[google/webhook] 同期に失敗 userId=%s", account.userId, e);
    // 500 を返すと Google がリトライする
    return new NextResponse("sync failed", { status: 500 });
  }
}
