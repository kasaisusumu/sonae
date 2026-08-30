import { prisma } from "@/lib/prisma";
import { sendPushToUser } from "@/lib/push";

export interface WarningLog {
  id: string;
  description: string;
  estimatedLossYen: number;
  occurredAt: Date;
  prevented: boolean; // この予定で「防げた」計上済みか
  fromEventTitle: string | null; // このログが紐づく予定名（あれば）
}

export interface EventWarning {
  event: {
    id: string;
    title: string;
    eventDatetime: Date;
    categoryName: string;
  };
  isPast: boolean; // 予定が終わっているか（事後の「防げた？」表示に使う）
  logs: WarningLog[];
}

type EventLike = {
  id: string;
  userId: string;
  title: string;
  eventDatetime: Date;
  endDatetime?: Date | null;
  recurringEventId?: string | null;
  categoryId: string | null;
  failureWarningAckAt: Date | null;
  category?: { name: string } | null;
};

// ── 「似ている」判定（軽い語彙一致） ─────────────────
function tokenize(s: string): Set<string> {
  return new Set(
    (
      s
        .toLowerCase()
        .match(/[一-龠々〆ヵヶ]{2,}|[ァ-ヶーヴ]{2,}|[a-z0-9]{2,}/g) ?? []
    ).filter((w) => w.length >= 2),
  );
}

function shareKeyword(a: string, b: string): boolean {
  const ta = tokenize(a);
  if (ta.size === 0) return false;
  for (const t of tokenize(b)) if (ta.has(t)) return true;
  return false;
}

type LogRow = {
  id: string;
  description: string;
  estimatedLossYen: number;
  occurredAt: Date;
  eventId: string | null;
  event: { title: string; recurringEventId: string | null } | null;
};

/**
 * その失敗ログが、対象の予定に対して警告として出すべきか。
 * - 予定に紐づいていない（カテゴリ全体の記録）→ 常に対象
 * - 紐づく予定が同じ繰り返し系列 → 対象
 * - 紐づく予定名と語彙が1つでも重なる → 対象
 * それ以外（別物と思われる予定の記録）は出さない。
 */
function logApplies(
  log: LogRow,
  targetTitle: string,
  targetRecurringId: string | null | undefined,
): boolean {
  if (!log.eventId || !log.event) return true;
  if (
    log.event.recurringEventId &&
    targetRecurringId &&
    log.event.recurringEventId === targetRecurringId
  ) {
    return true;
  }
  return shareKeyword(log.event.title, targetTitle);
}

function isPastEvent(e: {
  eventDatetime: Date;
  endDatetime?: Date | null;
}): boolean {
  const end =
    e.endDatetime ?? new Date(e.eventDatetime.getTime() + 2 * 3_600_000);
  return end.getTime() <= Date.now();
}

