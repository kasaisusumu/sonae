import { prisma } from "@/lib/prisma";
import { resolveCategoryForEvent } from "@/lib/categories";
import { fetchUpcomingEvents } from "@/lib/google";

export interface SyncResult {
  newEvents: { id: string; title: string; eventDatetime: Date }[];
  updatedCount: number;
  isFirstSync: boolean;
}

/**
 * 1 ユーザーの Google カレンダーを取り込む。
 * 手動同期（サーバーアクション）と定期ポーリング（cron）の両方から使う。
 */
export async function syncUserCalendar(userId: string): Promise<SyncResult> {
  const account = await prisma.userGoogleAccount.findUnique({ where: { userId } });
  if (!account) throw new Error("Google アカウントが未接続です。");

  const isFirstSync = account.lastSyncedAt === null;
  const { events } = await fetchUpcomingEvents(userId);

  const newEvents: SyncResult["newEvents"] = [];
  let updatedCount = 0;
  let aiBudget = 12; // 1 回の同期で AI カテゴリ判定を使う上限（タイムアウト対策）

  for (const ev of events) {
    const existing = await prisma.event.findUnique({
      where: { googleEventId: ev.googleEventId },
    });

    if (existing) {
      // カテゴリはユーザーが直している可能性があるので上書きしない。
      await prisma.event.update({
        where: { id: existing.id },
        data: {
          title: ev.title,
          eventDatetime: ev.start,
          endDatetime: ev.end,
          memo: ev.description,
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
      const created = await prisma.event.create({
        data: {
          userId,
          categoryId: category.id,
          title: ev.title,
          eventDatetime: ev.start,
          endDatetime: ev.end,
          memo: ev.description,
          googleEventId: ev.googleEventId,
          source: "google",
        },
      });
      newEvents.push({
        id: created.id,
        title: created.title,
        eventDatetime: created.eventDatetime,
      });
    }
  }

  await prisma.userGoogleAccount.update({
    where: { userId },
    data: { lastSyncedAt: new Date() },
  });

  return { newEvents, updatedCount, isFirstSync };
}
