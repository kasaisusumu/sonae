import { after } from "next/server";
import { prisma } from "@/lib/prisma";

const JST_TZ = "Asia/Tokyo";

function minuteFloor(d: Date): Date {
  const t = new Date(d);
  t.setUTCSeconds(0, 0);
  return t;
}

/** JST 暦日 "YYYY-MM-DD"。管理画面の日別集計をこのキーでまとめる。 */
export function jstDayKey(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: JST_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

/**
 * 「今このユーザーがアプリを使っている」ことを 1 分単位で記録する。
 * ログイン中のページ表示・操作のたびに `getCurrentUser()` から呼ばれる想定。
 * 同じ分に何度呼ばれても 1 行のまま（`ActivityMinute` の一意制約に任せる冪等 upsert）。
 * レスポンスを遅らせないよう `after()` で本処理後に実行し、失敗しても本編には響かせない。
 * ページの内容・操作の中身は記録しない（量＝アクティブだった分数だけを見る）。
 */
export function recordActivity(userId: string): void {
  after(async () => {
    const minuteAt = minuteFloor(new Date());
    const dayKey = jstDayKey(minuteAt);
    await prisma.activityMinute
      .upsert({
        where: { userId_minuteAt: { userId, minuteAt } },
        update: {},
        create: { userId, minuteAt, dayKey },
      })
      .catch(() => {});
  });
}
