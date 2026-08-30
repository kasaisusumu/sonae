import { prisma } from "@/lib/prisma";
import { appBaseUrl, writeEventDescription } from "@/lib/google";
import {
  composeDescription,
  hashDescription,
  stripSonaeBlock,
} from "@/lib/description";

/** Google 上で説明欄を直接編集した直後、この時間だけ正規化の書き戻しを控える（編集画面のカクつき防止）。 */
export const INBOUND_COOLDOWN_MS = 3 * 60_000;

/**
 * 予定の説明欄に、そなえの準備リスト（リンク＋箇条書き）を書き込む。
 * - オプトイン（writeDescriptionEnabled）かつ Google 由来の予定のみ
 * - 提案項目は含めない
 * - 前回書いた内容と同じならスキップ（再書き込み・ループ防止）
 * - respectCooldown: 直近のユーザー編集から INBOUND_COOLDOWN_MS 以内なら書き戻さない
 * after() で呼び、レスポンスをブロックしない想定。
 */
export async function syncEventDescription(
  eventId: string,
  opts: { respectCooldown?: boolean } = {},
): Promise<void> {
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    include: {
      checklistItems: {
        where: { isSuggested: false },
        orderBy: { sortOrder: "asc" },
        select: {
          kind: true,
          title: true,
          timingLabel: true,
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

  if (
    opts.respectCooldown &&
    event.lastInboundEditAt &&
    Date.now() - event.lastInboundEditAt.getTime() < INBOUND_COOLDOWN_MS
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
      timingLabel: c.timingLabel,
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
      lastInboundEditAt: null,
      // ローカル memo は「そなえブロック」を除いた元メモに正規化しておく
      memo: stripSonaeBlock(event.memo) || null,
    },
  });
}

/**
 * ユーザーの直接編集から一定時間が経った予定について、説明欄を正規化（チェックボックス表記）に
 * 書き戻す。cron / webhook から呼ぶ。編集直後の書き戻しは避けつつ、最終的に表記を揃える。
 */
export async function catchUpInboundEdits(
  userId: string,
  limit = 10,
): Promise<number> {
  const cutoff = new Date(Date.now() - INBOUND_COOLDOWN_MS);
  const stale = await prisma.event.findMany({
    where: {
      userId,
      source: "google",
      autoManaged: true,
      lastInboundEditAt: { not: null, lt: cutoff },
    },
    orderBy: { lastInboundEditAt: "asc" },
    take: limit,
    select: { id: true },
  });
  let n = 0;
  for (const e of stale) {
    try {
      await syncEventDescription(e.id);
      n++;
    } catch (err) {
      console.error("[catchUpInboundEdits] eventId=%s", e.id, err);
    }
  }
  // 変更不要で早期 return したものも含め、処理済みとしてフラグを落とす（毎回拾わない）
  if (stale.length > 0) {
    await prisma.event.updateMany({
      where: { id: { in: stale.map((e) => e.id) } },
      data: { lastInboundEditAt: null },
    });
  }
  return n;
}
