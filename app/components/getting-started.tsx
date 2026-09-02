import { prisma } from "@/lib/prisma";
import { GettingStartedClient } from "./getting-started-client";

/**
 * はじめての人向けの「はじめかた」カード。
 * つなぐ → 予定 → リスト確認 → ホーム画面に追加 → 通知オン、の順に案内する。
 * 各手順はタップで具体的な説明がひらく。全部おわると自動で消える。
 */
export async function GettingStarted({ userId }: { userId: string }) {
  const [account, eventCount, itemCount, pushCount] = await Promise.all([
    prisma.userGoogleAccount.findUnique({
      where: { userId },
      select: { userId: true },
    }),
    prisma.event.count({ where: { userId } }),
    prisma.checklistItem.count({ where: { event: { userId } } }),
    prisma.pushSubscription.count({ where: { userId } }),
  ]);

  return (
    <GettingStartedClient
      step1={Boolean(account)}
      step2={eventCount > 0}
      step3={itemCount > 0}
      step5={pushCount > 0}
    />
  );
}
