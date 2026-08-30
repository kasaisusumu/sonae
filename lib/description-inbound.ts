import { prisma } from "@/lib/prisma";
import {
  parseSonaeBlock,
  stripSonaeBlock,
  type ParsedItem,
} from "@/lib/description";
import { syncEventDescription } from "@/lib/description-sync";
import { extractEventFeature } from "@/lib/features";
import { recordEdit, type GeneratedItem, type ItemKind } from "@/lib/learning";

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, "").trim();

/**
 * Google カレンダー上で説明欄が直接編集されたときに、その内容を
 * ChecklistItem に取り込み、構造変化は学習にも反映する。
 * - writeDescriptionEnabled のときだけ双方向。無効なら memo だけ更新（従来動作）
 * - コメント・完了/未完了の変更は取り込むが学習しない
 * - 自分の書き込みのエコーは呼び出し側の hash 一致でスキップ済みの前提
 */
export async function applyInboundDescription(
  eventId: string,
  rawDescription: string,
): Promise<void> {
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    include: {
      category: true,
      checklistItems: {
        where: { isSuggested: false },
        orderBy: { sortOrder: "asc" },
      },
    },
  });
  if (!event) return;

  const memoPart = stripSonaeBlock(rawDescription) || null;

  const account = await prisma.userGoogleAccount.findUnique({
    where: { userId: event.userId },
    select: { writeDescriptionEnabled: true },
  });
  // 自動管理外（連携時に既にあった予定）や書き込み無効なら、memo の更新だけ
  if (!account?.writeDescriptionEnabled || !event.autoManaged) {
    if (memoPart !== event.memo) {
      await prisma.event.update({ where: { id: eventId }, data: { memo: memoPart } });
    }
    return;
  }

  const parsed = parseSonaeBlock(rawDescription);
  if (!parsed.hasBlock) {
    // ユーザーがブロックごと消した → wipe せず、DB の内容から復元
    if (memoPart !== event.memo) {
      await prisma.event.update({ where: { id: eventId }, data: { memo: memoPart } });
    }
    await syncEventDescription(eventId);
    return;
  }

  const prevAll = event.checklistItems;
  const kinds: ItemKind[] = ["task", "belonging"];

  // 差分（種別ごと）
  const diffs: Record<
    ItemKind,
    { removed: string[]; added: GeneratedItem[]; retimed: { title: string; timingLabel: string }[] }
  > = {
    task: { removed: [], added: [], retimed: [] },
    belonging: { removed: [], added: [], retimed: [] },
  };
  let doneOrCommentChanged = false;

  for (const kind of kinds) {
    const prev = prevAll.filter((c) => c.kind === kind);
    const next = parsed.items.filter((i) => i.kind === kind);
    const prevByTitle = new Map(prev.map((c) => [norm(c.title), c]));
    const nextByTitle = new Map(next.map((i) => [norm(i.title), i]));

    for (const c of prev) {
      if (!nextByTitle.has(norm(c.title))) diffs[kind].removed.push(c.title.trim());
    }
    for (const i of next) {
      const p = prevByTitle.get(norm(i.title));
      if (!p) {
        diffs[kind].added.push({ title: i.title, timingLabel: i.timingLabel });
      } else {
        if (
          i.timingLabel &&
          (p.timingLabel ?? null) !== i.timingLabel
        ) {
          diffs[kind].retimed.push({ title: i.title, timingLabel: i.timingLabel });
        }
        if (
          p.isDone !== i.isDone ||
          (p.comment ?? null) !== (i.comment ?? null)
        ) {
          doneOrCommentChanged = true;
        }
      }
    }
  }

  const structural = kinds.some(
    (k) =>
      diffs[k].removed.length || diffs[k].added.length || diffs[k].retimed.length,
  );
  const memoChanged = memoPart !== event.memo;

  if (!structural && !doneOrCommentChanged && !memoChanged) return; // Google の正規化のみ

  // 非提案項目を、パース結果で丸ごと置き換え（提案行は残す）
  const prevKindByTitle = new Map(
    prevAll.map((c) => [`${c.kind}:${norm(c.title)}`, c]),
  );
  let order = 0;
  const rows = parsed.items.map((i: ParsedItem) => {
    const p = prevKindByTitle.get(`${i.kind}:${norm(i.title)}`);
    return {
      eventId,
      kind: i.kind,
      title: i.title,
      timingLabel: i.timingLabel,
      comment: i.comment,
      isDone: i.isDone,
      isUserAdded: p ? p.isUserAdded : true,
      sortOrder: order++,
    };
  });

  await prisma.$transaction([
    prisma.checklistItem.deleteMany({
      where: { eventId, isSuggested: false },
    }),
    prisma.checklistItem.createMany({ data: rows }),
    prisma.event.update({
      where: { id: eventId },
      // 直後しばらくは正規化の書き戻しを控える（Google 編集画面のカクつき防止）
      data: { memo: memoPart, lastInboundEditAt: new Date() },
    }),
  ]);

  // 学習（構造変化のみ・種別ごと。完了/コメントは学習しない）
  if (event.categoryId && structural) {
    const feature = extractEventFeature({
      title: event.title,
      memo: memoPart,
      eventDatetime: event.eventDatetime,
      endDatetime: event.endDatetime,
    });
    for (const kind of kinds) {
      const d = diffs[kind];
      if (d.removed.length || d.added.length || d.retimed.length) {
        await recordEdit({
          eventId,
          categoryId: event.categoryId,
          itemKind: kind,
          feature,
          removed: d.removed,
          added: d.added,
          retimed: d.retimed,
        });
      }
    }
  }

  // 取り込みは即時。正規化の書き戻しはクールダウン明けまで待つ（カクつき防止）。
  await syncEventDescription(eventId, { respectCooldown: true });
}
