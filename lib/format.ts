// 表示・入力はすべて日本時間（JST）に統一する。
// サーバー（Vercel）は UTC で動くため、toLocale* には必ず timeZone を渡し、
// datetime-local / date 入力は JST として解釈する。
export const JST = "Asia/Tokyo";

export function formatYen(amount: number): string {
  return `¥${Math.round(amount).toLocaleString("ja-JP")}`;
}

export function formatDateTime(d: Date | string): string {
  const date = typeof d === "string" ? new Date(d) : d;
  return date.toLocaleString("ja-JP", {
    timeZone: JST,
    year: "numeric",
    month: "numeric",
    day: "numeric",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatDateShort(d: Date | string): string {
  const date = typeof d === "string" ? new Date(d) : d;
  return date.toLocaleString("ja-JP", {
    timeZone: JST,
    month: "numeric",
    day: "numeric",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** 日付のみ（JST）。「2026/9/1」形式。 */
export function formatDateOnly(d: Date | string): string {
  const date = typeof d === "string" ? new Date(d) : d;
  return date.toLocaleDateString("ja-JP", {
    timeZone: JST,
    year: "numeric",
    month: "numeric",
    day: "numeric",
  });
}

/** ある瞬間の JST での年月日時分を取り出す。 */
function jstParts(d: Date): {
  y: string;
  m: string;
  day: string;
  h: string;
  min: string;
} {
  // en-CA は "YYYY-MM-DD, HH:MM" 形式で扱いやすい
  const s = d.toLocaleString("en-CA", {
    timeZone: JST,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const m = s.match(/(\d{4})-(\d{2})-(\d{2})[,\s]+(\d{2}):(\d{2})/);
  if (!m) {
    return { y: "1970", m: "01", day: "01", h: "00", min: "00" };
  }
  return { y: m[1], m: m[2], day: m[3], h: m[4] === "24" ? "00" : m[4], min: m[5] };
}

/** <input type="datetime-local"> 用の value（JST の壁時計）。 */
export function toDatetimeLocalValue(d: Date): string {
  const p = jstParts(d);
  return `${p.y}-${p.m}-${p.day}T${p.h}:${p.min}`;
}

/** <input type="date"> 用の value（JST の日付）。 */
export function toDateInputValue(d: Date): string {
  const p = jstParts(d);
  return `${p.y}-${p.m}-${p.day}`;
}

/** datetime-local の "YYYY-MM-DDTHH:mm" を JST の時刻として Date に変換。 */
export function parseJstDateTimeLocal(raw: string): Date | null {
  const s = raw.trim();
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(s)) return null;
  const withSec = s.length === 16 ? `${s}:00` : s;
  const d = new Date(`${withSec}+09:00`);
  return isNaN(d.getTime()) ? null : d;
}

/** date 入力の "YYYY-MM-DD" を JST の 0 時として Date に変換。 */
export function parseJstDate(raw: string): Date | null {
  const s = raw.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(`${s}T00:00:00+09:00`);
  return isNaN(d.getTime()) ? null : d;
}

/** いまの JST 日付 "YYYY-MM-DD"。 */
export function jstToday(): string {
  return toDateInputValue(new Date());
}
