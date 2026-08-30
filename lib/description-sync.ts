import { prisma } from "@/lib/prisma";
import { appBaseUrl, writeEventDescription } from "@/lib/google";
import {
  composeDescription,
  hashDescription,
  stripSonaeBlock,
} from "@/lib/description";

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
        select: { title: true, timingLabel: true },
      },
    },
  });
  if (!event || event.source !== "google" || !event.googleEventId) return;

  const account = await prisma.userGoogleAccount.findUnique({
    where: { userId: event.userId },
    select: { writeDescriptionEnabled: true },
  });
  if (!account?.writeDescriptionEnabled) return;

  const url = `${appBaseUrl()}/events/${eventId}`;
  const description = composeDescription(event.memo, url, event.checklistItems);
  const hash = hashDescription(description);
  if (hash === event.lastWrittenHash) return;

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
      // ローカル memo は「そなえブロック」を除いた元メモに正規化しておく
      memo: stripSonaeBlock(event.memo) || null,
    },
  });
}
