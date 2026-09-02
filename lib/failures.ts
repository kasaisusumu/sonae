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

export function clusterKey(s: string): string {
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
    where: {
      userId: event.userId,
      categoryId: event.categoryId,
      outcome: { not: "irrelevant" }, // 「今回は関係ない」は先回り警告に使わない
    },
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

  // この予定に「強く結びつく」記録だけでクラスタを作る。
  // 名前が似ている・同じ繰り返し系列・状況が近い、のいずれかで当たったものだけ。
  // 「同じカテゴリなだけ」の弱い参考表示はしない（ユーザー指定）。
  const clusters = buildClusters(
    strong,
    preventedCountByLogId,
    preventedThisEvent,
    event.id,
  );
  const weak = false;
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
    where: {
      userId,
      categoryId: { in: catIds },
      outcome: { not: "irrelevant" },
    },
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
 * 終わった予定について「失敗はあった？あったら書こう」の通知を送る（1 予定 1 回）。
 * cron から呼ぶ。失敗ログの有無に関わらず、終わった予定すべてが対象
 *（連携時に既にあった予定＝autoManaged=false は除く）。
 * 似た失敗ログがあれば、その内容を添えた文面にする。
 * 「なかった」を押した予定（noFailureAt）は対象外。踏まれなくても他で催促はしない。
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
      autoManaged: true,
      postFailureCheckNotifiedAt: null,
      noFailureAt: null,
      eventDatetime: { lte: now, gte: horizon },
    },
    orderBy: { eventDatetime: "desc" },
    take: 30,
    include: { category: true },
  });
  if (events.length === 0) return 0;

  const catIds = [
    ...new Set(events.map((e) => e.categoryId).filter((c): c is string => !!c)),
  ];
  const logs: LogRow[] = catIds.length
    ? await prisma.failureLog.findMany({
        where: {
          userId,
          categoryId: { in: catIds },
          outcome: { not: "irrelevant" },
        },
        orderBy: { occurredAt: "desc" },
        select: LOG_SELECT,
      })
    : [];

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

    // 通知したか否かに関わらず「処理済み」にする（1 予定 1 回）。
    await prisma.event.update({
      where: { id: e.id },
      data: { postFailureCheckNotifiedAt: now },
    });

    const seriesKey = e.recurringEventId ?? "";
    const seriesDup = seriesKey !== "" && notifiedSeries.has(seriesKey);
    if (sent >= limit || seriesDup) continue;
    if (seriesKey !== "") notifiedSeries.add(seriesKey);

    const feature = featureOf(e);
    const applicable = e.categoryId
      ? (logsByCat.get(e.categoryId) ?? []).filter((l) =>
          logApplies(l, e.title, e.recurringEventId, feature),
        )
      : [];

    const body =
      applicable.length > 0
        ? (() => {
            const top = applicable[0];
            const short =
              top.description.length > 24
                ? `${top.description.slice(0, 24)}…`
                : top.description;
            return `前に「${short}」がありました。今回はどうでしたか？ タップして、防げた／防げなかったを選ぶだけでOKです。`;
          })()
        : "うっかりはありましたか？ あったら一言だけ書いておくと、次に似た予定で先回りできます。なければ「なかった」を押すだけでOK。";

    await sendPushToUser(userId, {
      title: `${e.title}、おつかれさまでした 🍵`,
      body,
      url: `/events/${e.id}#failure-check`,
      tag: `failcheck-${e.id}`,
    });
    sent++;
  }
  return sent;
}

// ─────────────────────────────────────────────
// 失敗ログの提案（準備リストの提案と同じノリで、似た予定・同カテゴリからどんどん出す）
// ─────────────────────────────────────────────

export interface FailureSuggestion {
  /** 元になった失敗ログ id（内容の引用元・参照用） */
  sourceId: string;
  description: string;
  estimatedLossYen: number;
  fromEventTitle: string | null;
  reasons: string[]; // "同じカテゴリ" / "似た予定" / "状況が近い" / "名前が近い"
  score: number;
}

/**
 * ある予定に「こんな失敗もあり得ます」と提案する失敗ログの候補。
 * 同カテゴリ・似た予定名・特徴シグネチャ一致でスコアリングし、ゆるめの閾値で多めに返す。
 * すでにこの予定に同じ内容が記録されているものは除外。内容（description）で重複排除。
 */
