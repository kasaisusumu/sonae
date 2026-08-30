import { prisma } from "@/lib/prisma";
import { resolveCategoryForEvent } from "@/lib/categories";
import { fetchCalendarChanges } from "@/lib/google";
import { sendPushToUser } from "@/lib/push";
import { hashDescription, stripSonaeBlock } from "@/lib/description";

export interface SyncResult {
  newEvents: { id: string; title: string; eventDatetime: Date }[];
  updatedCount: number;
  deletedCount: number;
  isFirstSync: boolean;
}

const FUTURE_LIMIT_MS = 1000 * 60 * 60 * 24 * 120; // 先 120 日まで取り込む
const PAST_LIMIT_MS = 1000 * 60 * 60 * 24 * 2; // 過去 2 日まで

/**
 * 1 ユーザーの Google カレンダーを取り込む（差分同期）。
 * 手動同期・cron・webhook から使う。
 */
export async function syncUserCalendar(userId: string): Promise<SyncResult> {
  const account = await prisma.userGoogleAccount.findUnique({ where: { userId } });
  if (!account) throw new Error("Google アカウントが未接続です。");

  const isFirstSync = account.lastSyncedAt === null;
  const { upserts, deletedIds, nextSyncToken } =
    await fetchCalendarChanges(userId);

  const newEvents: SyncResult["newEvents"] = [];
  let updatedCount = 0;
  let aiBudget = 12; // 1 回の同期で AI カテゴリ判定を使う上限（タイムアウト対策）

  const now = Date.now();
  for (const ev of upserts) {
    const t = ev.start.getTime();
    if (t < now - PAST_LIMIT_MS || t > now + FUTURE_LIMIT_MS) continue;

    const existing = await prisma.event.findUnique({
      where: { googleEventId: ev.googleEventId },
    });

    if (existing) {
      // そなえが書き込んだ内容そのものの変更なら、更新をスキップ（再書き込み・churn 防止）
      if (
        ev.description &&
        existing.lastWrittenHash &&
        hashDescription(ev.description) === existing.lastWrittenHash
      ) {
        continue;
      }
      await prisma.event.update({
        where: { id: existing.id },
        data: {
          title: ev.title,
          eventDatetime: ev.start,
          endDatetime: ev.end,
          // 「そなえ」ブロックは除いてユーザーの元メモだけ保存
          memo: stripSonaeBlock(ev.description) || null,
        },
      });
      updatedCount++;
    } else {
      const category = await resolveCategoryForEvent(
        userId,
        ev.title,
        ev.description,
        aiBudget > 0,
      );
      if (aiBudget > 0) aiBudget--;
      try {
        const created = await prisma.event.create({
          data: {
            userId,
            categoryId: category.id,
            title: ev.title,
            eventDatetime: ev.start,
            endDatetime: ev.end,
            memo: stripSonaeBlock(ev.description) || null,
            googleEventId: ev.googleEventId,
            source: "google",
          },
        });
        newEvents.push({
          id: created.id,
          title: created.title,
          eventDatetime: created.eventDatetime,
        });
      } catch (e: unknown) {
        // 別プロセス(webhook と cron の競合など)が先に作成した場合は無視
        if (
          typeof e === "object" &&
          e !== null &&
          "code" in e &&
          (e as { code?: string }).code === "P2002"
        ) {
          updatedCount++;
        } else {
          throw e;
        }
      }
    }
  }

  let deletedCount = 0;
  if (deletedIds.length > 0) {
    const del = await prisma.event.deleteMany({
      where: { userId, googleEventId: { in: deletedIds } },
    });
    deletedCount = del.count;
  }

  await prisma.userGoogleAccount.update({
    where: { userId },
    data: {
      lastSyncedAt: new Date(),
      ...(nextSyncToken ? { syncToken: nextSyncToken } : {}),
    },
  });

  return { newEvents, updatedCount, deletedCount, isFirstSync };
}

/**
 * 同期して、新規予定があれば即プッシュ通知する（準備リストは作らない）。
 * 初回同期では通知しない。cron / webhook / 手動同期の共通処理。
 */
export async function syncAndNotify(userId: string): Promise<SyncResult> {
  const result = await syncUserCalendar(userId);

  if (!result.isFirstSync && result.newEvents.length > 0) {
    for (const ev of result.newEvents) {
      const r = await sendPushToUser(userId, {
        title: "新しい予定が追加されました",
        body: `「${ev.title}」— 開くと準備リストを用意します`,
        url: `/events/${ev.id}`,
        tag: `event-${ev.id}`,
      });
      await prisma.event.update({
        where: { id: ev.id },
        data: { notifiedAt: new Date() },
      });
      if (r.sent === 0) {
        console.warn("[sync] 通知先の購読なし userId=%s", userId);
      }
    }
  }

  return result;
}
