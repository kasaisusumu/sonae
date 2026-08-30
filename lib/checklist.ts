import { prisma } from "@/lib/prisma";
import { buildChecklistForEvent, type BuiltItem } from "@/lib/suggest";
import { syncEventDescription } from "@/lib/description-sync";

export interface DraftItem {
  title: string;
  timingLabel: string | null;
  isDone?: boolean;
  isUserAdded?: boolean;
}

/** 予定のチェックリスト項目を丸ごと置き換える（ユーザー編集の保存用。提案メタは持たない）。 */
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

function persistData(eventId: string, items: BuiltItem[]) {
  return items.map((it, i) => ({
    eventId,
    title: it.title.trim(),
    timingLabel: it.timingLabel?.trim() || null,
    sortOrder: i,
    isSuggested: it.isSuggested,
    suggestionType: it.suggestionType,
    suggestionRuleId: it.suggestionRuleId,
    suggestionValue: it.suggestionValue,
  }));
}

/** ベース生成＋学習ルール適用で準備リストを（再）生成し、丸ごと保存する。 */
export async function generateAndSaveChecklist(eventId: string): Promise<void> {
  const items = await buildChecklistForEvent(eventId);
  await prisma.$transaction([
    prisma.checklistItem.deleteMany({ where: { eventId } }),
    prisma.checklistItem.createMany({ data: persistData(eventId, items) }),
  ]);
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
      await syncEventDescription(t.id);
    } catch (e) {
      console.error("[prime] 生成失敗 eventId=%s", t.id, e);
    }
  }
}
