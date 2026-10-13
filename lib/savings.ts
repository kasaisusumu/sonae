import { prisma } from "@/lib/prisma";
import { FALLBACK_CATEGORY } from "@/lib/categories";

export interface CategoryBreakdown {
  categoryName: string;
  count: number;
}

/** 防げた失敗の時系列（件数）。月・週・日で切り替えて見せる用。 */
export interface SeriesItem {
  id: string; // failureLog の id（ポップアップから編集するため）
  description: string;
  eventTitle: string | null;
  categoryName: string | null;
  countermeasure: string | null;
  occurredAt: Date;
  outcome: string | null; // ここに出るものは基本 "prevented"
}
export interface SeriesPoint {
  key: string;
  label: string;
  count: number;
  items: SeriesItem[]; // この区間に「防げた」失敗の具体的な中身
}
export interface SavingsSeries {
  month: SeriesPoint[]; // 直近 6 ヶ月
  week: SeriesPoint[]; // 直近 8 週（週はじまり＝月曜・JST）
  day: SeriesPoint[]; // 直近 14 日
}

export interface SavingsSummary {
  entryCount: number;
  thisMonthCount: number;
  series: SavingsSeries; // 月/週/日 切り替え用（件数）
  byCategory: CategoryBreakdown[]; // 件数の多い順
}

export interface FailureRetroItem {
  id: string;
  description: string;
  occurredAt: Date;
  countermeasure: string | null;
  eventTitle: string | null;
  preventedTimes: number; // この記録が「防げた」に計上された延べ回数
}

export interface FailureRetroCategory {
  categoryName: string;
  count: number;
  lastOccurredAt: Date;
  items: FailureRetroItem[];
}

export interface FailureRetro {
  totalCount: number;
  preventedTotal: number;
  byCategory: FailureRetroCategory[];
}

/** 節約ダッシュボード用: 「防げた」と振り返った失敗ログだけをカテゴリごとにまとめる。 */
export async function getFailureRetrospective(
  userId: string,
): Promise<FailureRetro> {
  const logs = await prisma.failureLog.findMany({
    where: { userId, outcome: "prevented" },
    orderBy: { occurredAt: "desc" },
    include: {
      category: true,
      event: { select: { title: true } },
      savingsEntries: {
        where: { confirmedByUser: true },
        select: { id: true },
      },
    },
  });

  const groups = new Map<string, FailureRetroCategory>();
  let preventedTotal = 0;

  for (const l of logs) {
    preventedTotal += l.savingsEntries.length;

    const name = l.category?.name ?? "カテゴリなし";
    const g =
      groups.get(name) ??
      ({
        categoryName: name,
        count: 0,
        lastOccurredAt: l.occurredAt,
        items: [],
      } satisfies FailureRetroCategory);
    g.count += 1;
    if (l.occurredAt > g.lastOccurredAt) g.lastOccurredAt = l.occurredAt;
    g.items.push({
      id: l.id,
      description: l.description,
      occurredAt: l.occurredAt,
      countermeasure: l.countermeasure,
      eventTitle: l.event?.title ?? null,
      preventedTimes: l.savingsEntries.length,
    });
    groups.set(name, g);
  }

  const byCategory = [...groups.values()].sort(
    (a, b) =>
      b.count - a.count ||
      b.lastOccurredAt.getTime() - a.lastOccurredAt.getTime(),
  );

  return {
    totalCount: logs.length,
    preventedTotal,
    byCategory,
  };
}

function monthKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

