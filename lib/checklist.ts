import { after } from "next/server";
import { prisma } from "@/lib/prisma";
import { normTitle } from "@/lib/text-norm";
import { normalizeMatchText } from "@/lib/future-messages";
import { buildChecklistForEvent, type BuiltItem } from "@/lib/suggest";
import { syncEventDescription } from "@/lib/description-sync";
import { parseLeads, stringifyLeads } from "@/lib/lead-time";
import {
  isBuiltinSection,
  parseSectionOrder,
  stringifySectionOrder,
} from "@/lib/sections";
import { renameItemPriorityKind } from "@/lib/item-priority";

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
    ...(items.length > 0
      ? [
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
        ]
      : []),
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
 * allowAiGeneration=true（既定）: 学習元（再利用・確定ルール・範囲ルール・パターン）が無ければ
 *   AI でたたき台を新規生成する。false にすると、学習元が無ければ何も生成しない
 *   （`buildChecklistForEvent` 参照。カレンダー連携による自動生成だけ false を渡す）。
 */
export async function generateAndSaveChecklist(
  eventId: string,
  opts: { force?: boolean; allowAiGeneration?: boolean } = {},
): Promise<void> {
  await applyLearnedListReminder(eventId);

  // 「作り直す」は意図的なので、全消し状態はいったん解除して生成し直す。
  if (opts.force) {
    await prisma.event.updateMany({
      where: { id: eventId, listCleared: true },
      data: { listCleared: false },
    });
  }

  if (!opts.force) {
    const twinId = await findNameGroupTwinWithList(eventId);
    if (twinId) {
      await copyChecklistItems(twinId, eventId);
      // コピー元（同名の中で listCustomized=false のうち最新の1件）が持たない枠
      // （task/belonging 以外）でも、同名の「他の」予定（切り離され独自の枠を持つ方を
      // 含む）が持っていれば、その枠をそのまま「切り出した枠」として引き継ぐ
      // （ユーザー指摘により2026-10-20:「普通に元々学習元のように切り出した枠として
      // 提案すればいい」。項目を他の枠に混ぜ込まず、独立した枠のまま提案する
      // [[sonae-reused-manual-stays-own-frame]] の方針に合わせる）。
      const ev = await prisma.event.findUnique({
        where: { id: eventId },
        select: { userId: true, title: true },
      });
      if (ev) {
        const covered = new Set(
          (
            await prisma.checklistItem.findMany({
              where: { eventId },
              select: { kind: true },
            })
          ).map((i) => i.kind),
        );
        const seeds = await findCustomSectionSeedsFromNameGroup(
          ev.userId,
          ev.title,
          eventId,
          covered,
        );
        if (seeds.length > 0) {
          await addSeedItemsToEvent(ev.userId, eventId, seeds, {
            markReviewed: false,
          });
        }
      }
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

  const { items, customSectionSeeds } = await buildChecklistForEvent(eventId, {
    allowAiGeneration: opts.allowAiGeneration,
  });
  const rows = persistData(eventId, items, comments);
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
    ...(rows.length > 0
      ? [prisma.checklistItem.createMany({ data: rows })]
      : []),
  ]);

  // 似た過去予定で「そのまま使われていた」名前付きリストは、別の枠として引き継ぐ
  // （task/belonging の作り直しとは別経路）。ただし「作り直す」（force=true、
  // 組み込みの2枠だけを作り直す操作）では行わない。force のたびに引き継ぐと、
  // ユーザーがこの予定でその枠を消した／編集したあとに「作り直す」を押しただけで
  // 勝手に元の内容が復活してしまう（ユーザー指定で修正）。最初の1回（count=0 から
  // 生成するとき）だけの挙動にする。
  if (!opts.force && customSectionSeeds.length > 0) {
    const ev = await prisma.event.findUnique({
      where: { id: eventId },
      select: { userId: true },
    });
    if (ev)
      await addSeedItemsToEvent(ev.userId, eventId, customSectionSeeds, {
        markReviewed: false,
      });
  }

  // 生成しても中身が空（似た予定で「何も出さない」を学習済み 等）なら、
  // 全消し扱いにして、次回以降ムダに再生成しない。
  if (rows.filter((r) => !r.isSuggested).length === 0) {
    const anyReal = await prisma.checklistItem.count({
      where: { eventId, isSuggested: false },
    });
    if (anyReal === 0) {
      await prisma.event.update({
        where: { id: eventId },
        data: { listCleared: true },
      });
    }
  }
}

