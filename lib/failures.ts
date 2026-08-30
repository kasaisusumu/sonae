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

type EventLike = {
  id: string;
  userId: string;
  title: string;
  eventDatetime: Date;
  categoryId: string | null;
  failureWarningAckAt: Date | null;
  category?: { name: string } | null;
};

/**
 * ある予定に表示すべき再発防止警告。ack 済み・失敗ログなしなら null。
 * 予定オブジェクトを渡すと再フェッチしない（詳細ページ用）。
 */
export async function getWarningForEvent(
  eventOrId: string | EventLike,
): Promise<EventWarning | null> {
  const event =
    typeof eventOrId === "string"
      ? await prisma.event.findUnique({
          where: { id: eventOrId },
          include: { category: true },
        })
      : eventOrId;

  if (!event || !event.categoryId || event.failureWarningAckAt) return null;

  const [logs, savings] = await Promise.all([
    prisma.failureLog.findMany({
      where: { userId: event.userId, categoryId: event.categoryId },
      orderBy: { occurredAt: "desc" },
    }),
    prisma.savingsEntry.findMany({
      where: { eventId: event.id },
      select: { failureLogId: true },
    }),
  ]);
  if (logs.length === 0) return null;

  const preventedIds = new Set(savings.map((s) => s.failureLogId));
  const categoryName =
    ("category" in event && event.category?.name) || "その他";

  return {
    event: {
      id: event.id,
      title: event.title,
      eventDatetime: event.eventDatetime,
      categoryName,
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

/**
 * ダッシュボード用: これからの予定のうち再発防止警告が出ているもの。
 * N+1 を避け、まとめて 4 クエリで済ませる。
 */
export async function getUpcomingWarnings(userId: string): Promise<EventWarning[]> {
  const [events, failureCats] = await Promise.all([
    prisma.event.findMany({
      where: {
        userId,
        eventDatetime: { gte: new Date() },
        failureWarningAckAt: null,
        categoryId: { not: null },
      },
      orderBy: { eventDatetime: "asc" },
      take: 20,
      include: { category: true },
    }),
    prisma.failureLog.findMany({
      where: { userId, categoryId: { not: null } },
      select: { categoryId: true },
      distinct: ["categoryId"],
    }),
  ]);

  const riskyCatIds = new Set(
    failureCats.map((f) => f.categoryId).filter((v): v is string => v !== null),
  );
  const risky = events.filter(
    (e) => e.categoryId && riskyCatIds.has(e.categoryId),
  );
  if (risky.length === 0) return [];

  const catIds = [...new Set(risky.map((e) => e.categoryId!))];
  const eventIds = risky.map((e) => e.id);

  const [logs, savings] = await Promise.all([
    prisma.failureLog.findMany({
      where: { userId, categoryId: { in: catIds } },
      orderBy: { occurredAt: "desc" },
    }),
    prisma.savingsEntry.findMany({
      where: { eventId: { in: eventIds } },
      select: { eventId: true, failureLogId: true },
    }),
  ]);

  const logsByCat = new Map<string, typeof logs>();
  for (const l of logs) {
    if (!l.categoryId) continue;
    const arr = logsByCat.get(l.categoryId) ?? [];
    arr.push(l);
    logsByCat.set(l.categoryId, arr);
  }
  const preventedByEvent = new Map<string, Set<string | null>>();
  for (const s of savings) {
    if (!s.eventId) continue;
    const set = preventedByEvent.get(s.eventId) ?? new Set();
    set.add(s.failureLogId);
    preventedByEvent.set(s.eventId, set);
  }

  return risky
    .map((e) => {
      const catLogs = logsByCat.get(e.categoryId!) ?? [];
      if (catLogs.length === 0) return null;
      const prevented = preventedByEvent.get(e.id) ?? new Set();
      return {
        event: {
          id: e.id,
          title: e.title,
          eventDatetime: e.eventDatetime,
          categoryName: e.category?.name ?? "その他",
        },
        logs: catLogs.map((l) => ({
          id: l.id,
          description: l.description,
          estimatedLossYen: l.estimatedLossYen,
          occurredAt: l.occurredAt,
          prevented: prevented.has(l.id),
        })),
      } satisfies EventWarning;
    })
    .filter((w): w is EventWarning => w !== null);
}
