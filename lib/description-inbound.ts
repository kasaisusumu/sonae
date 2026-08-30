import { prisma } from "@/lib/prisma";
import {
  hashDescription,
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
 * ChecklistItem に取り込み、構造変化はその場で学習にも反映する。
 * - writeDescriptionEnabled のときだけ双方向。無効なら memo だけ更新（従来動作）
 * - 完了/未完了・コメントの変更は取り込むが学習しない
 * - 同じ受信テキストは二度処理しない（lastInboundHash）。webhook と cron が
 *   競合しても二重学習しないための要。
 * - 構造が変わったとき（項目の増減・タイミング変更）だけ、正規化した内容を
 *   その場で書き戻す。チェックだけの変更では書き戻さない（編集画面のカクつき防止）。
 */
export async function applyInboundDescription(
  eventId: string,
  rawDescription: string,
): Promise<void> {
  const inboundHash = hashDescription(rawDescription);

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

  // 同じ受信テキストを既に取り込み済みなら何もしない（二重取り込み・二重学習の防止）
  if (event.lastInboundHash === inboundHash) return;

  const markSeen = () =>
    prisma.event.update({
      where: { id: eventId },
      data: { lastInboundHash: inboundHash },
    });

  const memoPart = stripSonaeBlock(rawDescription) || null;

  const account = await prisma.userGoogleAccount.findUnique({
    where: { userId: event.userId },
    select: { writeDescriptionEnabled: true },
  });
  // 自動管理外（連携時に既にあった予定）や書き込み無効なら、memo の更新だけ
  if (!account?.writeDescriptionEnabled || !event.autoManaged) {
    await prisma.event.update({
      where: { id: eventId },
      data: {
        lastInboundHash: inboundHash,
        ...(memoPart !== event.memo ? { memo: memoPart } : {}),
      },
    });
    return;
  }

  const parsed = parseSonaeBlock(rawDescription);
  if (!parsed.hasBlock) {
    // ユーザーがブロックごと消した → wipe せず、DB の内容から即復元
    await prisma.event.update({
      where: { id: eventId },
      data: {
        lastInboundHash: inboundHash,
        ...(memoPart !== event.memo ? { memo: memoPart } : {}),
      },
    });
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
        if (i.timingLabel && (p.timingLabel ?? null) !== i.timingLabel) {
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

  if (!structural && !doneOrCommentChanged && !memoChanged) {
    // Google 側の正規化のみ。受信済みとして記録し終わり。
    await markSeen();
    return;
  }

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
      data: { memo: memoPart, lastInboundHash: inboundHash },
    }),
  ]);

  // 学習（構造変化のみ・種別ごと・その場で反映。完了/コメントは学習しない）
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

  // 構造やメモが変わったときだけ、正規化した内容をその場で書き戻す。
  // チェック／コメントだけの変更では書き戻さない（ユーザーの表記のままで十分・カクつき防止）。
  if (structural || memoChanged) {
    await syncEventDescription(eventId);
  }
}
