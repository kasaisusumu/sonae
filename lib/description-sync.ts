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
        select: {
          kind: true,
          title: true,
          notifyLeadMinutes: true,
          isDone: true,
          comment: true,
        },
      },
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

  const url = `${appBaseUrl()}/events/${eventId}`;
  const description = composeDescription(
    event.memo,
    url,
    event.checklistItems.map((c) => ({
      kind: c.kind === "belonging" ? "belonging" : "task",
      title: c.title,
      notifyLeadMinutes: c.notifyLeadMinutes,
      isDone: c.isDone,
      comment: c.comment,
    })),
  );
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
      // 自分の書き込みは「取り込み済み」扱いにして、次のポーリングで拾い直さない
      lastInboundHash: hash,
      // ローカル memo は「そなえブロック」を除いた元メモに正規化しておく
      memo: stripSonaeBlock(event.memo) || null,
    },
  });
}
