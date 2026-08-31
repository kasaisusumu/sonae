import { prisma } from "@/lib/prisma";
import { sendPushToUser } from "@/lib/push";
import { extractEventFeature, type EventFeatureData } from "@/lib/features";
import { signatureMatches } from "@/lib/signature";
import { decayMultiplier } from "@/lib/learning";

/**
 * 失敗ログの「学習」は、チェックリスト学習（spec 9.2）と同じ要領・速度・タイミングで動く:
 * - 記録した瞬間に、その予定の特徴シグネチャ {d,o,w,t} を FailureLog に確定する（即時）。
 * - 警告は、同じカテゴリ かつ シグネチャが当てはまる 予定にだけ出す（"{}" は全体）。
 * - 同じ内容の失敗は 1 つのまとまり（クラスタ）にして「N 回目」として扱う。
 *   件数が増えても表示は増やさない（上位 3 件まで）。＝ 量ではなく精度。
 * - 繰り返し起きているものほど重く、半年ほど間が空くと自然に薄れる（decayMultiplier）。
 * - 「防げた」は回数として残すが、警告自体は次回以降も出し続ける。
 */

export interface WarningCluster {
  id: string; // 代表（最新）の FailureLog.id。アクションで使う
  description: string;
  estimatedLossYen: number;
  occurredCount: number; // このまとまりの記録回数
  preventedCount: number; // 「防げた」と申告された回数（全予定合計）
  lastOccurredAt: Date;
  weight: number; // 表示順・足切り用（経年劣化込み）
  prevented: boolean; // この予定で「防げた」計上済みか
  loggedThisEventCount: number; // 「今回もやってしまった」でこの予定に記録済みの回数
  fromEventTitle: string | null;
}

export interface EventWarning {
  event: {
    id: string;
    title: string;
    eventDatetime: Date;
    categoryName: string;
  };
  isPast: boolean;
  // このカテゴリに記録はあるが、この予定と強くは結びつかない（参考表示）
  weak: boolean;
  logs: WarningCluster[]; // 呼び出し側の互換のため名前は logs のまま（中身はクラスタ）
}

type EventLike = {
  id: string;
  userId: string;
  title: string;
  memo?: string | null;
  eventDatetime: Date;
  endDatetime?: Date | null;
  recurringEventId?: string | null;
  categoryId: string | null;
  failureWarningAckAt: Date | null;
  category?: { name: string } | null;
};

const MAX_CLUSTERS = 3;
const WEIGHT_FLOOR = 0.3;

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

function clusterKey(s: string): string {
  return s
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[、。,.!！?？「」『』（）()\-—・:：;；]/g, "");
}

function similarText(a: string, b: string): boolean {
  if (clusterKey(a) && clusterKey(a) === clusterKey(b)) return true;
  const ta = tokenize(a);
  const tb = tokenize(b);
  if (ta.size === 0 || tb.size === 0) return false;
  let inter = 0;
  for (const x of ta) if (tb.has(x)) inter++;
  return inter / (ta.size + tb.size - inter) >= 0.6;
}

type LogRow = {
  id: string;
  categoryId: string | null;
  description: string;
  estimatedLossYen: number;
  occurredAt: Date;
  eventId: string | null;
  featureSignature: string;
  event: { title: string; recurringEventId: string | null } | null;
};

const LOG_SELECT = {
  id: true,
  categoryId: true,
  description: true,
  estimatedLossYen: true,
  occurredAt: true,
  eventId: true,
  featureSignature: true,
  event: { select: { title: true, recurringEventId: true } },
} as const;

/**
 * その失敗ログが、対象の予定に警告として出すべきか（予定の紐づけ側の条件）。
 * - 予定に紐づいていない（カテゴリ全体の記録）→ 常に対象
 * - 紐づく予定が同じ繰り返し系列 → 対象
 * - 紐づく予定名と語彙が1つでも重なる → 対象
 */
