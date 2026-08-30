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
  comment?: string | null;
}

function bullet(it: DescItem): string {
  const label = it.timingLabel ? `${it.title}（${it.timingLabel}）` : it.title;
  const safe = escapeHtml(label);
  const main = it.isDone ? `・<s>${safe}</s> ✓` : `・${safe}`;
  const c = it.comment?.trim();
  // コメントはすぐ下に段下げ
  return c ? `${main}\n　　↳ ${escapeHtml(c)}` : main;
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

// ── 説明欄の逆パース（ユーザーが Google 上で直接編集した内容を取り込む）──

export interface ParsedItem {
  kind: "task" | "belonging";
  title: string;
  timingLabel: string | null;
  isDone: boolean;
  comment: string | null;
}

const DONE_MARK =
  /<s>|<\/s>|<del>|<strike>|~~|\[[xX]\]|[✓✔☑]|(?:^|\s)済(?:$|\s)/;

/** 「私のマネージャー」ブロックを行ごとに読み、項目を復元する。ゆるくパースする。 */
export function parseSonaeBlock(desc: string | null | undefined): {
  hasBlock: boolean;
  items: ParsedItem[];
} {
  if (!desc) return { hasBlock: false, items: [] };
  const text = desc.replace(/<br\s*\/?>/gi, "\n");

  let body: string | null = null;
  for (const mark of [START, START_ALT]) {
    const re = new RegExp(
      `${escapeRe(mark)}\\n([\\s\\S]*?)\\n${escapeRe(END)}(?:\\n|$)`,
    );
    const m = text.match(re);
    if (m) {
      body = m[1];
      break;
    }
  }
  if (body === null) return { hasBlock: false, items: [] };

  const items: ParsedItem[] = [];
  let kind: "task" | "belonging" = "task";

  for (const rawLine of body.split("\n")) {
    const line = rawLine.replace(/　/g, " ").trim();
    if (!line) continue;

    if (/^【\s*準備すること\s*】$/.test(line)) {
      kind = "task";
      continue;
    }
    if (/^【\s*持ち物\s*】$/.test(line)) {
      kind = "belonging";
      continue;
    }
    if (/^準備リスト\s*[:：]/.test(line) || /^https?:\/\//.test(line)) continue;

    // コメント行（↳ / └ / -> のあと）→ 直前の項目に付ける
    const cm = line.match(/^(?:↳|└|->|»|→)\s*(.+)$/);
    if (cm) {
      if (items.length) items[items.length - 1].comment = cm[1].trim();
      continue;
    }

    // 箇条書き
    const bm = line.match(/^(?:[・*\-•‣▪]|\d+[.)])\s*(.+)$/);
    const content = bm ? bm[1] : /[（(].+[）)]$/.test(line) ? line : null;
    if (!content) continue;

    const isDone = DONE_MARK.test(content);
    let t = content
      .replace(/<\/?(?:s|del|strike)>/gi, "")
      .replace(/~~/g, "")
      .replace(/\[[xX ]\]/g, "")
      .replace(/[✓✔☑]/g, "")
      .replace(/(?:^|\s)済(?:$|\s)/g, " ")
      .trim();

    let timingLabel: string | null = null;
    const tm = t.match(/^(.*)[（(]\s*([^（()）]+?)\s*[）)]\s*$/);
    if (tm) {
      t = tm[1].trim();
      timingLabel = tm[2].trim() || null;
    }
    if (!t) continue;
    items.push({ kind, title: t, timingLabel, isDone, comment: null });
  }

  return { hasBlock: true, items };
}
