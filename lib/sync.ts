import { prisma } from "@/lib/prisma";
import { resolveCategoryForEvent, FALLBACK_CATEGORY } from "@/lib/categories";
import {
  fetchCalendarChanges,
  getCalendarClient,
  type FetchedEvent,
} from "@/lib/google";
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
export async function syncUserCalendar(
  userId: string,
  opts: { skipAiCategory?: boolean } = {},
): Promise<SyncResult> {
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
    // 連携直後の初回取り込みは既存予定 → 件数上限なしで全部入れるが「自動管理しない」
    if (!isFirstSync && newEvents.length >= MAX_NEW_PER_RUN) break;
    if (ev.recurringEventId) {
      const c = seriesCount.get(ev.recurringEventId) ?? 0;
      if (c >= MAX_PER_SERIES) continue;
      seriesCount.set(ev.recurringEventId, c + 1);
    }

    // 初回 or fast path は AI カテゴリ判定を使わない（キーワードのみ・高速）。
    // 通知を早く出すため、webhook では skipAiCategory=true。後で refine する。
    const useAi = !isFirstSync && !opts.skipAiCategory && aiBudget > 0;
    const category = await resolveCategoryForEvent(
      userId,
      ev.title,
      ev.description,
      useAi,
    );
    if (useAi) aiBudget--;
    try {
      const created = await prisma.event.create({
        data: {
          userId,
          categoryId: category.id,
          title: ev.title,
          eventDatetime: ev.start,
          endDatetime: ev.end,
          recurringEventId: ev.recurringEventId,
          autoManaged: !isFirstSync, // 既存予定は自動管理の対象外
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
 * 1 予定だけを Google から取り直して、説明欄の直接編集をすぐ取り込む。
 * 予定詳細を開いたときに after() から呼ぶ。webhook / cron の遅延を待たずに
 * 「開いた瞬間に最新」にするための補助。失敗しても無視する。
 */
export async function refreshEventFromGoogle(eventId: string): Promise<void> {
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    select: {
      id: true,
      userId: true,
      source: true,
      googleEventId: true,
      lastWrittenHash: true,
      autoManaged: true,
    },
  });
  if (!event || event.source !== "google" || !event.googleEventId) return;

  try {
    const { calendar, account } = await getCalendarClient(event.userId);
    const res = await calendar.events.get({
      calendarId: account.calendarId || "primary",
      eventId: event.googleEventId,
    });
    const item = res.data;
    const startRaw = item.start?.dateTime ?? item.start?.date;
    if (item.status === "cancelled" || !startRaw) return;

    const description = item.description?.trim() || "";
    const start = new Date(startRaw);
    const endRaw = item.end?.dateTime ?? item.end?.date ?? null;

    await prisma.event.update({
      where: { id: event.id },
      data: {
        title: item.summary?.trim() || "(タイトルなし)",
        eventDatetime: start,
        endDatetime: endRaw ? new Date(endRaw) : null,
        recurringEventId: item.recurringEventId ?? null,
      },
    });

    const echo =
      !!description &&
      !!event.lastWrittenHash &&
      hashDescription(description) === event.lastWrittenHash;
    if (!echo) await applyInboundDescription(event.id, description);
  } catch (e) {
    console.error("[refreshEventFromGoogle] eventId=%s", eventId, e);
  }
}

/** 直近に取り込んで「その他」に落ちた Google 予定を、AI で本来のカテゴリに振り直す。 */
export async function refineFallbackCategories(
  userId: string,
  limit = 8,
): Promise<number> {
  const since = new Date(Date.now() - 15 * 60_000);
  const targets = await prisma.event.findMany({
    where: {
      userId,
      source: "google",
      autoManaged: true,
      createdAt: { gte: since },
      category: { name: FALLBACK_CATEGORY },
    },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: { id: true, title: true, memo: true },
  });
  let n = 0;
  for (const ev of targets) {
    try {
      const cat = await resolveCategoryForEvent(userId, ev.title, ev.memo, true);
      if (cat.name !== FALLBACK_CATEGORY) {
        await prisma.event.update({
          where: { id: ev.id },
          data: { categoryId: cat.id },
        });
        n++;
      }
    } catch (e) {
      console.error("[refineFallbackCategories] eventId=%s", ev.id, e);
    }
  }
  return n;
}

/** result.newEvents から、実際に通知すべきもの（系列は代表1件・未通知）を選ぶ。 */
async function pickNotifiable(
  userId: string,
  newEvents: SyncResult["newEvents"],
): Promise<SyncResult["newEvents"]> {
  const out: SyncResult["newEvents"] = [];
  const seenSeries = new Set<string>();
  for (const ev of newEvents) {
    if (ev.recurringEventId) {
      if (seenSeries.has(ev.recurringEventId)) continue;
      seenSeries.add(ev.recurringEventId);
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
    out.push(ev);
  }
  return out;
}

/**
 * 同期 →（まず）新規予定を即プッシュ通知 → 準備リスト生成＋説明欄反映。
 * アプリを開かなくても成り立つための中心処理。
 * 繰り返し予定は「系列ごとに1回だけ」通知する。初回同期では通知しない。
 *
 * - deferGeneration: true なら生成・説明欄反映はしない（呼び出し側が after() で回す）。
 *   通知を最速で出すための webhook 用。
 * - skipAiCategory: true なら取り込み時の AI カテゴリ判定を省く（keyword のみ）。
 */
export async function syncAndNotify(
  userId: string,
  opts?: {
    generateBudget?: number;
    deferGeneration?: boolean;
    skipAiCategory?: boolean;
  },
): Promise<SyncResult & { generated: number }> {
  const result = await syncUserCalendar(userId, {
    skipAiCategory: opts?.skipAiCategory,
  });
  if (result.isFirstSync) return { ...result, generated: 0 };

  // まず通知（生成を待たない）。
  if (result.newEvents.length > 0) {
    const notifiable = await pickNotifiable(userId, result.newEvents);
    for (const ev of notifiable) {
      const isSeries = Boolean(ev.recurringEventId);
      await sendPushToUser(userId, {
        title: isSeries
          ? "繰り返しの予定が追加されました"
          : "新しい予定が追加されました",
        body: `「${ev.title}」を追加しました。準備リストを用意します`,
        url: `/events/${ev.id}`,
        tag: isSeries ? `series-${ev.recurringEventId}` : `event-${ev.id}`,
      });
      await prisma.event.update({
        where: { id: ev.id },
        data: { notifiedAt: new Date() },
      });
    }
  }

  if (opts?.deferGeneration) return { ...result, generated: 0 };

  const generated = await primeNotifiedChecklists(
    userId,
    opts?.generateBudget ?? 3,
  );
  return { ...result, generated };
}
