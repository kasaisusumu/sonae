import { prisma } from "@/lib/prisma";
import {
  resolveCategoryForEvent,
  getOrCreateCategory,
  inferCategoryName,
  FALLBACK_CATEGORY,
} from "@/lib/categories";
import { classifyEventCategoriesBatch } from "@/lib/categorize-ai";
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
  /** deferInbound のとき、後で applyInboundDescription すべき (eventId, description) */
  inboundPending: { eventId: string; description: string }[];
}

const normTitle = (s: string) => s.toLowerCase().replace(/\s+/g, "").trim();

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
  opts: { skipAiCategory?: boolean; deferInbound?: boolean } = {},
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
  const inboundPending: SyncResult["inboundPending"] = [];
  let updatedCount = 0;
  let aiBudget = AI_CATEGORY_BUDGET;

  // 既存の更新: スカラー項目はまとめて並列更新（クリティカルパスを短く）
  const existingChanged = upserts.filter(
    (ev) => existingByGid.get(ev.googleEventId) && inWindow(ev),
  );
  await Promise.all(
    existingChanged.map((ev) =>
      prisma.event.update({
        where: { id: existingByGid.get(ev.googleEventId)!.id },
        data: {
          title: ev.title,
          eventDatetime: ev.start,
          endDatetime: ev.end,
          recurringEventId: ev.recurringEventId,
        },
      }),
    ),
  );
  updatedCount += existingChanged.length;

  // 説明欄の直接編集の取り込み。deferInbound なら後回し（通知を先に出すため）。
  for (const ev of existingChanged) {
    const existing = existingByGid.get(ev.googleEventId)!;
    const echo =
      !!ev.description &&
      !!existing.lastWrittenHash &&
      hashDescription(ev.description) === existing.lastWrittenHash;
    if (echo) continue;
    if (opts.deferInbound) {
      inboundPending.push({
        eventId: existing.id,
        description: ev.description ?? "",
      });
    } else {
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

  // 1) 系列上限などのフィルタ（I/O なし）
  const toCreate: FetchedEvent[] = [];
  for (const ev of candidates) {
    if (!isFirstSync && toCreate.length >= MAX_NEW_PER_RUN) break;
    if (ev.recurringEventId) {
      const c = seriesCount.get(ev.recurringEventId) ?? 0;
      if (c >= MAX_PER_SERIES) continue;
      seriesCount.set(ev.recurringEventId, c + 1);
    }
    toCreate.push(ev);
  }

  // 2) カテゴリを決める
  const catIdByEv = new Map<FetchedEvent, string>();
  if (opts.skipAiCategory || isFirstSync) {
    // keyword のみ・高速。カテゴリ名を重複排除してまとめて用意（webhook は後で refine）。
    const nameByEv = new Map<FetchedEvent, string>();
    for (const ev of toCreate) {
      nameByEv.set(ev, inferCategoryName(ev.title, ev.description));
    }
    const catByName = new Map<string, string>();
    await Promise.all(
      [...new Set(nameByEv.values())].map(async (nm) => {
        catByName.set(nm, (await getOrCreateCategory(userId, nm)).id);
      }),
    );
    for (const ev of toCreate) {
      catIdByEv.set(ev, catByName.get(nameByEv.get(ev)!)!);
    }
  } else {
    // cron 等: 従来どおり（AI フォールバックあり、予算内）
    for (const ev of toCreate) {
      const useAi = aiBudget > 0;
      const cat = await resolveCategoryForEvent(
        userId,
        ev.title,
        ev.description,
        useAi,
      );
      if (useAi) aiBudget--;
      catIdByEv.set(ev, cat.id);
    }
  }

  // 3) 作成（並列）
  type CreateOutcome =
    | { created: SyncResult["newEvents"][number] }
    | { dup: true };
  const createResults = await Promise.all(
    toCreate.map(async (ev): Promise<CreateOutcome> => {
      try {
        const created = await prisma.event.create({
          data: {
            userId,
            categoryId: catIdByEv.get(ev)!,
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
        return {
          created: {
            id: created.id,
            title: created.title,
            eventDatetime: created.eventDatetime,
            recurringEventId: created.recurringEventId,
          },
        };
      } catch (e: unknown) {
        if (
          typeof e === "object" &&
          e !== null &&
          "code" in e &&
          (e as { code?: string }).code === "P2002"
        ) {
          return { dup: true as const };
        }
        throw e;
      }
    }),
  );
  for (const r of createResults) {
    if ("created" in r) newEvents.push(r.created);
    else updatedCount++;
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

  return { newEvents, updatedCount, deletedCount, isFirstSync, inboundPending };
}

/**
 * 1 予定だけを Google から取り直して、説明欄の直接編集をすぐ取り込む。
 * 予定詳細を開いたときに after() から呼ぶ。webhook / cron の遅延を待たずに
 * 「開いた瞬間に最新」にするための補助。失敗しても無視する。
 */
export async function refreshEventFromGoogle(
  eventId: string,
): Promise<boolean> {
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
  if (!event || event.source !== "google" || !event.googleEventId) return false;

  try {
    const { calendar, account } = await getCalendarClient(event.userId);
    const res = await calendar.events.get({
      calendarId: account.calendarId || "primary",
      eventId: event.googleEventId,
    });
    const item = res.data;
    const startRaw = item.start?.dateTime ?? item.start?.date;
    if (item.status === "cancelled" || !startRaw) return false;

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
    if (!echo) {
      await applyInboundDescription(event.id, description);
      return true;
    }
  } catch (e) {
    console.error("[refreshEventFromGoogle] eventId=%s", eventId, e);
  }
  return false;
}

/**
 * 直近に取り込んで「その他」に落ちた Google 予定を、本来のカテゴリに振り直す。
 * AI 負荷を抑えるため: 過去の予定は対象外 → 同名の既存予定のカテゴリを流用（AIなし）
 * → 残りだけを 1 回の AI 呼び出しでまとめて分類。
 */
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
      eventDatetime: { gte: new Date() }, // 過去の予定は分類不要
      category: { name: FALLBACK_CATEGORY },
    },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: { id: true, title: true, memo: true },
  });
  if (targets.length === 0) return 0;

  // 同名の既存予定が具体カテゴリを持っていれば流用（AI 不要）
  const known = await prisma.event.findMany({
    where: { userId, categoryId: { not: null }, category: { name: { not: FALLBACK_CATEGORY } } },
    select: { title: true, categoryId: true, category: { select: { name: true } } },
  });
  const catByTitle = new Map<string, { id: string; name: string }>();
  for (const k of known) {
    const key = normTitle(k.title);
    if (k.categoryId && !catByTitle.has(key)) {
      catByTitle.set(key, { id: k.categoryId, name: k.category?.name ?? "" });
    }
  }

  let n = 0;
  const needsAi: typeof targets = [];
  for (const ev of targets) {
    const hit = catByTitle.get(normTitle(ev.title));
    if (hit && hit.name !== FALLBACK_CATEGORY) {
      await prisma.event.update({
        where: { id: ev.id },
        data: { categoryId: hit.id },
      });
      n++;
    } else {
      needsAi.push(ev);
    }
  }

  if (needsAi.length > 0) {
    const existing = (
      await prisma.category.findMany({ where: { userId }, select: { name: true } })
    ).map((c) => c.name);
    const names = await classifyEventCategoriesBatch(
      needsAi.map((e) => ({ title: e.title, description: e.memo })),
      existing,
    );
    for (let i = 0; i < needsAi.length; i++) {
      const name = names[i];
      if (!name || name === FALLBACK_CATEGORY) continue;
      try {
        const cat = await getOrCreateCategory(userId, name);
        if (cat.name !== FALLBACK_CATEGORY) {
          await prisma.event.update({
            where: { id: needsAi[i].id },
            data: { categoryId: cat.id },
          });
          n++;
        }
      } catch (e) {
        console.error("[refineFallbackCategories] eventId=%s", needsAi[i].id, e);
      }
    }
  }
  return n;
}

/** result.newEvents から、実際に通知すべきもの（系列は代表1件・未通知）を選ぶ。 */
async function pickNotifiable(
  userId: string,
  newEvents: SyncResult["newEvents"],
): Promise<SyncResult["newEvents"]> {
  const seriesIds = [
    ...new Set(
      newEvents.map((e) => e.recurringEventId).filter((v): v is string => !!v),
    ),
  ];
  const notifiedSeries = new Set<string>();
  if (seriesIds.length > 0) {
    const rows = await prisma.event.findMany({
      where: {
        userId,
        recurringEventId: { in: seriesIds },
        notifiedAt: { not: null },
      },
      select: { recurringEventId: true },
      distinct: ["recurringEventId"],
    });
    for (const r of rows) if (r.recurringEventId) notifiedSeries.add(r.recurringEventId);
  }

  const out: SyncResult["newEvents"] = [];
  const seenSeries = new Set<string>();
  for (const ev of newEvents) {
    if (ev.recurringEventId) {
      if (seenSeries.has(ev.recurringEventId)) continue;
      seenSeries.add(ev.recurringEventId);
      if (notifiedSeries.has(ev.recurringEventId)) continue;
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
    deferInbound?: boolean;
  },
): Promise<SyncResult & { generated: number }> {
  const result = await syncUserCalendar(userId, {
    skipAiCategory: opts?.skipAiCategory,
    deferInbound: opts?.deferInbound,
  });
  if (result.isFirstSync) return { ...result, generated: 0 };

  // まず通知（生成を待たない）。プッシュは全件並列で送り、既読印(notifiedAt)は
  // 送信後に 1 回の updateMany でまとめる（送信の合間に DB 往復を挟まない＝最速）。
  if (result.newEvents.length > 0) {
    const notifiable = await pickNotifiable(userId, result.newEvents);
    if (notifiable.length > 0) {
      await Promise.all(
        notifiable.map((ev) => {
          const isSeries = Boolean(ev.recurringEventId);
          return sendPushToUser(userId, {
            title: isSeries
              ? "繰り返しの予定が追加されました"
              : "新しい予定が追加されました",
            body: `「${ev.title}」を追加しました。準備リストを用意します`,
            url: `/events/${ev.id}`,
            tag: isSeries ? `series-${ev.recurringEventId}` : `event-${ev.id}`,
          });
        }),
      );
      await prisma.event.updateMany({
        where: { id: { in: notifiable.map((ev) => ev.id) } },
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
