import crypto from "node:crypto";

const START = "--- そなえ ---";
const END = "---";

/** 既存の説明欄から「そなえ」ブロックを取り除く（ユーザーが書いた内容だけ残す）。 */
export function stripSonaeBlock(desc: string | null | undefined): string {
  if (!desc) return "";
  // START 〜 直後の END 行までを削除
  const re = new RegExp(
    `\\n*${escapeRe(START)}[\\s\\S]*?\\n${escapeRe(END)}[ \\t]*(\\n|$)`,
    "g",
  );
  return desc.replace(re, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export interface DescItem {
  title: string;
  timingLabel: string | null;
}

/** 「そなえ」ブロックの本文を組み立てる（リンク＋準備リストの箇条書き）。 */
export function buildSonaeBlock(url: string, items: DescItem[]): string {
  const lines = [START, `準備リスト: ${url}`, ""];
  if (items.length === 0) {
    lines.push("- （まだ項目がありません）");
  } else {
    for (const it of items) {
      lines.push(
        it.timingLabel ? `- ${it.title}（${it.timingLabel}）` : `- ${it.title}`,
      );
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
