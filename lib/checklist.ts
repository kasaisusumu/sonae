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

/**
 * ベース生成＋学習ルール適用で準備リストを（再）生成し、丸ごと保存する。既存コメントは引き継ぐ。
 * force=false（既定）: 同名・未編集の予定が既にリストを持っていれば、生成せずコピーする
 *   （AI 節約＋同名グループの内容を揃える）。force=true: 必ず生成する（作り直す用）。
 */
export async function generateAndSaveChecklist(
  eventId: string,
  opts: { force?: boolean } = {},
): Promise<void> {
  await applyLearnedListReminder(eventId);

  if (!opts.force) {
    const twinId = await findNameGroupTwinWithList(eventId);
    if (twinId) {
      await copyChecklistItems(twinId, eventId);
      return;
    }
  }

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
    // 作り直すのは組み込みの2枠（準備すること・持ち物）だけ。
    // ユーザーが足した枠（買うもの等）は AI では再生成できないので残す。
    prisma.checklistItem.deleteMany({
      where: { eventId, kind: { in: ["task", "belonging"] } },
    }),
    // 作り直す枠の項目メモ画像も後始末（作り直しは内容の上書き）。
    prisma.checklistItemImage.deleteMany({
      where: { eventId, kind: { in: ["task", "belonging"] } },
    }),
    prisma.checklistItem.createMany({
      data: persistData(eventId, items, comments),
    }),
  ]);
}

/** チェックリストが未生成なら生成する（予定詳細を開いたときの遅延生成）。 */
export async function ensureChecklistForEvent(eventId: string): Promise<void> {
  const count = await prisma.checklistItem.count({ where: { eventId } });
  if (count === 0) await generateAndSaveChecklist(eventId);
  else await applyLearnedListReminder(eventId);
}

/**
 * この予定の「準備リストのリマインド」がまだ既定のまま（ユーザー未設定）なら、
 * 同カテゴリで直近にユーザーが設定した値を初期値として採用する。
 * 「一度学習したら学習どおり」（ユーザー指示）を通知にも適用するための処理。
 */
export async function applyLearnedListReminder(eventId: string): Promise<void> {
  const ev = await prisma.event.findUnique({
    where: { id: eventId },
    select: {
      id: true,
      userId: true,
      categoryId: true,
      listReminderTouchedAt: true,
    },
  });
  if (!ev || !ev.categoryId || ev.listReminderTouchedAt) return;

  const learned = await prisma.event.findFirst({
    where: {
      userId: ev.userId,
      categoryId: ev.categoryId,
      id: { not: eventId },
      listReminderTouchedAt: { not: null },
    },
    orderBy: { listReminderTouchedAt: "desc" },
    select: { listReminderLeadMinutes: true },
  });
  if (!learned) return;

  await prisma.event.update({
    where: { id: eventId },
    data: { listReminderLeadMinutes: learned.listReminderLeadMinutes },
  });
}

export const normTitle = (s: string) =>
  s.toLowerCase().replace(/\s+/g, "").trim();

/** ある予定のチェックリスト（提案含む全部）を、別の予定にそのままコピーする（AI 不要）。 */
async function copyChecklistItems(
  fromEventId: string,
  toEventId: string,
): Promise<void> {
  const [src, fromEvent] = await Promise.all([
    prisma.checklistItem.findMany({
      where: { eventId: fromEventId },
      orderBy: { sortOrder: "asc" },
    }),
    prisma.event.findUnique({
      where: { id: fromEventId },
      select: { sectionOrder: true },
    }),
  ]);
  await prisma.$transaction([
    prisma.checklistItem.deleteMany({ where: { eventId: toEventId } }),
    // 枠（セクション）の構成もコピー元に合わせる（同名グループの整合）
    prisma.event.update({
      where: { id: toEventId },
      data: {
        sectionOrder:
          fromEvent?.sectionOrder ?? '["task","belonging"]',
      },
    }),
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
 * source と同名（完全一致）で listCustomized=false の予定すべてに、source の内容を配る。
 * source 自身が listCustomized（切り離し済み）なら何もしない。
 */
export async function propagateListToNameGroup(
  sourceEventId: string,
): Promise<string[]> {
  const src = await prisma.event.findUnique({
    where: { id: sourceEventId },
    select: { userId: true, title: true, listCustomized: true },
  });
  if (!src || src.listCustomized) return [];
  const twins = await prisma.event.findMany({
    where: {
      userId: src.userId,
      id: { not: sourceEventId },
      title: src.title,
      listCustomized: false,
    },
    select: { id: true },
  });
  for (const t of twins) {
    try {
      await copyChecklistItems(sourceEventId, t.id);
    } catch (e) {
      console.error("[propagate] コピー失敗 eventId=%s", t.id, e);
    }
  }
  return twins.map((t) => t.id);
}

/**
 * 準備リストの内容編集が起きたときの、同名グループの扱いを決める。
 * - この予定が既に切り離し済み（listCustomized）→ 何もしない。
 * - 同名で「未編集扱い」かつ編集履歴のある別予定がいる（＝グループの source が別）
 *   → この予定を切り離す（listCustomized=true）。
 * - いなければ、この予定が source → 同名の未編集予定にこの内容を配る。
 * 影響を受けた（内容をコピーした）予定 id の配列を返す（説明欄同期用）。
 * ※ EditRecord をこの予定に作った「後」に呼ぶこと。
 */
export async function resolveNameGroupOnEdit(
  eventId: string,
): Promise<string[]> {
  const me = await prisma.event.findUnique({
    where: { id: eventId },
    select: { userId: true, title: true, listCustomized: true },
  });
  if (!me || me.listCustomized) return [];

  const otherSource = await prisma.event.findFirst({
    where: {
      userId: me.userId,
      id: { not: eventId },
      title: me.title,
      listCustomized: false,
      editRecords: { some: {} },
    },
    select: { id: true },
  });
  if (otherSource) {
    await prisma.event.update({
      where: { id: eventId },
      data: { listCustomized: true },
    });
    return [];
  }
  return propagateListToNameGroup(eventId);
}

/** 同名・未編集の予定が既にリストを持っていれば、そのイベント id を返す。 */
async function findNameGroupTwinWithList(
  eventId: string,
): Promise<string | null> {
  const me = await prisma.event.findUnique({
    where: { id: eventId },
    select: { userId: true, title: true, listCustomized: true },
  });
  if (!me || me.listCustomized) return null;
  const twin = await prisma.event.findFirst({
    where: {
      userId: me.userId,
      id: { not: eventId },
      title: me.title,
      listCustomized: false,
      checklistItems: { some: { isSuggested: false } },
    },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
  return twin?.id ?? null;
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
      // 「本当に新しくカレンダーに追加された予定」＝新規追加通知を出したものだけ。
      // 連携時に一括で読み込んだ既存の予定は notifiedAt が null なので生成しない
      // （それらはユーザーが準備リストのページを開いたときに初めて生成する）。
      notifiedAt: { not: null },
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
