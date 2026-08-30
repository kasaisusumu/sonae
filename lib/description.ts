import crypto from "node:crypto";

const START = "--- そなえ ---";
const END = "---";

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * 既存の説明欄から「そなえ」ブロックを取り除く（ユーザーが書いた内容だけ残す）。
 * Google が改行を <br> に変換していても対応する。
 */
export function stripSonaeBlock(desc: string | null | undefined): string {
  if (!desc) return "";
  const normalized = desc.replace(/<br\s*\/?>/gi, "\n");
  const re = new RegExp(
    `\\n*${escapeRe(START)}[\\s\\S]*?\\n${escapeRe(END)}[ \\t]*(\\n|$)`,
    "g",
  );
  return normalized.replace(re, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

export interface DescItem {
  title: string;
  timingLabel: string | null;
  isDone?: boolean;
}

/**
 * 「そなえ」ブロックの本文を組み立てる。
 * リンクは <a>、完了項目は <s>（取り消し線）で表す（Google カレンダーが描画する）。
 */
export function buildSonaeBlock(url: string, items: DescItem[]): string {
  const lines = [
    START,
    `準備リスト: <a href="${escapeHtml(url)}">${escapeHtml(url)}</a>`,
    "",
  ];
  if (items.length === 0) {
    lines.push("・（まだ項目がありません）");
  } else {
    for (const it of items) {
      const label = it.timingLabel
        ? `${it.title}（${it.timingLabel}）`
        : it.title;
      const safe = escapeHtml(label);
      lines.push(it.isDone ? `・<s>${safe}</s> ✓` : `・${safe}`);
    }
  }
  lines.push(END);
  return lines.join("\n");
}

/** ユーザーの元メモ ＋ 最新の「そなえ」ブロック を合成した説明欄全文。 */
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