/**
 * チェックリストが未生成なら生成する（予定詳細を開いたときの遅延生成・「🪄 準備リストを作る」）。
 * allowAiGeneration は generateAndSaveChecklist に渡すだけ（既定 true）。
 */
export async function ensureChecklistForEvent(
  eventId: string,
  opts: { allowAiGeneration?: boolean } = {},
): Promise<void> {
  const ev = await prisma.event.findUnique({
    where: { id: eventId },
    select: { listCleared: true },
  });
  // ユーザーが意図的に全部消した予定は生成しない。
  if (ev?.listCleared) {
    await applyLearnedListReminder(eventId);
    return;
  }
  const count = await prisma.checklistItem.count({ where: { eventId } });
  if (count === 0) {
    await generateAndSaveChecklist(eventId, { allowAiGeneration: opts.allowAiGeneration });
  } else {
    await applyLearnedListReminder(eventId);
  }
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
    select: { listReminderLeads: true },
  });
  if (!learned) return;

  const leads = parseLeads(learned.listReminderLeads);
  await prisma.event.update({
    where: { id: eventId },
    data: {
      listReminderLeads: stringifyLeads(leads),
      sentListReminderLeads: "[]",
      listReminderLeadMinutes: leads[0] ?? null,
    },
  });
}

export { normTitle } from "@/lib/text-norm";

