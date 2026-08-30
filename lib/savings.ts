import { prisma } from "@/lib/prisma";
import { FALLBACK_CATEGORY } from "@/lib/categories";

export interface MonthlyPoint {
  key: string; // "2026-08"
  label: string; // "8月"
  amountYen: number;
}

export interface CategoryBreakdown {
  categoryName: string;
  amountYen: number;
  count: number;
}

export interface SavingsSummary {
  totalYen: number;
  thisMonthYen: number;
  entryCount: number;
  monthly: MonthlyPoint[]; // 直近 6 ヶ月（古い→新しい）
  byCategory: CategoryBreakdown[]; // 金額の多い順
  recent: {
    id: string;
    amountYen: number;
    categoryName: string;
    description: string;
    eventTitle: string | null;
    createdAt: Date;
  }[];
}

function monthKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
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

  // 直近 6 ヶ月の枠を用意
  const monthly: MonthlyPoint[] = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    monthly.push({ key: monthKey(d), label: `${d.getMonth() + 1}月`, amountYen: 0 });
  }
  const monthlyIndex = new Map(monthly.map((m, i) => [m.key, i]));

  const catMap = new Map<string, CategoryBreakdown>();
  let totalYen = 0;
  let thisMonthYen = 0;

  for (const e of entries) {
    totalYen += e.amountYen;

    const k = monthKey(e.createdAt);
    if (k === thisMonthKey) thisMonthYen += e.amountYen;
    const mi = monthlyIndex.get(k);
    if (mi !== undefined) monthly[mi].amountYen += e.amountYen;

    const categoryName =
      e.failureLog?.category?.name ??
      e.event?.category?.name ??
      FALLBACK_CATEGORY;
    const cur = catMap.get(categoryName) ?? {
      categoryName,
      amountYen: 0,
      count: 0,
    };
    cur.amountYen += e.amountYen;
    cur.count += 1;
    catMap.set(categoryName, cur);
  }

  const byCategory = [...catMap.values()].sort((a, b) => b.amountYen - a.amountYen);

  return {
    totalYen,
    thisMonthYen,
    entryCount: entries.length,
    monthly,
    byCategory,
    recent: entries.slice(0, 8).map((e) => ({
      id: e.id,
      amountYen: e.amountYen,
      categoryName:
        e.failureLog?.category?.name ??
        e.event?.category?.name ??
        FALLBACK_CATEGORY,
      description: e.failureLog?.description ?? "（失敗ログ削除済み）",
      eventTitle: e.event?.title ?? null,
      createdAt: e.createdAt,
    })),
  };
}