// ── JST（Asia/Tokyo）でのカレンダー日付として集計するためのヘルパー ──
// サーバー実行時刻は UTC のため、暦日でのバケット分けは必ず JST に寄せる。
const JST_TZ = "Asia/Tokyo";
function jstYmd(d: Date): { y: number; m: number; day: number } {
  const s = new Intl.DateTimeFormat("en-CA", {
    timeZone: JST_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d); // "2026-08-30"
  const [y, m, day] = s.split("-").map(Number);
  return { y, m, day };
}
/** JST 暦日を「エポックからの日数」に。日付の前後・週区切りの計算に使う。 */
function jstDayNum(d: Date): number {
  const { y, m, day } = jstYmd(d);
  return Math.floor(Date.UTC(y, m - 1, day) / 86_400_000);
}
function fromDayNum(n: number): Date {
  return new Date(n * 86_400_000);
}
/** 月曜=0 の曜日（エポック日 0 = 木曜）。 */
function weekdayMon0(dayNum: number): number {
  return ((dayNum % 7) + 3) % 7;
}
function mdLabel(dayNum: number): string {
  const d = fromDayNum(dayNum);
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
}

/**
 * 防げた（＝節約に計上された）失敗の件数の時系列を月/週/日で用意する。
 * createdAt（「防げた」と選んだ日時）でバケットする。
 */
type SeriesRow = SeriesItem & { createdAt: Date };

function buildSeries(rows: SeriesRow[]): SavingsSeries {
  const now = new Date();
  const today = jstDayNum(now);
  const { y: ny, m: nm } = jstYmd(now);

  const blank = (key: string, label: string): SeriesPoint => ({
    key,
    label,
    count: 0,
    items: [],
  });

  // 月: 直近 6 ヶ月
  const month: SeriesPoint[] = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(Date.UTC(ny, nm - 1 - i, 1));
    const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
    month.push(blank(key, `${d.getUTCMonth() + 1}月`));
  }
  const monthIdx = new Map(month.map((p, i) => [p.key, i]));

  // 週: 直近 8 週（週はじまり＝月曜）
  const thisWeekStart = today - weekdayMon0(today);
  const week: SeriesPoint[] = [];
  for (let i = 7; i >= 0; i--) {
    const start = thisWeekStart - i * 7;
    week.push(blank(String(start), mdLabel(start)));
  }
  const weekIdx = new Map(week.map((p, i) => [p.key, i]));

  // 日: 直近 14 日
  const day: SeriesPoint[] = [];
  for (let i = 13; i >= 0; i--) {
    const n = today - i;
    day.push(blank(String(n), mdLabel(n)));
  }
  const dayIdx = new Map(day.map((p, i) => [p.key, i]));

  const add = (p: SeriesPoint | undefined, r: SeriesRow) => {
    if (!p) return;
    p.count += 1;
    p.items.push({
      id: r.id,
      description: r.description,
      eventTitle: r.eventTitle,
      categoryName: r.categoryName,
      countermeasure: r.countermeasure,
      occurredAt: r.occurredAt,
      outcome: r.outcome,
    });
  };

  for (const r of rows) {
    const n = jstDayNum(r.createdAt);
    const { y, m } = jstYmd(r.createdAt);
    add(month[monthIdx.get(`${y}-${String(m).padStart(2, "0")}`) ?? -1], r);
    add(week[weekIdx.get(String(n - weekdayMon0(n))) ?? -1], r);
    add(day[dayIdx.get(String(n)) ?? -1], r);
  }

  return { month, week, day };
}

export async function getSavingsSummary(userId: string): Promise<SavingsSummary> {
  const entries = await prisma.savingsEntry.findMany({
    where: { userId, confirmedByUser: true },
    include: {
      failureLog: { include: { category: true } },
      event: { include: { category: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  const now = new Date();
  const thisMonthKey = monthKey(now);

  const catMap = new Map<string, CategoryBreakdown>();
  let thisMonthCount = 0;

  for (const e of entries) {
    if (monthKey(e.createdAt) === thisMonthKey) thisMonthCount += 1;

    const categoryName =
      e.failureLog?.category?.name ??
      e.event?.category?.name ??
      FALLBACK_CATEGORY;
    const cur = catMap.get(categoryName) ?? { categoryName, count: 0 };
    cur.count += 1;
    catMap.set(categoryName, cur);
  }

  const byCategory = [...catMap.values()].sort((a, b) => b.count - a.count);

  return {
    entryCount: entries.length,
    thisMonthCount,
    series: buildSeries(
      entries.map((e) => ({
        id: e.failureLogId ?? "",
        createdAt: e.createdAt,
        description: e.failureLog?.description ?? "（失敗ログ削除済み）",
        eventTitle: e.event?.title ?? null,
        categoryName:
          e.failureLog?.category?.name ?? e.event?.category?.name ?? null,
        countermeasure: e.failureLog?.countermeasure ?? null,
        occurredAt: e.failureLog?.occurredAt ?? e.createdAt,
        outcome: e.failureLog?.outcome ?? "prevented",
      })),
    ),
    byCategory,
  };
}
