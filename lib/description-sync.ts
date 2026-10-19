import { prisma } from "@/lib/prisma";
import { appBaseUrl, writeEventDescription } from "@/lib/google";
import {
  composeDescription,
  hashDescription,
  stripSonaeBlock,
} from "@/lib/description";
import { resolveSections } from "@/lib/sections";
import { getEventDescriptionMessages } from "@/lib/future-messages";
import { getEventDescriptionFailures } from "@/lib/failures";
import { getFeatureMode, isFailureLogEnabled } from "@/lib/feature-mode";

/**
 * 予定の説明欄に、そなえの準備リスト（リンク＋箇条書き）を書き込む。
 * - オプトイン（writeDescriptionEnabled）かつ Google 由来の予定のみ
 * - 提案項目は含めない
 * - 前回書いた内容と同じならスキップ（再書き込み・ループ防止）
 * after() で呼び、レスポンスをブロックしない想定。
 */
export async function syncEventDescription(eventId: string): Promise<void> {
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    include: {
      checklistItems: {
        where: { isSuggested: false },
        orderBy: { sortOrder: "asc" },
        select: {
          kind: true,
          title: true,
          notifyLeadMinutes: true,
          isDone: true,
          comment: true,
        },
      },
      _count: { select: { editRecords: true } },
    },
  });
  if (
    !event ||
    event.source !== "google" ||
    !event.googleEventId ||
    !event.autoManaged
  ) {
    return;
  }

  const account = await prisma.userGoogleAccount.findUnique({
    where: { userId: event.userId },
    select: { writeDescriptionEnabled: true },
  });
  if (!account?.writeDescriptionEnabled) return;

  // 生成後まだ「確認しました」も編集もされていないか
  const unreviewed =
    !event.listReviewedAt &&
    !event.listCustomized &&
    event._count.editRecords === 0;

  const sections = resolveSections(
    event.sectionOrder,
    event.checklistItems.map((c) => c.kind),
  );

  // 情報セクション（【未来の自分へ】または【予想される失敗】等）は、このユーザーの
  // 現在のモードに応じた方だけを書く（読み取り側は lib/description.ts の
  // INFO_HEADINGS が両方の見出しを認識するので、モードを切り替えても過去に
  // 書いた方の見出しを項目と誤認しない）。
  const mode = await getFeatureMode(event.userId);
  const futureMessages = isFailureLogEnabled(mode)
    ? undefined
    : await getEventDescriptionMessages(eventId);
  const failures = isFailureLogEnabled(mode)
    ? await getEventDescriptionFailures(eventId)
    : undefined;

  // src=cal: 説明欄のこのリンクから開いたときだけ、直接編集の説明ポップアップを出す。
  const url = `${appBaseUrl()}/events/${eventId}?src=cal`;
  const items = event.checklistItems.map((c) => ({
    kind: c.kind,
    title: c.title,
    notifyLeadMinutes: c.notifyLeadMinutes,
    isDone: c.isDone,
    comment: c.comment,
  }));
  const blockOpts = { unreviewed, sections, futureMessages, failures };

  // 実際の内容（最終更新時刻を除く）が前回と同じなら書き込まない。
  // ※ 最終更新時刻を含めたまま比較すると、呼ぶたびに値が変わって
  //   毎回「内容が変わった」と判定され、無限に書き込みが発生してしまう。
  const contentOnly = composeDescription(event.memo, url, items, blockOpts);
  // 最終更新時刻は比較対象から除いているため、「最終更新」行の位置など、
  // 項目の内容に関係ないレイアウトだけを変えた場合は contentOnly の文字列が
  // 変わらず、既に書き込み済みの予定が再書き込みされない（ユーザー指摘により
  // 2026-10-19に発覚）。そのレイアウト変更のたびにこの番号を上げることで、
  // 既存の予定にも一度だけ新しいレイアウトで書き直させる。
  const CONTENT_FORMAT_VERSION = 2;
  const contentHash = hashDescription(`${contentOnly}\u0000fmt${CONTENT_FORMAT_VERSION}`);
  if (contentHash === event.lastWrittenContentHash) return;

  const description = composeDescription(event.memo, url, items, {
    ...blockOpts,
    updatedAt: new Date(),
  });
  const hash = hashDescription(description);

  const ok = await writeEventDescription(
    event.userId,
    event.googleEventId,
    description,
  );
  if (!ok) return;

  await prisma.event.update({
    where: { id: eventId },
    data: {
      lastWrittenHash: hash,
      lastWrittenContentHash: contentHash,
      // 自分の書き込みは「取り込み済み」扱いにして、次のポーリングで拾い直さない
      lastInboundHash: hash,
      // ローカル memo は「そなえブロック」を除いた元メモに正規化しておく
      memo: stripSonaeBlock(event.memo) || null,
    },
  });
}