function eventLinkApplies(
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

/** 予定の紐づけ条件 かつ 特徴シグネチャ一致（"{}" は何にでも当たる）。 */
function logApplies(
  log: LogRow,
  targetTitle: string,
  targetRecurringId: string | null | undefined,
  targetFeature: EventFeatureData,
): boolean {
  return (
    eventLinkApplies(log, targetTitle, targetRecurringId) &&
    signatureMatches(log.featureSignature, targetFeature)
  );
}

function isPastEvent(e: {
  eventDatetime: Date;
  endDatetime?: Date | null;
}): boolean {
  const end =
    e.endDatetime ?? new Date(e.eventDatetime.getTime() + 2 * 3_600_000);
  return end.getTime() <= Date.now();
}

/** 該当ログを「同じ内容」でまとめ、経年劣化込みの重みで上位だけ返す。 */
function buildClusters(
  logs: LogRow[],
  preventedCountByLogId: Map<string, number>,
  preventedThisEventLogIds: Set<string>,
  thisEventId: string | null = null,
  opts: { noFloor?: boolean } = {},
): WarningCluster[] {
  const sorted = [...logs].sort(
    (a, b) => b.occurredAt.getTime() - a.occurredAt.getTime(),
  );

  const groups: { rep: LogRow; members: LogRow[] }[] = [];
  for (const l of sorted) {
    const hit = groups.find((g) => similarText(g.rep.description, l.description));
    if (hit) hit.members.push(l);
    else groups.push({ rep: l, members: [l] });
  }

  const clusters: WarningCluster[] = groups.map((g) => {
    const occurredCount = g.members.length;
    const lastOccurredAt = g.rep.occurredAt; // sorted desc なので rep が最新
    const estimatedLossYen = g.members.reduce(
      (m, x) => Math.max(m, x.estimatedLossYen),
      0,
    );
    const preventedCount = g.members.reduce(
      (s, x) => s + (preventedCountByLogId.get(x.id) ?? 0),
      0,
    );
    const prevented = g.members.some((x) =>
      preventedThisEventLogIds.has(x.id),
    );
    const loggedThisEventCount = thisEventId
      ? g.members.filter((x) => x.eventId === thisEventId).length
      : 0;
    // computeConfidence と同じ気持ち: 繰り返しで重く、経年で薄れる
    const base = 0.4 + 0.18 * Math.min(occurredCount, 3);
    const weight = Number(
      (base * decayMultiplier(lastOccurredAt)).toFixed(3),
    );
    return {
      id: g.rep.id,
      description: g.rep.description,
      estimatedLossYen,
      occurredCount,
      preventedCount,
      lastOccurredAt,
      weight,
      prevented,
      loggedThisEventCount,
      fromEventTitle: g.rep.event?.title ?? null,
    };
  });

  return clusters
    .filter((c) => opts.noFloor || c.weight >= WEIGHT_FLOOR || c.prevented)
    .sort((a, b) => b.weight - a.weight)
    .slice(0, MAX_CLUSTERS);
}

function featureOf(e: {
  title: string;
  memo?: string | null;
  eventDatetime: Date;
  endDatetime?: Date | null;
}): EventFeatureData {
  return extractEventFeature({
    title: e.title,
    memo: e.memo ?? null,
    eventDatetime: e.eventDatetime,
    endDatetime: e.endDatetime ?? null,
  });
}

/**
 * ある予定に表示すべき再発防止警告。
 * - 失敗ログなし → null
 * - これからの予定: ack 済みなら null（畳める）
 * - 終わった予定: ack に関わらず表示（事後に「防げた？」を答えてもらう）
 * - 「防げた」計上済みでも、次回以降の予定では警告し続ける
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

  const feature = featureOf(event);

  const logs: LogRow[] = await prisma.failureLog.findMany({
    where: { userId: event.userId, categoryId: event.categoryId },
    orderBy: { occurredAt: "desc" },
    select: LOG_SELECT,
  });

  if (logs.length === 0) return null;

  const strong = logs.filter((l) =>
    logApplies(l, event.title, event.recurringEventId, feature),
  );

  const savings = await prisma.savingsEntry.findMany({
    where: { failureLogId: { in: logs.map((l) => l.id) }, confirmedByUser: true },
    select: { failureLogId: true, eventId: true },
  });
  const preventedCountByLogId = new Map<string, number>();
  const preventedThisEvent = new Set<string>();
  for (const s of savings) {
    if (!s.failureLogId) continue;
    preventedCountByLogId.set(
      s.failureLogId,
      (preventedCountByLogId.get(s.failureLogId) ?? 0) + 1,
    );
    if (s.eventId === event.id) preventedThisEvent.add(s.failureLogId);
  }

  // 1) この予定に強く結びつく記録で通常のクラスタ
  let clusters = buildClusters(
    strong,
    preventedCountByLogId,
    preventedThisEvent,
    event.id,
  );
  let weak = false;

  // 2) 何も出ないが、このカテゴリに記録はある
  //    → 一覧の「過去に失敗あり」バッジと表示を一致させるため、参考として出す。
  //    まず strong を経年フロアなしで、それも空ならカテゴリ全記録から。
  if (clusters.length === 0) {
    const base = strong.length > 0 ? strong : logs;
    clusters = buildClusters(
      base,
      preventedCountByLogId,
      preventedThisEvent,
      event.id,
      { noFloor: true },
    );
    weak = true;
  }
  if (clusters.length === 0) return null;

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
    weak,
    logs: clusters,
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

  const logs: LogRow[] = await prisma.failureLog.findMany({
    where: { userId, categoryId: { in: catIds } },
    orderBy: { occurredAt: "desc" },
    select: LOG_SELECT,
  });
  const logIds = logs.map((l) => l.id);
  const savings = await prisma.savingsEntry.findMany({
    where: { failureLogId: { in: logIds }, confirmedByUser: true },
    select: { failureLogId: true, eventId: true },
  });
  const preventedCountByLogId = new Map<string, number>();
  const preventedByEvent = new Map<string, Set<string>>();
  for (const s of savings) {
    if (!s.failureLogId) continue;
    preventedCountByLogId.set(
      s.failureLogId,
      (preventedCountByLogId.get(s.failureLogId) ?? 0) + 1,
    );
    if (s.eventId) {
      const set = preventedByEvent.get(s.eventId) ?? new Set<string>();
      set.add(s.failureLogId);
      preventedByEvent.set(s.eventId, set);
    }
  }

  const logsByCat = new Map<string, LogRow[]>();
  for (const l of logs) {
    if (!l.categoryId) continue;
    const arr = logsByCat.get(l.categoryId) ?? [];
    arr.push(l);
    logsByCat.set(l.categoryId, arr);
  }

  const out: EventWarning[] = [];
  for (const e of risky) {
    const feature = featureOf(e);
    const applicable = (logsByCat.get(e.categoryId!) ?? []).filter((l) =>
      logApplies(l, e.title, e.recurringEventId, feature),
    );
    if (applicable.length === 0) continue;

    const clusters = buildClusters(
      applicable,
      preventedCountByLogId,
      preventedByEvent.get(e.id) ?? new Set<string>(),
    );
    if (clusters.length === 0) continue;

    out.push({
      event: {
        id: e.id,
        title: e.title,
        eventDatetime: e.eventDatetime,
        categoryName: e.category?.name ?? "その他",
      },
      isPast: false,
      weak: false,
      logs: clusters,
    });
  }
  return out;
}

/**
 * 終わった予定について「今回は防げましたか？」の通知を送る（1 予定 1 回）。
 * cron から呼ぶ。カテゴリ・シグネチャが当てはまる失敗ログがある予定だけが対象。
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
  const logs: LogRow[] = await prisma.failureLog.findMany({
    where: { userId, categoryId: { in: catIds } },
    orderBy: { occurredAt: "desc" },
    select: LOG_SELECT,
  });

  const logsByCat = new Map<string, LogRow[]>();
  for (const l of logs) {
    if (!l.categoryId) continue;
    const arr = logsByCat.get(l.categoryId) ?? [];
    arr.push(l);
    logsByCat.set(l.categoryId, arr);
  }

  let sent = 0;
  const notifiedSeries = new Set<string>();
  for (const e of events) {
    if (!isPastEvent(e)) continue;

    const feature = featureOf(e);
    const applicable = (logsByCat.get(e.categoryId!) ?? []).filter((l) =>
      logApplies(l, e.title, e.recurringEventId, feature),
    );

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
