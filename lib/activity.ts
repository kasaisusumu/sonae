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

export type DeviceKind = "pc" | "mobile" | "unknown";

/**
 * User-Agent から PC / スマホを簡易判定する（管理画面の診断目的の概算であり、
 * 偽装・未知のUAへの厳密な対応は行わない）。タブレットはモバイル寄りの挙動が
 * 多いため mobile 側に含める。
 */
export function detectDevice(userAgent: string | null | undefined): DeviceKind {
  if (!userAgent) return "unknown";
  return /Mobi|Android|iPhone|iPod|iPad|IEMobile|BlackBerry|Opera Mini/i.test(userAgent)
    ? "mobile"
    : "pc";
}

/**
 * 「今このユーザーがアプリを使っている」ことを 1 分単位で記録する。
 * ログイン中のページ表示・操作のたびに `getCurrentUser()` から呼ばれる想定。
 * 同じ分に何度呼ばれても 1 行のまま（`ActivityMinute` の一意制約に任せる冪等 upsert）。
 * レスポンスを遅らせないよう `after()` で本処理後に実行し、失敗しても本編には響かせない。
 * ページの内容・操作の中身は記録しない（量＝アクティブだった分数と、PC/スマホの
 * 区別だけを見る）。
 */
export function recordActivity(userId: string, device: DeviceKind): void {
  after(async () => {
    const minuteAt = minuteFloor(new Date());
    const dayKey = jstDayKey(minuteAt);
    await prisma.activityMinute
      .upsert({
        where: { userId_minuteAt: { userId, minuteAt } },
        update: {},
        create: { userId, minuteAt, dayKey, device },
      })
      .catch(() => {});
  });
}
