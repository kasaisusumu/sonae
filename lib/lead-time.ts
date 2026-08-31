// 予定開始の「何日/何時間/何分前」を表す通知リード時間。UI・説明欄・パースで共用。
// 依存なし（クライアントでも使える）。

export const LEAD_PRESETS: { label: string; minutes: number | null }[] = [
  { label: "通知なし", minutes: null },
  { label: "10分前", minutes: 10 },
  { label: "30分前", minutes: 30 },
  { label: "1時間前", minutes: 60 },
  { label: "2時間前", minutes: 120 },
  { label: "3時間前", minutes: 180 },
  { label: "6時間前", minutes: 360 },
  { label: "12時間前", minutes: 720 },
  { label: "1日前", minutes: 1440 },
  { label: "2日前", minutes: 2880 },
  { label: "3日前", minutes: 4320 },
  { label: "1週間前", minutes: 10080 },
];

export const isLeadPreset = (m: number | null): boolean =>
  LEAD_PRESETS.some((p) => p.minutes === m);

/** 分 → 「1日前」「3時間前」「2時間30分前」。null は空文字。 */
export function formatLead(minutes: number | null): string {
  if (minutes == null) return "";
  if (minutes <= 0) return "開始時";
  if (minutes % 10080 === 0) return `${minutes / 10080}週間前`;
  if (minutes % 1440 === 0) return `${minutes / 1440}日前`;
  const h = Math.floor(minutes / 60);
  const mm = minutes % 60;
  return `${h ? `${h}時間` : ""}${mm ? `${mm}分` : ""}前`;
}

/** 「1日前」「3時間前」「2時間30分前」などを分に。解釈できなければ null。 */
export function parseLead(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const t = raw.replace(/\s+/g, "").replace(/[（）()]/g, "");
  if (!t || /^(通知)?なし$/.test(t)) return null;
  if (/^開始時?$/.test(t)) return 0;
  let m = t.match(/^(\d+)週間前$/);
  if (m) return Number(m[1]) * 10080;
  m = t.match(/^(\d+)日前$/);
  if (m) return Number(m[1]) * 1440;
  m = t.match(/^(\d+)時間(?:(\d+)分)?前$/);
  if (m) return Number(m[1]) * 60 + (m[2] ? Number(m[2]) : 0);
  m = t.match(/^(\d+)分前$/);
  if (m) return Number(m[1]);
  return null;
}