/**
 * ある予定に表示すべき再発防止警告。
 * - 失敗ログなし → null
 * - これからの予定: ack 済みなら null（畳める）
 * - 終わった予定: ack に関わらず表示（事後に「防げた？」を答えてもらう）
 * - 「防げた」計上済みでも、次回以降の予定では警告し続ける（prevented は表示だけ）
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

  if (!event || !event.categoryId) return null;

  const past = isPastEvent(event);
  if (!past && event.failureWarningAckAt) return null;

  const [logs, savings] = await Promise.all([
    prisma.failureLog.findMany({
      where: { userId: event.userId, categoryId: event.categoryId },
      orderBy: { occurredAt: "desc" },
      include: { event: { select: { title: true, recurringEventId: true } } },
    }),
    prisma.savingsEntry.findMany({
      where: { eventId: event.id },
      select: { failureLogId: true },
    }),
  ]);

  const applicable = logs.filter((l) =>
    logApplies(l, event.title, event.recurringEventId),
  );
  if (applicable.length === 0) return null;

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
    isPast: past,
    logs: applicable.map((l) => ({
      id: l.id,
      description: l.description,
      estimatedLossYen: l.estimatedLossYen,
      occurredAt: l.occurredAt,
      prevented: preventedIds.has(l.id),
      fromEventTitle: l.event?.title ?? null,
    })),
  };
}

/**
 * ダッシュボード用: これからの予定のうち再発防止警告が出ているもの。
 * N+1 を避け、まとめて数クエリで済ませる。
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
      include: { event: { select: { title: true, recurringEventId: true } } },
    }),
    prisma.savingsEntry.findMany({
      where: { eventId: { in: eventIds } },
      select: { eventId: true, failureLogId: true },
    }),
  ]);

  const logsByCat = new Map<string, LogRow[]>();
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
      const catLogs = (logsByCat.get(e.categoryId!) ?? []).filter((l) =>
        logApplies(l, e.title, e.recurringEventId),
      );
      if (catLogs.length === 0) return null;
      const prevented = preventedByEvent.get(e.id) ?? new Set();
      return {
        event: {
          id: e.id,
          title: e.title,
          eventDatetime: e.eventDatetime,
          categoryName: e.category?.name ?? "その他",
        },
        isPast: false as boolean,
        logs: catLogs.map((l) => ({
          id: l.id,
          description: l.description,
          estimatedLossYen: l.estimatedLossYen,
          occurredAt: l.occurredAt,
          prevented: prevented.has(l.id),
          fromEventTitle: l.event?.title ?? null,
        })),
      } satisfies EventWarning;
    })
    .filter((w): w is EventWarning => w !== null);
}

/**
 * 終わった予定について「今回は防げましたか？」の通知を送る（1 予定 1 回）。
 * cron から呼ぶ。カテゴリに該当する失敗ログがある予定だけが対象。
 */
export async function notifyPostEventFailureChecks(
  userId: string,
  limit = 5,
): Promise<number> {
  const now = new Date();
  const horizon = new Date(now.getTime() - 48 * 3_600_000);

  const events = await prisma.event.findMany({
    where: {
      userId,
      categoryId: { not: null },
      postFailureCheckNotifiedAt: null,
      eventDatetime: { lte: now, gte: horizon },
    },
    orderBy: { eventDatetime: "desc" },
    take: 20,
    include: { category: true },
  });
  if (events.length === 0) return 0;

  const catIds = [...new Set(events.map((e) => e.categoryId!))];
  const logs = await prisma.failureLog.findMany({
    where: { userId, categoryId: { in: catIds } },
    orderBy: { occurredAt: "desc" },
    include: { event: { select: { title: true, recurringEventId: true } } },
  });
  const logsByCat = new Map<string, LogRow[]>();
  for (const l of logs) {
    if (!l.categoryId) continue;
    const arr = logsByCat.get(l.categoryId) ?? [];
    arr.push(l);
    logsByCat.set(l.categoryId, arr);
  }

  let sent = 0;
  const notifiedSeries = new Set<string>(); // 同じ繰り返し系列は 1 回だけ通知
  for (const e of events) {
    if (!isPastEvent(e)) continue;

    const applicable = (logsByCat.get(e.categoryId!) ?? []).filter((l) =>
      logApplies(l, e.title, e.recurringEventId),
    );

    // 通知するかどうかに関わらず、対象予定は「確認済み」にして次回から拾わない
    await prisma.event.update({
      where: { id: e.id },
      data: { postFailureCheckNotifiedAt: now },
    });

    const seriesKey = e.recurringEventId ?? "";
    const seriesDup = seriesKey !== "" && notifiedSeries.has(seriesKey);
    if (applicable.length === 0 || sent >= limit || seriesDup) continue;
    if (seriesKey !== "") notifiedSeries.add(seriesKey);

    const top = applicable[0];
    const short =
      top.description.length > 24
        ? `${top.description.slice(0, 24)}…`
        : top.description;
    await sendPushToUser(userId, {
      title: `「${e.title}」おつかれさまでした`,
      body: `前に${e.category?.name ?? "この種類"}で「${short}」がありました。今回は防げましたか？`,
      url: `/events/${e.id}#failure-check`,
      tag: `failcheck-${e.id}`,
    });
    sent++;
  }
  return sent;
}
