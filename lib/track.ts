import { after } from "next/server";
import { prisma } from "@/lib/prisma";

/**
 * 管理画面（/admin）の利用状況分析用に、1回の利用を1行記録する。
 * サーバー側（userId が既に分かっている場所、例: ページ表示）から直接呼ぶ。
 * レスポンスは待たせず（after）、失敗しても本編には影響させない。
 * ページ内容・入力内容などは記録しない（eventKey という固定の識別子だけ）。
 */
export function trackEvent(userId: string | null | undefined, eventKey: string): void {
  if (!userId) return;
  after(async () => {
    await prisma.featureEvent.create({ data: { userId, eventKey } }).catch(() => {});
  });
}
