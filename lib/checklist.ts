import { prisma } from "@/lib/prisma";
import { generateChecklist } from "@/lib/generate";
import { getLearning, type GeneratedItem } from "@/lib/learning";

export interface DraftItem extends GeneratedItem {
  isDone?: boolean;
  isUserAdded?: boolean;
}

/** 予定のチェックリスト項目を丸ごと置き換える。 */
export async function replaceChecklistItems(
  eventId: string,
  items: DraftItem[],
): Promise<void> {
  await prisma.$transaction([
    prisma.checklistItem.deleteMany({ where: { eventId } }),
    prisma.checklistItem.createMany({
      data: items.map((it, i) => ({
        eventId,
        title: it.title.trim(),
        timingLabel: it.timingLabel?.trim() || null,
        isDone: Boolean(it.isDone),
        isUserAdded: Boolean(it.isUserAdded),
        sortOrder: i,
      })),
    }),
  ]);
}

/** カテゴリ学習を反映して準備リストを（再）生成し、保存する。 */
export async function generateAndSaveChecklist(eventId: string): Promise<void> {
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    include: { category: true },
  });
  if (!event) throw new Error("予定が見つかりません。");

  const learning = await getLearning(event.categoryId);
  const { items } = await generateChecklist(
    {
      title: event.title,
      categoryName: event.category?.name ?? "その他",
      eventDatetime: event.eventDatetime,
      memo: event.memo,
    },
    learning,
  );

  await replaceChecklistItems(
    eventId,
    items.map((it) => ({ ...it, isUserAdded: false })),
  );
}

/** チェックリストが未生成なら生成する（予定詳細を開いたときの遅延生成）。 */
export async function ensureChecklistForEvent(eventId: string): Promise<void> {
  const count = await prisma.checklistItem.count({ where: { eventId } });
  if (count === 0) await generateAndSaveChecklist(eventId);
}

/**
 * 通知を送った直近の予定のうち、まだ準備リストが無いものを先行生成する。
 * ダッシュボード表示後に after() で走らせる想定（レスポンスをブロックしない）。
 */
export async function primeNotifiedChecklists(
  userId: string,
  limit = 3,
): Promise<void> {
  const targets = await prisma.event.findMany({
    where: {
      userId,
      notifiedAt: { not: null },
      eventDatetime: { gte: new Date() },
      checklistItems: { none: {} },
    },
    orderBy: { eventDatetime: "asc" },
    take: limit,
    select: { id: true },
  });

  for (const t of targets) {
    try {
      await generateAndSaveChecklist(t.id);
    } catch (e) {
      console.error("[prime] 生成失敗 eventId=%s", t.id, e);
    }
  }
}
