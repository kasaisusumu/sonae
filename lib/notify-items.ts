import { prisma } from "@/lib/prisma";
import { sendPushToUser } from "@/lib/push";

/** 分 → 「X時間Y分前 / N日前」などの短いラベル。 */
export function leadLabel(m: number): string {
  if (m % 10080 === 0 && m >= 10080) return `${m / 10080}週間前`;
  if (m % 1440 === 0 && m >= 1440) return `${m / 1440}日前`;
  const h = Math.floor(m / 60);
  const mm = m % 60;
  if (h && mm) return `${h}時間${mm}分前`;
  if (h) return `${h}時間前`;
  return `${mm}分前`;
}

/**
 * 「予定開始の X 分前に通知」が設定された準備項目のうち、時刻が来ていてまだ送っていない
 * ものを push する。cron / webhook から呼ぶ。予定ごとにまとめて 1 通。
 */
export async function sendDueItemNotifications(
  userId: string,
  limit = 12,
): Promise<number> {
  const now = new Date();
  // 予定開始が過去 3 時間〜先の予定だけ対象（遅れて回ってきた通知の空振りを防ぐ）
  const earliestEvent = new Date(now.getTime() - 3 * 3_600_000);

  const due = await prisma.checklistItem.findMany({
    where: {
      notifyLeadMinutes: { not: null },
      notifiedAt: null,
      isDone: false,
      isSuggested: false,
      event: {
        userId,
        eventDatetime: { gte: earliestEvent },
      },
    },
    select: {
      id: true,
      title: true,
      kind: true,
      notifyLeadMinutes: true,
      event: {
        select: {
          id: true,
          title: true,
          eventDatetime: true,
          recurringEventId: true,
        },
      },
    },
    take: 200,
  });

  // 発火時刻（eventDatetime - lead）が現在以下のものだけ
  const ready = due.filter((it) => {
    const lead = it.notifyLeadMinutes ?? 0;
    const fireAt = it.event.eventDatetime.getTime() - lead * 60_000;
    return fireAt <= now.getTime();
  });
  if (ready.length === 0) return 0;

  // 予定ごとにまとめる
  const byEvent = new Map<string, typeof ready>();
  for (const it of ready) {
    const arr = byEvent.get(it.event.id) ?? [];
    arr.push(it);
    byEvent.set(it.event.id, arr);
  }

  let sent = 0;
  const seenSeries = new Set<string>();
  for (const [eventId, group] of byEvent) {
    const ev = group[0].event;
    const seriesKey = ev.recurringEventId ?? "";
    const seriesDup = seriesKey !== "" && seenSeries.has(seriesKey);

    const idsToMark = group.map((g) => g.id);
    if (sent >= limit || seriesDup) {
      // 送らないが「送信済み」にして溜め込まない
      await prisma.checklistItem.updateMany({
        where: { id: { in: idsToMark } },
        data: { notifiedAt: now },
      });
      continue;
    }
    if (seriesKey !== "") seenSeries.add(seriesKey);

    const titles = group.map((g) => g.title);
    const body =
      titles.length === 1
        ? `準備の時間です（${leadLabel(group[0].notifyLeadMinutes ?? 0)}）: ${titles[0]}`
        : `準備の時間です: ${titles.slice(0, 3).join("、")}${
            titles.length > 3 ? ` ほか${titles.length - 3}件` : ""
          }`;

    await sendPushToUser(userId, {
      title: `「${ev.title}」`,
      body,
      url: `/events/${eventId}`,
      tag: `prep-${eventId}`,
    });
    await prisma.checklistItem.updateMany({
      where: { id: { in: idsToMark } },
      data: { notifiedAt: now },
    });
    sent++;
  }
  return sent;
}

/**
 * 予定単位の「準備リストのリマインド」。予定開始の listReminderLeadMinutes 分前に
 * 「準備リストを確認しましょう」を 1 回だけ push する。cron から呼ぶ。
 */
export async function sendDueListReminders(
  userId: string,
  limit = 12,
): Promise<number> {
  const now = new Date();
  const earliestEvent = new Date(now.getTime() - 3 * 3_600_000);

  const events = await prisma.event.findMany({
    where: {
      userId,
      listReminderLeadMinutes: { not: null },
      listReminderNotifiedAt: null,
      eventDatetime: { gte: earliestEvent },
      checklistItems: { some: { isSuggested: false } },
    },
    select: {
      id: true,
      title: true,
      eventDatetime: true,
      recurringEventId: true,
      listReminderLeadMinutes: true,
      checklistItems: {
        where: { isSuggested: false },
        select: { isDone: true },
      },
    },
    orderBy: { eventDatetime: "asc" },
    take: 100,
  });

  const ready = events.filter((e) => {
    const lead = e.listReminderLeadMinutes ?? 0;
    const fireAt = e.eventDatetime.getTime() - lead * 60_000;
    return fireAt <= now.getTime();
  });
  if (ready.length === 0) return 0;

  let sent = 0;
  const seenSeries = new Set<string>();
  for (const e of ready) {
    const seriesKey = e.recurringEventId ?? "";
    const seriesDup = seriesKey !== "" && seenSeries.has(seriesKey);

    if (sent >= limit || seriesDup) {
      await prisma.event.update({
        where: { id: e.id },
        data: { listReminderNotifiedAt: now },
      });
      continue;
    }
    if (seriesKey !== "") seenSeries.add(seriesKey);

    const total = e.checklistItems.length;
    const left = e.checklistItems.filter((i) => !i.isDone).length;
    const body =
      left > 0
        ? `準備リストの確認を（未完 ${left}/${total}）`
        : `準備リストの確認を（${total}件）`;

    await sendPushToUser(userId, {
      title: `「${e.title}」`,
      body,
      url: `/events/${e.id}`,
      tag: `listreminder-${e.id}`,
    });
    await prisma.event.update({
      where: { id: e.id },
      data: { listReminderNotifiedAt: now },
    });
    sent++;
  }
  return sent;
}
