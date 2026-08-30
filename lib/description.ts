import crypto from "node:crypto";

const START = "--- 私のマネージャー ---";
const START_ALT = "--- そなえ ---"; // 旧マーカー（互換のため除去対象に含める）
const END = "---";

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * 既存の説明欄から自アプリのブロックを取り除く（ユーザーが書いた内容だけ残す）。
 * 新旧マーカー・<br> 変換の両方に対応。
 */
export function stripSonaeBlock(desc: string | null | undefined): string {
  if (!desc) return "";
  let out = desc.replace(/<br\s*\/?>/gi, "\n");
  for (const mark of [START, START_ALT]) {
    const re = new RegExp(
      `\\n*${escapeRe(mark)}[\\s\\S]*?\\n${escapeRe(END)}[ \\t]*(\\n|$)`,
      "g",
    );
    out = out.replace(re, "\n");
  }
  return out.replace(/\n{3,}/g, "\n\n").trim();
}

export interface DescItem {
  kind?: "task" | "belonging";
  title: string;
  timingLabel: string | null;
  isDone?: boolean;
}

function bullet(it: DescItem): string {
  const label = it.timingLabel ? `${it.title}（${it.timingLabel}）` : it.title;
  const safe = escapeHtml(label);
  return it.isDone ? `・<s>${safe}</s> ✓` : `・${safe}`;
}

/** ブロック本文（リンク＋準備すること＋持ち物）。完了項目は <s> で取り消し線。 */
export function buildSonaeBlock(url: string, items: DescItem[]): string {
  const tasks = items.filter((i) => (i.kind ?? "task") === "task");
  const belongings = items.filter((i) => i.kind === "belonging");

  const lines = [
    START,
    `準備リスト: <a href="${escapeHtml(url)}">${escapeHtml(url)}</a>`,
  ];
  lines.push("", "【準備すること】");
  lines.push(...(tasks.length ? tasks.map(bullet) : ["・（なし）"]));
  if (belongings.length) {
    lines.push("", "【持ち物】");
    lines.push(...belongings.map(bullet));
  }
  lines.push(END);
  return lines.join("\n");
}

export function composeDescription(
  originalMemo: string | null,
  url: string,
  items: DescItem[],
): string {
  const base = stripSonaeBlock(originalMemo);
  const block = buildSonaeBlock(url, items);
  return base ? `${base}\n\n${block}` : block;
}

export function hashDescription(s: string): string {
  return crypto.createHash("sha256").update(s, "utf8").digest("hex");
}
