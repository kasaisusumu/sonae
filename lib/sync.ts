import { prisma } from "@/lib/prisma";
import { resolveCategoryForEvent } from "@/lib/categories";
import { fetchCalendarChanges, type FetchedEvent } from "@/lib/google";
import { sendPushToUser } from "@/lib/push";
import { hashDescription, stripSonaeBlock } from "@/lib/description";
import { applyInboundDescription } from "@/lib/description-inbound";
import { primeNotifiedChecklists } from "@/lib/checklist";

export interface SyncResult {
  newEvents: {
    id: string;
    title: string;
    eventDatetime: Date;
    recurringEventId: string | null;
  }[];
  updatedCount: number;
  deletedCount: number;
  isFirstSync: boolean;
}

const FUTURE_LIMIT_MS = 1000 * 60 * 60 * 24 * 120; // 先 120 日まで
const PAST_LIMIT_MS = 1000 * 60 * 60 * 24 * 2; // 過去 2 日まで
const MAX_NEW_PER_RUN = 60; // 1 回の同期で作成する新規予定の上限
const MAX_PER_SERIES = 10; // 繰り返し予定は 1 系列あたり直近この件数まで
const AI_CATEGORY_BUDGET = 12;

/**
 * 1 ユーザーの Google カレンダーを取り込む（差分同期）。
 * 繰り返し予定が一気に大量に来ても、系列ごと・全体で件数を絞ってバグらないようにする。
 */
export async function syncUserCalendar(userId: string): Promise<SyncResult> {
  const account = await prisma.userGoogleAccount.findUnique({ where: { userId } });
  if (!account) throw new Error("Google アカウントが未接続です。");

  const isFirstSync = account.lastSyncedAt === null;
  const { upserts, deletedIds, nextSyncToken } =
    await fetchCalendarChanges(userId);

  const now = Date.now();
  const inWindow = (ev: FetchedEvent) => {
    const t = ev.start.getTime();
    return t >= now - PAST_LIMIT_MS && t <= now + FUTURE_LIMIT_MS;
  };

  // 既存判定をまとめて（N+1 回避）
  const ids = upserts.map((e) => e.googleEventId);
  const existingRows = await prisma.event.findMany({
    where: { userId, googleEventId: { in: ids } },
    select: { id: true, googleEventId: true, lastWrittenHash: true },
  });
  const existingByGid = new Map(
    existingRows.map((r) => [r.googleEventId as string, r]),
  );

  const newEvents: SyncResult["newEvents"] = [];
  let updatedCount = 0;
  let aiBudget = AI_CATEGORY_BUDGET;

  // 既存の更新
  for (const ev of upserts) {
    const existing = existingByGid.get(ev.googleEventId);
    if (!existing || !inWindow(ev)) continue;

    const echo =
      !!ev.description &&
      !!existing.lastWrittenHash &&
      hashDescription(ev.description) === existing.lastWrittenHash;

    // 説明欄以外のスカラー項目は常に更新（memo は下の取り込みで扱う）
    await prisma.event.update({
      where: { id: existing.id },
      data: {
        title: ev.title,
        eventDatetime: ev.start,
        endDatetime: ev.end,
        recurringEventId: ev.recurringEventId,
      },
    });
    updatedCount++;

    // 自分の書き込みのエコーでなければ、説明欄の直接編集を取り込む
    if (!echo) {
      try {
        await applyInboundDescription(existing.id, ev.description ?? "");
      } catch (e) {
        console.error("[sync] 説明欄の取り込みに失敗 eventId=%s", existing.id, e);
      }
    }
  }

  // 新規候補：ウィンドウ内・未取り込み・開始時刻昇順
  const candidates = upserts
    .filter((ev) => inWindow(ev) && !existingByGid.has(ev.googleEventId))
    .sort((a, b) => a.start.getTime() - b.start.getTime());

  // 系列ごとの上限（既に取り込み済みの系列インスタンス数も加味）
  const seriesCount = new Map<string, number>();
  if (candidates.some((c) => c.recurringEventId)) {
    const recIds = [
      ...new Set(candidates.map((c) => c.recurringEventId).filter(Boolean)),
    ] as string[];
    const rows = await prisma.event.groupBy({
      by: ["recurringEventId"],
      where: { userId, recurringEventId: { in: recIds } },
      _count: { _all: true },
    });
    for (const r of rows) {
      if (r.recurringEventId) seriesCount.set(r.recurringEventId, r._count._all);
    }
  }

  for (const ev of candidates) {
    if (newEvents.length >= MAX_NEW_PER_RUN) break;
    if (ev.recurringEventId) {
      const c = seriesCount.get(ev.recurringEventId) ?? 0;
      if (c >= MAX_PER_SERIES) continue;
      seriesCount.set(ev.recurringEventId, c + 1);
    }

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
          recurringEventId: ev.recurringEventId,
          memo: stripSonaeBlock(ev.description) || null,
          googleEventId: ev.googleEventId,
          source: "google",
        },
      });
      newEvents.push({
        id: created.id,
        title: created.title,
        eventDatetime: created.eventDatetime,
        recurringEventId: created.recurringEventId,
      });
    } catch (e: unknown) {
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
 * 同期 → 新規予定の準備リストを先行生成（説明欄にも反映）→ 即プッシュ通知。
 * アプリを開かなくても成り立つための中心処理。
 * 繰り返し予定は「系列ごとに1回だけ」通知する。初回同期では通知しない。
 */
export async function syncAndNotify(
  userId: string,
  opts?: { generateBudget?: number },
): Promise<SyncResult & { generated: number }> {
  const result = await syncUserCalendar(userId);
  if (result.isFirstSync) return { ...result, generated: 0 };

  // 通知の前に、準備リストを用意して説明欄へ反映（新規＋積み残し、上限つき）
  const generated = await primeNotifiedChecklists(
    userId,
    opts?.generateBudget ?? 3,
  );

  if (result.newEvents.length === 0) return { ...result, generated };

  // 系列は最も近い1件だけ通知対象にする
  const notifiable: SyncResult["newEvents"] = [];
  const seenSeries = new Set<string>();
  for (const ev of result.newEvents) {
    if (ev.recurringEventId) {
      if (seenSeries.has(ev.recurringEventId)) continue;
      seenSeries.add(ev.recurringEventId);
      // 既に同系列で通知済みインスタンスがあればスキップ
      const already = await prisma.event.findFirst({
        where: {
          userId,
          recurringEventId: ev.recurringEventId,
          notifiedAt: { not: null },
        },
        select: { id: true },
      });
      if (already) continue;
    }
    notifiable.push(ev);
  }

  for (const ev of notifiable) {
    const isSeries = Boolean(ev.recurringEventId);
    await sendPushToUser(userId, {
      title: isSeries
        ? "繰り返しの予定が追加されました"
        : "新しい予定が追加されました",
      body: `「${ev.title}」の準備リストを用意しました`,
      url: `/events/${ev.id}`,
      tag: isSeries ? `series-${ev.recurringEventId}` : `event-${ev.id}`,
    });
    await prisma.event.update({
      where: { id: ev.id },
      data: { notifiedAt: new Date() },
    });
  }

  return { ...result, generated };
}
