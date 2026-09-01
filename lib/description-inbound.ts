import { prisma } from "@/lib/prisma";
import {
  hashDescription,
  parseSonaeBlock,
  stripSonaeBlock,
  type ParsedItem,
} from "@/lib/description";
import { syncEventDescription } from "@/lib/description-sync";
import { resolveNameGroupOnEdit } from "@/lib/checklist";
import { extractEventFeature } from "@/lib/features";
import { recordEdit, type GeneratedItem } from "@/lib/learning";
import { resolveSections, stringifySectionOrder } from "@/lib/sections";

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
  // 枠（セクション）は固定ではなく、既存＋受信テキストに現れたキー全部が対象。
  const kinds: string[] = Array.from(
    new Set([
      ...prevAll.map((c) => c.kind),
      ...parsed.items.map((i) => i.kind),
    ]),
  );

  type Diff = {
    removed: string[];
    added: GeneratedItem[];
    renotified: { title: string; leadMinutes: number | null }[];
  };
  const diffs: Record<string, Diff> = {};
  for (const k of kinds) diffs[k] = { removed: [], added: [], renotified: [] };
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
        diffs[kind].added.push({
          title: i.title,
          timingLabel: null,
          notifyLeadMinutes: i.notifyLeadMinutes,
        });
        if (i.notifyLeadMinutes != null) {
          diffs[kind].renotified.push({
            title: i.title,
            leadMinutes: i.notifyLeadMinutes,
          });
        }
      } else {
        if ((p.notifyLeadMinutes ?? null) !== i.notifyLeadMinutes) {
          diffs[kind].renotified.push({
            title: i.title,
            leadMinutes: i.notifyLeadMinutes,
          });
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
      diffs[k].removed.length ||
      diffs[k].added.length ||
      diffs[k].renotified.length,
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
  // 既存項目は「作成時の並び順（sortOrder）」を保つ。説明欄では完了項目が下に
  // 回るが、それは表示上の並べ替えであって authored order は動かさない
  //（アプリ側でチェックを外したときに元の位置へ戻れるように）。
  let maxPrevSort = prevAll.reduce((m, c) => Math.max(m, c.sortOrder), -1);
  const rows = parsed.items.map((i: ParsedItem) => {
    const p = prevKindByTitle.get(`${i.kind}:${norm(i.title)}`);
    const leadUnchanged =
      p && (p.notifyLeadMinutes ?? null) === i.notifyLeadMinutes;
    return {
      eventId,
      kind: i.kind,
      title: i.title,
      timingLabel: p ? p.timingLabel : null,
      comment: i.comment,
      isDone: i.isDone,
      isUserAdded: p ? p.isUserAdded : true,
      // 説明欄の「（3時間前）」からリード時間を取り込む。変わっていなければ送信済みを引き継ぐ。
      notifyLeadMinutes: i.notifyLeadMinutes,
      notifiedAt: leadUnchanged ? p.notifiedAt : null,
      sortOrder: p ? p.sortOrder : ++maxPrevSort,
    };
  });

  // 説明欄で新しい【枠】が増えていたら順序に取り込む。
  const nextSectionOrder = stringifySectionOrder(
    resolveSections(event.sectionOrder, [
      ...prevAll.map((c) => c.kind),
      ...rows.map((r) => r.kind),
    ]),
  );

  await prisma.$transaction([
    prisma.checklistItem.deleteMany({
      where: { eventId, isSuggested: false },
    }),
    ...(rows.length > 0
      ? [prisma.checklistItem.createMany({ data: rows })]
      : []),
    // 説明欄側で消えた項目の、メモ画像を後始末する（残った項目のスロットは追従）。
    ...kinds.map((k) => {
      const slots = rows
        .filter((r) => r.kind === k)
        .map((r) => norm(r.title));
      return prisma.checklistItemImage.deleteMany({
        where:
          slots.length > 0
            ? { eventId, kind: k, slot: { notIn: slots } }
            : { eventId, kind: k },
      });
    }),
    prisma.event.update({
      where: { id: eventId },
      data: {
        memo: memoPart,
        lastInboundHash: inboundHash,
        sectionOrder: nextSectionOrder,
      },
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
      if (d.removed.length || d.added.length || d.renotified.length) {
        await recordEdit({
          eventId,
          categoryId: event.categoryId,
          itemKind: kind,
          feature,
          removed: d.removed,
          added: d.added,
          retimed: [],
          renotified: d.renotified,
        });
      }
    }
  }

  // 内容が変わったら、同名グループの扱い（波及 or 切り離し）を更新する。
  if (structural) {
    try {
      const twinIds = await resolveNameGroupOnEdit(eventId);
      for (const id of twinIds) await syncEventDescription(id);
    } catch (e) {
      console.error("[inbound] 同名グループ処理に失敗 eventId=%s", eventId, e);
    }
  }

  // 構造やメモが変わったときだけ、正規化した内容をその場で書き戻す。
  // チェック／コメントだけの変更では書き戻さない（ユーザーの表記のままで十分・カクつき防止）。
  if (structural || memoChanged) {
    await syncEventDescription(eventId);
  }
}
