import { prisma } from "@/lib/prisma";

export type TemplateKind = "task" | "belonging";

export type TemplateItem = {
  id: string;
  title: string;
  notifyLeadMinutes: number | null;
};

export type TemplateDetail = {
  id: string;
  kind: TemplateKind;
  name: string;
  updatedAt: Date;
  items: TemplateItem[];
};

export type PastEventWithList = {
  id: string;
  title: string;
  eventDatetime: Date;
  taskCount: number;
  belongingCount: number;
};

/** ユーザーの保存済みテンプレート一覧（新しい順・項目つき）。 */
export async function getUserTemplates(
  userId: string,
): Promise<TemplateDetail[]> {
  const rows = await prisma.listTemplate.findMany({
    where: { userId },
    orderBy: [{ kind: "asc" }, { updatedAt: "desc" }],
    include: { items: { orderBy: { sortOrder: "asc" } } },
  });
  return rows.map((t) => ({
    id: t.id,
    kind: t.kind === "belonging" ? "belonging" : "task",
    name: t.name,
    updatedAt: t.updatedAt,
    items: t.items.map((i) => ({
      id: i.id,
      title: i.title,
      notifyLeadMinutes: i.notifyLeadMinutes ?? null,
    })),
  }));
}

/**
 * 準備リストのある予定（提案でない項目が1つ以上）を新しい順に。
 * 「他の予定からコピー」「過去のデータ参照」用。excludeId は一覧から外す。
 */
export async function getEventsWithLists(
  userId: string,
  excludeId?: string,
  limit = 60,
): Promise<PastEventWithList[]> {
  const rows = await prisma.event.findMany({
    where: {
      userId,
      ...(excludeId ? { id: { not: excludeId } } : {}),
      checklistItems: { some: { isSuggested: false } },
    },
    orderBy: { eventDatetime: "desc" },
    take: limit,
    select: {
      id: true,
      title: true,
      eventDatetime: true,
      checklistItems: {
        where: { isSuggested: false },
        select: { kind: true },
      },
    },
  });
  return rows.map((e) => ({
    id: e.id,
    title: e.title,
    eventDatetime: e.eventDatetime,
    taskCount: e.checklistItems.filter((i) => i.kind !== "belonging").length,
    belongingCount: e.checklistItems.filter((i) => i.kind === "belonging").length,
  }));
}