export async function suggestFailureLogsForEvent(
  eventId: string,
  limit = 6,
): Promise<FailureSuggestion[]> {
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    include: { category: true },
  });
  if (!event) return [];

  const feature = featureOf(event);

  const [own, dismissed] = await Promise.all([
    prisma.failureLog.findMany({
      where: { userId: event.userId, eventId },
      select: { description: true },
    }),
    prisma.failureDismissal.findMany({
      where: { eventId },
      select: { descKey: true },
    }),
  ]);
  const ownKeys = new Set(own.map((o) => clusterKey(o.description)));
  const dismissedKeys = new Set(dismissed.map((d) => d.descKey));

  const logs: LogRow[] = await prisma.failureLog.findMany({
    where: {
      userId: event.userId,
      NOT: { eventId },
      outcome: { not: "irrelevant" },
    },
    orderBy: { occurredAt: "desc" },
    take: 200,
    select: LOG_SELECT,
  });

  type Scored = FailureSuggestion & { occurredAt: Date };
  const byKey = new Map<string, Scored>();

  for (const l of logs) {
    const key = clusterKey(l.description);
    if (!key || ownKeys.has(key) || dismissedKeys.has(key)) continue;

    // 失敗ログの「予測」は確信度が低くても普通に提案してよい（ユーザー指定）。
    // 同じカテゴリ・似た予定名・特徴シグネチャ一致でゆるくスコアリングして多めに出す。
    let score = 0.4; // ベース（うっすら全部候補）
    const reasons: string[] = [];
    if (l.categoryId && event.categoryId && l.categoryId === event.categoryId) {
      score += 2;
      reasons.push("同じカテゴリ");
    }
    if (eventLinkApplies(l, event.title, event.recurringEventId)) {
      score += 2;
      if (!reasons.includes("同じカテゴリ")) reasons.push("似た予定");
    }
    if (signatureMatches(l.featureSignature, feature)) {
      score += 1;
      reasons.push("状況が近い");
    }
    if (l.event && similarText(l.event.title, event.title)) {
      score += 1.5;
      if (!reasons.some((r) => r === "似た予定" || r === "同じカテゴリ")) {
        reasons.push("名前が近い");
      }
    }
    score = Number((score * decayMultiplier(l.occurredAt)).toFixed(3));
    if (score < 0.9 || reasons.length === 0) continue;

    const prev = byKey.get(key);
    if (!prev || score > prev.score) {
      byKey.set(key, {
        sourceId: l.id,
        description: l.description,
        estimatedLossYen: l.estimatedLossYen,
        fromEventTitle: l.event?.title ?? null,
        reasons,
        score,
        occurredAt: l.occurredAt,
      });
    }
  }

  return [...byKey.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((s) => ({
      sourceId: s.sourceId,
      description: s.description,
      estimatedLossYen: s.estimatedLossYen,
      fromEventTitle: s.fromEventTitle,
      reasons: s.reasons,
      score: s.score,
    }));
}

// ── Google カレンダー説明欄に書く「失敗まわり」の情報 ──────────────

export interface EventDescriptionFailures {
  isPast: boolean;
  /** 終了前だけ: 予想される失敗の内容（過去に似た予定であったもの）。 */
  anticipated: string[];
  /** 終了後だけ: 今回は回避できた失敗（内容＋推定額）。 */
  avoided: { text: string; yen: number }[];
  /** 終了後だけ: 今回起きてしまった失敗の内容。 */
  occurred: string[];
}

const EMPTY_DESC_FAILURES: EventDescriptionFailures = {
  isPast: false,
  anticipated: [],
  avoided: [],
  occurred: [],
};

/**
 * 予定の説明欄に載せる失敗情報を集める。
 * - 終了前: この予定に紐づく／予想される失敗を「予想される失敗」に。
 * - 終了後: 結果が決まったものを「回避した失敗」「今回の失敗」に振り分ける。
 *   どちらも中身が無ければ空配列（呼び出し側で見出しごと省く）。
 */
export async function getEventDescriptionFailures(
  eventId: string,
): Promise<EventDescriptionFailures> {
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    include: { category: true },
  });
  if (!event) return EMPTY_DESC_FAILURES;

  const past = isPastEvent(event);
  const norm = (s: string) =>
    s.trim().toLowerCase().replace(/\s+/g, "");

  const [linked, savingsHere, warning] = await Promise.all([
    prisma.failureLog.findMany({
      where: { userId: event.userId, eventId },
      orderBy: { occurredAt: "desc" },
      select: {
        description: true,
        estimatedLossYen: true,
        outcome: true,
      },
    }),
    prisma.savingsEntry.findMany({
      where: { userId: event.userId, eventId, confirmedByUser: true },
      select: {
        amountYen: true,
        failureLog: { select: { description: true } },
      },
    }),
    getWarningForEvent(event).catch(() => null),
  ]);

  if (!past) {
    const seen = new Set<string>();
    const anticipated: string[] = [];
    const add = (raw: string) => {
      const t = raw.trim();
      const k = norm(t);
      if (!t || seen.has(k)) return;
      seen.add(k);
      anticipated.push(t);
    };
    for (const c of warning?.logs ?? []) add(c.description);
    for (const l of linked) {
      if (l.outcome !== "irrelevant" && l.outcome !== "prevented") {
        add(l.description);
      }
    }
    return {
      isPast: false,
      anticipated: anticipated.slice(0, 5),
      avoided: [],
      occurred: [],
    };
  }

  // 終了後: 回避した失敗（この予定で「防げた」と計上されたもの＋紐づけ済みで prevented）
  const avoided = new Map<string, { text: string; yen: number }>();
  for (const s of savingsHere) {
    const text = s.failureLog?.description?.trim();
    if (!text) continue;
    avoided.set(norm(text), { text, yen: Math.max(0, s.amountYen) });
  }
  for (const l of linked) {
    if (l.outcome !== "prevented") continue;
    const k = norm(l.description);
    if (!avoided.has(k)) {
      avoided.set(k, {
        text: l.description.trim(),
        yen: Math.max(0, l.estimatedLossYen),
      });
    }
  }

  // 今回の失敗（直接記録された失敗＝ not_prevented か未確認）。
  // "linked"（＝提案を紐付けただけ・結果未確定）や irrelevant は断定しない。
  const occurred = new Map<string, string>();
  for (const l of linked) {
    if (l.outcome !== "not_prevented" && l.outcome !== null) continue;
    const k = norm(l.description);
    if (avoided.has(k) || occurred.has(k)) continue;
    occurred.set(k, l.description.trim());
  }

  return {
    isPast: true,
    anticipated: [],
    avoided: [...avoided.values()].slice(0, 5),
    occurred: [...occurred.values()].slice(0, 5),
  };
}