/** ある予定のチェックリスト（提案含む全部）を、別の予定にそのままコピーする（AI 不要）。 */
async function copyChecklistItems(
  fromEventId: string,
  toEventId: string,
): Promise<void> {
  const [src, fromEvent, srcScopes] = await Promise.all([
    prisma.checklistItem.findMany({
      where: { eventId: fromEventId },
      orderBy: { sortOrder: "asc" },
    }),
    prisma.event.findUnique({
      where: { id: fromEventId },
      select: { sectionOrder: true, listCleared: true, userId: true },
    }),
    // コピー元の「次回の出し方」（キーワード等）も引き継ぐ。ここで作らないと、
    // コピーされた項目は範囲ルールの行が一切無いまま「この名前」の既定表示
    // （checklist-editor.tsx の shownScope）になり、実際のキーワードは
    // 出せなかった（ユーザー指摘により2026-10-20）。
    prisma.eventChecklistScope.findMany({
      where: { eventId: fromEventId, status: { not: "dropped" } },
    }),
  ]);

  // 「今回だけ」(event_only) は、その予定限定という意味そのものなので、
  // 同名の別の予定へは一切引き継がない（ユーザー指摘により2026-10-20:
  // 「『今回だけ』になってるやつ、次の提案で出てきてしまっている」）。
  // コピー元（1件の双子）だけでなく、ユーザーの他のどの予定でも「今回だけ」に
  // 決まっている項目名なら対象外にする（ユーザー指摘により2026-10-20:「新しく
  // 予定を作ったら、過去に『今回だけ』になってた項目が『この名前』状態として
  // 提案される」。コピー元の双子自身がその項目について何も決めていない
  // （行が無い）場合、コピー元の行だけを見ても拾えなかった）。
  const [fromScopeRows, otherEventOnly] = await Promise.all([
    Promise.resolve(srcScopes),
    fromEvent
      ? prisma.eventChecklistScope.findMany({
          where: {
            userId: fromEvent.userId,
            scope: "event_only",
            status: { not: "dropped" },
          },
          select: { kind: true, normTitle: true },
        })
      : Promise.resolve([]),
  ]);
  const eventOnlyKeys = new Set([
    ...fromScopeRows
      .filter((s) => s.scope === "event_only")
      .map((s) => `${s.kind}:${s.normTitle}`),
    ...otherEventOnly.map((s) => `${s.kind}:${s.normTitle}`),
  ]);
  const copyableSrc = src.filter(
    (it) => !eventOnlyKeys.has(`${it.kind}:${normTitle(it.title)}`),
  );
  const copyableScopes = srcScopes.filter((s) => s.scope !== "event_only");

  await prisma.$transaction([
    prisma.checklistItem.deleteMany({ where: { eventId: toEventId } }),
    // 枠（セクション）の構成と「全消し」状態もコピー元に合わせる（同名グループの整合）
    prisma.event.update({
      where: { id: toEventId },
      data: {
        sectionOrder:
          fromEvent?.sectionOrder ?? '["task","belonging"]',
        listCleared: fromEvent?.listCleared ?? false,
      },
    }),
    ...(copyableSrc.length > 0
      ? [
          prisma.checklistItem.createMany({
            data: copyableSrc.map((it) => ({
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
        ]
      : []),
    ...(copyableScopes.length > 0 && fromEvent
      ? [
          // 既に toEventId 側で決まっている項目（ユーザーが選び直した等）は
          // 上書きしない（skipDuplicates。@@unique([eventId, kind, normTitle])）。
          prisma.eventChecklistScope.createMany({
            data: copyableScopes.map((s) => ({
              userId: fromEvent.userId,
              eventId: toEventId,
              kind: s.kind,
              normTitle: s.normTitle,
              title: s.title,
              action: s.action,
              scope: s.scope,
              ruleId: s.ruleId,
              reason: s.reason,
              source: s.source,
              status: s.status,
            })),
            skipDuplicates: true,
          }),
        ]
      : []),
  ]);
}

/**
 * source と同名（多少の表記揺れは同一視）で listCustomized=false の予定すべてに、
 * source の内容を配る。source 自身が listCustomized（切り離し済み）なら何もしない。
 */
export async function propagateListToNameGroup(
  sourceEventId: string,
): Promise<string[]> {
  const src = await prisma.event.findUnique({
    where: { id: sourceEventId },
    select: { userId: true, title: true, listCustomized: true },
  });
  if (!src || src.listCustomized) return [];
  // 「同名」の判定は大文字小文字・全角半角・かな/カナ/ローマ字の表記揺れを区別しない
  // normalizeMatchText で行う（ユーザー指摘により2026-10-19）。
  const srcNorm = normalizeMatchText(src.title);
  const candidates = await prisma.event.findMany({
    where: { userId: src.userId, id: { not: sourceEventId }, listCustomized: false },
    select: { id: true, title: true },
  });
  const twins = candidates.filter((c) => normalizeMatchText(c.title) === srcNorm);
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

  const meNorm = normalizeMatchText(me.title);
  const editedCandidates = await prisma.event.findMany({
    where: {
      userId: me.userId,
      id: { not: eventId },
      listCustomized: false,
      editRecords: { some: {} },
    },
    select: { id: true, title: true },
  });
  const otherSource = editedCandidates.find(
    (c) => normalizeMatchText(c.title) === meNorm,
  );
  if (otherSource) {
    await prisma.event.update({
      where: { id: eventId },
      data: { listCustomized: true },
    });
    return [];
  }
  return propagateListToNameGroup(eventId);
}

export type SeedItem = {
  /** "task" / "belonging" / ユーザーが足した枠名（＝表示名そのもの） */
  kind: string;
  title: string;
  notifyLeadMinutes: number | null;
  /** この項目の元になった名前付きリスト（ListTemplate.id）。分かれば渡す（任意）。 */
  sourceTemplateId?: string | null;
};

/**
 * テンプレート適用・他の予定からのコピー・似た予定からの名前付きリスト自動再利用など、
 * 「項目をまとめて予定の準備リストに足す」処理の共通部分（同じ枠・同じ名前はスキップ）。
 * ユーザーが足した枠（買うもの等）で、その予定の枠順にまだ無ければ枠順にも追加する
 * （＝別枠として独立して表示される）。
 * `revalidatePath` は呼ばない（Server Action からも通常の描画中からも呼べるようにするため）。
 * Server Action 側で必要なら呼び出し元が revalidateAppViews 等を別途呼ぶこと。
 */
export async function addSeedItemsToEvent(
  userId: string,
  eventId: string,
  seeds: SeedItem[],
  opts: { markReviewed?: boolean } = {},
): Promise<number> {
  const markReviewed = opts.markReviewed ?? true;
  const event = await prisma.event.findFirst({
    where: { id: eventId, userId },
    include: {
      checklistItems: { select: { kind: true, title: true, sortOrder: true } },
    },
  });
  if (!event) return 0;

  // 枠（kind）を跨いでも、全く同じ言葉の項目は重複して出さない
  // （ユーザー指摘により2026-10-20:「枠を跨いだ全く同じ言葉の重複もないようにして」）。
  // そのため既存項目の判定はタイトルだけ（枠は見ない）で行う。
  const existingTitles = new Set(
    event.checklistItems.map((c) => normTitle(c.title)),
  );
  const nextSort: Record<string, number> = {};
  for (const c of event.checklistItems) {
    nextSort[c.kind] = Math.max(nextSort[c.kind] ?? 0, c.sortOrder + 1);
  }

  const seenTitles = new Set(existingTitles);
  const fresh = seeds.filter((s) => {
    const t = s.title.trim();
    if (!t) return false;
    const nt = normTitle(t);
    if (seenTitles.has(nt)) return false;
    seenTitles.add(nt);
    return true;
  });
  if (fresh.length === 0) return 0;

  const data = fresh.map((s) => {
    const so = nextSort[s.kind] ?? 0;
    nextSort[s.kind] = so + 1;
    return {
      eventId,
      kind: s.kind,
      title: s.title.trim().slice(0, 120),
      notifyLeadMinutes: s.notifyLeadMinutes,
      isUserAdded: true,
      sortOrder: so,
      sourceTemplateId: s.sourceTemplateId ?? null,
    };
  });

  // コピー元にあってこの予定の枠順に無いユーザー枠は、枠順にも足す
  const order = parseSectionOrder(event.sectionOrder);
  const missing = [
    ...new Set(
      fresh
        .map((s) => s.kind)
        .filter((k) => !isBuiltinSection(k) && !order.includes(k)),
    ),
  ];

  await prisma.$transaction([
    prisma.checklistItem.createMany({ data }),
    ...(missing.length
      ? [
          prisma.event.update({
            where: { id: eventId },
            data: {
              sectionOrder: stringifySectionOrder([...order, ...missing]),
            },
          }),
        ]
      : []),
  ]);

  await prisma.event.updateMany({
    where: { id: eventId, autoManaged: false },
    data: { autoManaged: true },
  });
  // ユーザーが明示的に行った操作（テンプレート適用・他の予定からコピー・音声入力の
  // 記録）のときだけ「確認済み」にする。自動生成（generateAndSaveChecklist）からの
  // 内部呼び出しでは markReviewed=false にして、組み込み枠（準備すること・持ち物）が
  // まだ未確認のまま残っているのに「確認しました」ボタンが消えてしまう不具合を防ぐ
  // （ユーザー指摘により2026-10-19修正: ボタンが出ないことがあった）。
  if (markReviewed) {
    await prisma.event.updateMany({
      where: { id: eventId, listReviewedAt: null },
      data: { listReviewedAt: new Date() },
    });
  }
  const twinIds = await resolveNameGroupOnEdit(eventId);
  after(() => {
    void syncEventDescription(eventId);
    for (const id of twinIds) void syncEventDescription(id);
  });
  return fresh.length;
}

/**
 * ある予定の1つの枠（kind）を、別のキーに改名する。sectionOrder の該当キー・対象の
 * ChecklistItem.kind・ChecklistItemImage.kind をまとめて付け替える（中身は動かさない）。
 * `newKind` が既にその予定の別枠として存在する場合は、その枠に合流する（順序からは
 * 旧キーを外すだけ）。`setSourceTemplateId` を渡すと、移した項目の `sourceTemplateId` も
 * 更新する（渡さなければ既存の値のまま）。
 */
export async function renameSectionKind(
  eventId: string,
  oldKind: string,
  newKind: string,
  opts: { setSourceTemplateId?: string | null } = {},
): Promise<void> {
  if (!oldKind || !newKind || oldKind === newKind) return;
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    select: { sectionOrder: true },
  });
  if (!event) return;

  const order = parseSectionOrder(event.sectionOrder);
  const nextOrder = order.includes(newKind)
    ? order.filter((k) => k !== oldKind)
    : order.map((k) => (k === oldKind ? newKind : k));

  const itemData: { kind: string; sourceTemplateId?: string | null } = {
    kind: newKind,
  };
  if ("setSourceTemplateId" in opts) {
    itemData.sourceTemplateId = opts.setSourceTemplateId ?? null;
  }

  await prisma.$transaction([
    prisma.checklistItem.updateMany({
      where: { eventId, kind: oldKind },
      data: itemData,
    }),
    prisma.checklistItemImage.updateMany({
      where: { eventId, kind: oldKind },
      data: { kind: newKind },
    }),
    prisma.event.update({
      where: { id: eventId },
      data: { sectionOrder: stringifySectionOrder(nextOrder) },
    }),
  ]);
  await renameItemPriorityKind(eventId, oldKind, newKind);
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
  const meNorm = normalizeMatchText(me.title);
  const candidates = await prisma.event.findMany({
    where: {
      userId: me.userId,
      id: { not: eventId },
      listCustomized: false,
      checklistItems: { some: { isSuggested: false } },
    },
    orderBy: { createdAt: "desc" },
    select: { id: true, title: true },
  });
  const twin = candidates.find((c) => normalizeMatchText(c.title) === meNorm);
  return twin?.id ?? null;
}

/**
 * 同名の「他の」予定（切り離され独自の枠を持つ方＝listCustomized=true も含む）が
 * 持つ、まだコピー先に無いカスタム枠（task/belonging 以外）を、そのまま「切り出した
 * 枠」として返す（ユーザー指摘により2026-10-20）。
 *
 * 背景: findNameGroupTwinWithList がコピー元に選ぶのは listCustomized=false の中の
 * 最新1件だけなので、ユーザーが個別に編集して切り離した予定（例: 独自の持ち物枠を
 * 追加した回）が持つ枠は、他の同名予定には一切引き継がれなかった。
 * [[sonae-reused-manual-stays-own-frame]] の方針どおり、項目を既存の枠へ混ぜ込まず、
 * 「その枠」のまま addSeedItemsToEvent 経由で独立した別枠として提案する。
 * 枠（kind）ごとに、同名予定のうち一番新しいものの内容を代表にする
 * （同じ枠名が複数の同名予定にまたがって編集されている場合の揺れを避けるため）。
 */
async function findCustomSectionSeedsFromNameGroup(
  userId: string,
  title: string,
  excludeEventId: string,
  alreadyCoveredKinds: Set<string>,
): Promise<SeedItem[]> {
  const meNorm = normalizeMatchText(title);
  const siblings = await prisma.event.findMany({
    where: { userId, id: { not: excludeEventId } },
    orderBy: { createdAt: "desc" },
    select: { id: true, title: true },
  });
  const matchingIds = siblings
    .filter((s) => normalizeMatchText(s.title) === meNorm)
    .map((s) => s.id);
  if (matchingIds.length === 0) return [];

  const pickedByKind = new Map<string, SeedItem[]>();
  for (const siblingId of matchingIds) {
    const [items, scopes] = await Promise.all([
      prisma.checklistItem.findMany({
        where: { eventId: siblingId, isSuggested: false },
        orderBy: { sortOrder: "asc" },
        select: { kind: true, title: true, notifyLeadMinutes: true },
      }),
      prisma.eventChecklistScope.findMany({
        where: { eventId: siblingId, scope: "event_only" },
        select: { kind: true, normTitle: true },
      }),
    ]);
    // 「今回だけ」(event_only) は、その予定限定という意味そのものなので、
    // 他の同名予定への「切り出した枠」の引き継ぎにも含めない（ユーザー指摘により
    // 2026-10-20:「『今回だけ』になってるやつ、次の提案で出てきてしまっている」）。
    const eventOnlyKeys = new Set(
      scopes.map((s) => `${s.kind}:${s.normTitle}`),
    );
    const kindsHere = new Set(
      items
        .filter((i) => !eventOnlyKeys.has(`${i.kind}:${normTitle(i.title)}`))
        .map((i) => i.kind)
        .filter((k) => !isBuiltinSection(k) && !alreadyCoveredKinds.has(k)),
    );
    for (const kind of kindsHere) {
      if (pickedByKind.has(kind)) continue;
      pickedByKind.set(
        kind,
        items
          .filter(
            (i) =>
              i.kind === kind &&
              !eventOnlyKeys.has(`${i.kind}:${normTitle(i.title)}`),
          )
          .map((i) => ({
            kind: i.kind,
            title: i.title,
            notifyLeadMinutes: i.notifyLeadMinutes,
            sourceTemplateId: null,
          })),
      );
    }
  }
  return [...pickedByKind.values()].flat();
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
      listCleared: false, // ユーザーが全部消した予定は先行生成もしない
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
        // 学習元（再利用・確定ルール・範囲ルール・パターン）が無ければ何も生成しない
        // （カレンダー連携による自動生成はAIでのたたき台生成をしない・ユーザー指定）。
        await generateAndSaveChecklist(first.id, { allowAiGeneration: false }); // まとまりにつき最大 1 回の生成
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
