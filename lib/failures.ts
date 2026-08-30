import { prisma } from "@/lib/prisma";

export interface EventWarning {
  event: {
    id: string;
    title: string;
    eventDatetime: Date;
    categoryName: string;
  };
  logs: {
    id: string;
    description: string;
    estimatedLossYen: number;
    occurredAt: Date;
    prevented: boolean; // この予定で「防げた」計上済みか
  }[];
}

/** ある予定に表示すべき再発防止警告を返す。ack 済み・失敗ログなしなら null。 */
export async function getWarningForEvent(eventId: string): Promise<EventWarning | null> {
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    include: { category: true },
  });
  if (!event || !event.categoryId || event.failureWarningAckAt) return null;

  const logs = await prisma.failureLog.findMany({
    where: { userId: event.userId, categoryId: event.categoryId },
    orderBy: { occurredAt: "desc" },
  });
  if (logs.length === 0) return null;

  const savings = await prisma.savingsEntry.findMany({
    where: { eventId: event.id },
    select: { failureLogId: true },
  });
  const preventedIds = new Set(savings.map((s) => s.failureLogId));

  return {
    event: {
      id: event.id,
      title: event.title,
      eventDatetime: event.eventDatetime,
      categoryName: event.category?.name ?? "その他",
    },
    logs: logs.map((l) => ({
      id: l.id,
      description: l.description,
      estimatedLossYen: l.estimatedLossYen,
      occurredAt: l.occurredAt,
      prevented: preventedIds.has(l.id),
    })),
  };
}

/** ダッシュボード用: これからの予定のうち、再発防止警告が出ているもの。 */
export async function getUpcomingWarnings(userId: string): Promise<EventWarning[]> {
  const events = await prisma.event.findMany({
    where: {
      userId,
      eventDatetime: { gte: new Date() },
      failureWarningAckAt: null,
      categoryId: { not: null },
    },
    orderBy: { eventDatetime: "asc" },
    take: 20,
  });

  const result: EventWarning[] = [];
  for (const ev of events) {
    const w = await getWarningForEvent(ev.id);
    if (w) result.push(w);
  }
  return result;
}
