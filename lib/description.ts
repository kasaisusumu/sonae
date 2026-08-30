import crypto from "node:crypto";

const START = "--- 私のマネージャー ---";
const START_ALT = "--- そなえ ---"; // 旧マーカー（互換のため除去対象に含める）
const END = "---";

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** プレーンテキスト用: 改行を潰し、前後の空白を整える。 */
function oneLine(s: string): string {
  return s.replace(/[\r\n]+/g, " ").replace(/\s+/g, " ").trim();
}

const CHECK_DONE = "☑";
const CHECK_TODO = "☐";
// コメント行の字下げ（半角スペース）。行頭が空白の行はコメントとして扱う。
const COMMENT_INDENT = "    ";

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
  const label = it.timingLabel
    ? `${oneLine(it.title)}（${oneLine(it.timingLabel)}）`
    : oneLine(it.title);
  // 完了はチェック済みアイコン、未完了は空ボックス。取り消し線などの装飾は使わない
  const main = `${it.isDone ? CHECK_DONE : CHECK_TODO} ${label}`;
  const c = it.comment?.trim();
  // コメントはすぐ下の行に字下げ（行頭の空白がコメントの目印）
  return c ? `${main}\n${COMMENT_INDENT}${oneLine(c)}` : main;
}

/**
 * ブロック本文（リンク＋準備すること＋持ち物）。プレーンテキスト。
 * 完了項目は行頭を「☑」、未完了は「☐」で示す（HTML の装飾は入れない）。
 * HTML を入れると Google カレンダーの編集画面で書式警告やカクつきが出るため。
 */
export function buildSonaeBlock(url: string, items: DescItem[]): string {
  const tasks = items.filter((i) => (i.kind ?? "task") === "task");
  const belongings = items.filter((i) => i.kind === "belonging");

  const lines = [START, `準備リスト: ${url}`];
  lines.push("", "【準備すること】");
  lines.push(...(tasks.length ? tasks.map(bullet) : [`${CHECK_TODO} （なし）`]));
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
  /<s>|<\/s>|<del>|<strike>|~~|\[[xX]\]|[✓✔☑✅]|(?:^|\s)済(?:$|\s)/;

// 行頭に付きうるチェックボックス／箇条書き記号（完了・未完了とも）
const BOX_OR_BULLET =
  /^(?:[☐☑✅⬜◻◼■□▪▫✔✓]️?|\[[ xX]\]|[・*\-•‣▸▹])\s*/;

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
    // 行頭の字下げ（半角/全角スペース・タブ・ノーブレークスペース）を検出してから整形する
    const probe = rawLine.replace(/[　 ]/g, " ");
    const indented = /^[ \t]+\S/.test(probe);
    const line = probe.trim();
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

    // 行頭が記号（チェックボックス・箇条書き・番号）、または末尾が「（…）」＝タイミング付き項目
    const startsAsItem =
      BOX_OR_BULLET.test(line) ||
      /^\d+[.)]\s*/.test(line) ||
      /[（(][^（()）]{1,12}[）)]\s*$/.test(line);

    // コメント行 = 旧「↳ / └ / -> / →」マーカー、または「行頭が空白で字下げされた非項目行」。
    // 直前の項目に付ける（複数行あれば空白でつなぐ）。コメントは学習しない。
    const cm = line.match(/^(?:↳|└|->|»|→)\s*(.+)$/);
    if (cm || (indented && !startsAsItem)) {
      const text = (cm ? cm[1] : line).trim();
      if (items.length && text) {
        const prev = items[items.length - 1];
        prev.comment = prev.comment ? `${prev.comment} ${text}` : text;
      }
      continue;
    }

    // チェックボックス／箇条書き行 → 項目
    const isDone = DONE_MARK.test(line);
    let content: string | null = null;
    if (BOX_OR_BULLET.test(line)) {
      content = line.replace(BOX_OR_BULLET, "");
    } else if (/^\d+[.)]\s*/.test(line)) {
      content = line.replace(/^\d+[.)]\s*/, "");
    } else if (/[（(].+[）)]\s*$/.test(line)) {
      content = line; // 記号なしでも「（…）」で終わる行は項目として拾う
    }
    if (!content) continue;

    let t = content
      .replace(/<\/?(?:s|del|strike)>/gi, "")
      .replace(/~~/g, "")
      .replace(/\[[xX ]\]/g, "")
      .replace(/[✓✔☑✅⬜◻◼■□▪▫️]/g, "")
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
