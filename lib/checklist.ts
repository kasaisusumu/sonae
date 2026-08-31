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

function persistData(
  eventId: string,
  items: BuiltItem[],
  comments: Map<string, string>,
) {
  const key = (kind: string, title: string) =>
    `${kind}:${title.toLowerCase().replace(/\s+/g, "")}`;
  return items.map((it, i) => ({
    eventId,
    kind: it.kind,
    title: it.title.trim(),
    timingLabel: it.timingLabel?.trim() || null,
    notifyLeadMinutes: it.isSuggested ? null : it.notifyLeadMinutes,
    comment: it.isSuggested ? null : comments.get(key(it.kind, it.title)) ?? null,
    sortOrder: i,
    isSuggested: it.isSuggested,
    suggestionType: it.suggestionType,
    suggestionRuleId: it.suggestionRuleId,
    suggestionValue: it.suggestionValue,
  }));
}

/** ベース生成＋学習ルール適用で準備リストを（再）生成し、丸ごと保存する。既存コメントは引き継ぐ。 */
export async function generateAndSaveChecklist(eventId: string): Promise<void> {
  const existing = await prisma.checklistItem.findMany({
    where: { eventId, comment: { not: null } },
    select: { kind: true, title: true, comment: true },
  });
  const comments = new Map<string, string>();
  for (const e of existing) {
    if (e.comment) {
      comments.set(
        `${e.kind}:${e.title.toLowerCase().replace(/\s+/g, "")}`,
        e.comment,
      );
    }
  }

  const items = await buildChecklistForEvent(eventId);
  await prisma.$transaction([
    prisma.checklistItem.deleteMany({ where: { eventId } }),
    prisma.checklistItem.createMany({
      data: persistData(eventId, items, comments),
    }),
  ]);
}

/** チェックリストが未生成なら生成する（予定詳細を開いたときの遅延生成）。 */
export async function ensureChecklistForEvent(eventId: string): Promise<void> {
  const count = await prisma.checklistItem.count({ where: { eventId } });
  if (count === 0) await generateAndSaveChecklist(eventId);
}

const normTitle = (s: string) => s.toLowerCase().replace(/\s+/g, "").trim();

/** ある予定のチェックリスト（提案含む全部）を、別の予定にそのままコピーする（AI 不要）。 */
async function copyChecklistItems(
  fromEventId: string,
  toEventId: string,
): Promise<void> {
  const src = await prisma.checklistItem.findMany({
    where: { eventId: fromEventId },
    orderBy: { sortOrder: "asc" },
  });
  await prisma.$transaction([
    prisma.checklistItem.deleteMany({ where: { eventId: toEventId } }),
    prisma.checklistItem.createMany({
      data: src.map((it) => ({
        eventId: toEventId,
        kind: it.kind,
        title: it.title,
        timingLabel: it.timingLabel,
        comment: it.comment,
        notifyLeadMinutes: it.notifyLeadMinutes,
        isUserAdded: it.isUserAdded,
        sortOrder: it.sortOrder,
        isSuggested: it.isSuggested,
        suggestionType: it.suggestionType,
        suggestionRuleId: it.suggestionRuleId,
        suggestionValue: it.suggestionValue,
      })),
    }),
  ]);
}

/**
 * 通知済みでまだ準備リストが無い予定を先行生成し、説明欄にも反映する。
 * cron / webhook / ダッシュボード表示後（after）から呼ぶ。生成した件数を返す。
 * アプリを開かなくてもリストが用意されるための要。
 *
 * AI 負荷の最小化: 繰り返し系列・同カテゴリ同名 のまとまりごとに 1 件だけ生成し、
 * 残りはその結果をコピーする（OpenAI 呼び出しはまとまりあたり最大 1 回）。
 */
export async function primeNotifiedChecklists(
  userId: string,
  limit = 3,
): Promise<number> {
  if (limit <= 0) return 0;
  const targets = await prisma.event.findMany({
    where: {
      userId,
      source: "google",
      autoManaged: true,
      eventDatetime: { gte: new Date() },
      checklistItems: { none: {} },
    },
    orderBy: { eventDatetime: "asc" },
    take: limit,
    select: { id: true, title: true, categoryId: true, recurringEventId: true },
  });
  if (targets.length === 0) return 0;

  const groups = new Map<string, typeof targets>();
  for (const t of targets) {
    const key = t.recurringEventId
      ? `s:${t.recurringEventId}`
      : `t:${t.categoryId ?? "-"}:${normTitle(t.title)}`;
    const arr = groups.get(key);
    if (arr) arr.push(t);
    else groups.set(key, [t]);
  }

  const results = await Promise.all(
    [...groups.values()].map(async (g) => {
      const [first, ...rest] = g;
      let n = 0;
      try {
        await generateAndSaveChecklist(first.id); // まとまりにつき最大 1 回の生成
        await syncEventDescription(first.id);
        n++;
        for (const r of rest) {
          try {
            await copyChecklistItems(first.id, r.id);
            await syncEventDescription(r.id);
            n++;
          } catch (e) {
            console.error("[prime] コピー失敗 eventId=%s", r.id, e);
          }
        }
      } catch (e) {
        console.error("[prime] 生成失敗 eventId=%s", first.id, e);
      }
      return n;
    }),
  );
  return results.reduce((a, b) => a + b, 0);
}
