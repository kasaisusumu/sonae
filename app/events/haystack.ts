/**
 * 予定検索用のユーティリティ。サーバー（page.tsx）でもクライアント
 * （event-search.tsx）でも使う純粋関数のみ。日付は Asia/Tokyo で解釈する。
 */

const JST = "Asia/Tokyo";
const WD = ["日", "月", "火", "水", "木", "金", "土"];
const WD_EN: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

function jstParts(d: Date): {
  y: number;
  m: number;
  day: number;
  hour: number;
  wd: number;
} {
  const map = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: JST,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      hour12: false,
    })
      .formatToParts(d)
      .map((p) => [p.type, p.value]),
  );
  const wdStr = new Intl.DateTimeFormat("en-US", {
    timeZone: JST,
    weekday: "short",
  }).format(d);
  return {
    y: Number(map.year),
    m: Number(map.month),
    day: Number(map.day),
    hour: Number(map.hour === "24" ? "0" : map.hour),
    wd: WD_EN[wdStr] ?? 0,
  };
}

function jstDayNumber(d: Date): number {
  const { y, m, day } = jstParts(d);
  return Math.floor(Date.UTC(y, m - 1, day) / 86_400_000);
}

/** かな正規化＋小文字化＋空白畳み。検索の突き合わせに使う。 */
export function normalizeSearch(s: string): string {
  return s
    .toLowerCase()
    .replace(/[ァ-ヶ]/g, (c) =>
      String.fromCharCode(c.charCodeAt(0) - 0x60),
    )
    .replace(/[　\s]+/g, " ")
    .trim();
}

/** 予定日を「日付キー」に（同じ暦日でまとめる用）。 */
export function eventDateKey(d: Date): string {
  const { y, m, day } = jstParts(d);
  return `${y}-${String(m).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function relLabel(d: Date, now: Date): string | null {
  const diff = jstDayNumber(d) - jstDayNumber(now);
  if (diff === 0) return "今日";
  if (diff === 1) return "明日";
  if (diff === 2) return "明後日";
  return null;
}

/** 一覧の日付見出し（小さく出す）。例: 「明日 9/6(土)」。 */
export function eventDateLabel(d: Date, now: Date = new Date()): string {
  const { m, day, wd } = jstParts(d);
  const rel = relLabel(d, now);
  return `${rel ? `${rel} ` : ""}${m}/${day}(${WD[wd]})`;
}

/** 日付にまつわる言い換え（曜日・相対・和暦表記など）を検索語として並べる。 */
export function eventDateTerms(d: Date, now: Date = new Date()): string[] {
  const { y, m, day, hour, wd } = jstParts(d);
  const p2 = (n: number) => String(n).padStart(2, "0");
  const t: string[] = [
    `${y}/${m}/${day}`,
    `${y}-${p2(m)}-${p2(day)}`,
    `${m}/${day}`,
    `${p2(m)}/${p2(day)}`,
    `${m}.${day}`,
    `${m}月${day}日`,
    `${y}年${m}月${day}日`,
    `${m}月`,
    `${y}年`,
    WD[wd],
    `${WD[wd]}曜`,
    `${WD[wd]}曜日`,
    `${hour}時`,
  ];
  if (hour < 12) t.push("午前", "朝");
  else if (hour < 18) t.push("午後", "昼");
  else t.push("夜", "夜間");

  const rel = relLabel(d, now);
  if (rel) t.push(rel, rel === "今日" ? "きょう" : rel === "明日" ? "あした" : "あさって");

  const diff = jstDayNumber(d) - jstDayNumber(now);
  if (diff >= 0 && diff <= 6) t.push("今週");
  else if (diff >= 7 && diff <= 13) t.push("来週");

  const n = jstParts(now);
  if (y === n.y && m === n.m) t.push("今月");
  else if (
    (n.m === 12 && m === 1 && y === n.y + 1) ||
    (m === n.m + 1 && y === n.y)
  ) {
    t.push("来月");
  }
  return t;
}

export interface HaystackEvent {
  title: string;
  eventDatetime: Date;
  memo?: string | null;
  category?: { name: string } | null;
  checklistItems?: { title?: string | null }[];
}

/** 予定 1 件ぶんの検索対象テキスト（正規化済み）。名前・日付・内容を含む。 */
export function eventHaystack(ev: HaystackEvent, now: Date = new Date()): string {
  const parts: string[] = [
    ev.title,
    ev.category?.name ?? "",
    ev.memo ?? "",
    ...(ev.checklistItems ?? []).map((c) => c.title ?? ""),
    ...eventDateTerms(ev.eventDatetime, now),
  ];
  return normalizeSearch(parts.join(" "));
}
