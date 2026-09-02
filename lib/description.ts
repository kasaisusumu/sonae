import crypto from "node:crypto";
import { formatLead, parseLead } from "@/lib/lead-time";
import { sectionKeyFromLabel, sectionLabel } from "@/lib/sections";

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
  kind?: string;
  title: string;
  /** 予定開始の何分前に通知するか。null = 通知なし。説明欄では「（3時間前）」等で表示。 */
  notifyLeadMinutes?: number | null;
  isDone?: boolean;
  comment?: string | null;
}

function bullet(it: DescItem): string {
  const lead = formatLead(it.notifyLeadMinutes ?? null);
  const label = lead
    ? `${oneLine(it.title)}（${lead}）`
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
/** 未チェックを上、チェック済みを下へ（同グループ内の並びは維持＝安定ソート）。 */
export function checkedLast<T extends { isDone?: boolean }>(a: T, b: T): number {
  return (a.isDone ? 1 : 0) - (b.isDone ? 1 : 0);
}

const UNREVIEWED_NOTE =
  "※ このリストはまだ確認されていません。アプリで「確認しました」を押すか、内容を編集すると消えます。";

/** 「done/total」表記（total 0 なら空）。 */
function progress(items: DescItem[]): string {
  if (items.length === 0) return "";
  const done = items.filter((i) => i.isDone).length;
  return ` ${done}/${items.length}`;
}

/** 失敗まわりの追記（リンクの下・準備リストの前に置く情報セクション）。 */
export interface DescFailureSections {
  /** 予定終了前: 予想される（＝過去に似た予定であった）失敗の内容。 */
  anticipated?: string[];
  /** 予定終了後: 今回は回避できた失敗（内容と推定額）。 */
  avoided?: { text: string; yen: number }[];
  /** 予定終了後: 今回起きてしまった失敗の内容。 */
  occurred?: string[];
}

export interface BuildBlockOpts {
  /** 生成後まだ確認も編集もされていない → 冒頭に注記を入れる。 */
  unreviewed?: boolean;
  /** 枠（セクション）のキー順。省略時は項目から task→belonging→その他 で導出。 */
  sections?: string[];
  /** 失敗の予想／結果。中身のある枠だけ書き出す（無ければ見出しごと出さない）。 */
  failures?: DescFailureSections;
}

/** 情報表示だけの見出し（逆パースでは項目として取り込まない）。 */
export const INFO_HEADINGS = new Set([
  "予想される失敗",
  "回避した失敗",
  "今回の失敗",
]);

function yen(n: number): string {
  return `¥${Math.round(n).toLocaleString("ja-JP")}`;
}

/** 失敗セクション（予想／回避／今回）を行配列にする。中身が無い枠は出さない。 */
function failureLines(f: DescFailureSections | undefined): string[] {
  if (!f) return [];
  const out: string[] = [];
  if (f.anticipated && f.anticipated.length > 0) {
    out.push("", "【予想される失敗】");
    for (const t of f.anticipated) out.push(`⚠ ${oneLine(t)}`);
  }
  if (f.avoided && f.avoided.length > 0) {
    out.push("", "【回避した失敗】");
    for (const a of f.avoided) {
      out.push(
        `🛡 ${oneLine(a.text)}${a.yen > 0 ? `（推定 ${yen(a.yen)}）` : ""}`,
      );
    }
  }
  if (f.occurred && f.occurred.length > 0) {
    out.push("", "【今回の失敗】");
    for (const t of f.occurred) out.push(`😓 ${oneLine(t)}`);
  }
  return out;
}

export function buildSonaeBlock(
  url: string,
  items: DescItem[],
  opts: BuildBlockOpts = {},
): string {
  const kindOf = (i: DescItem) => i.kind ?? "task";
  const used = new Set(items.map(kindOf));
  const order = (
    opts.sections && opts.sections.length > 0
      ? opts.sections
      : [
          "task",
          "belonging",
          ...[...used].filter((k) => k !== "task" && k !== "belonging"),
        ]
  ).filter((k) => !k.startsWith("@")); // "@faillog" 等の特別キーは説明欄に出さない

  const lines = [START, `準備リスト: ${url}`];
  if (opts.unreviewed) lines.push("", UNREVIEWED_NOTE);

  // リンクの下・準備リストの前に「予想される失敗 / 回避した失敗 / 今回の失敗」。
  lines.push(...failureLines(opts.failures));

  const seen = new Set<string>();
  for (const key of order) {
    if (seen.has(key)) continue;
    seen.add(key);
    const group = items.filter((i) => kindOf(i) === key).sort(checkedLast);
    // 中身が無い枠は、見出しごと説明欄に出さない（「準備すること」等も同じ）。
    if (group.length === 0) continue;
    lines.push("", `【${sectionLabel(key)}】${progress(group)}`);
    lines.push(...group.map(bullet));
  }

  lines.push(END);
  return lines.join("\n");
}

export function composeDescription(
  originalMemo: string | null,
  url: string,
  items: DescItem[],
  opts: BuildBlockOpts = {},
): string {
  const base = stripSonaeBlock(originalMemo);
  const block = buildSonaeBlock(url, items, opts);
  return base ? `${base}\n\n${block}` : block;
}

export function hashDescription(s: string): string {
  return crypto.createHash("sha256").update(s, "utf8").digest("hex");
}

// ── 説明欄の逆パース（ユーザーが Google 上で直接編集した内容を取り込む）──

export interface ParsedItem {
  kind: string;
  title: string;
  /** 末尾「（3時間前）」等から解釈した通知リード時間（分）。解釈できなければ null。 */
  notifyLeadMinutes: number | null;
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
  let kind = "task";
  // 「予想される失敗」等の情報セクションに入っている間は、行を項目として取り込まない。
  let skipInfo = false;

  for (const rawLine of body.split("\n")) {
    // 行頭の字下げ（半角/全角スペース・タブ・ノーブレークスペース）を検出してから整形する
    const probe = rawLine.replace(/[　 ]/g, " ");
    const indented = /^[ \t]+\S/.test(probe);
    const line = probe.trim();
    if (!line) continue;

    // 見出し【〜】（末尾に「 2/5」等の進捗が付くことがあるので $ で固定しない）。
    // 組み込みは英語キーに、それ以外は見出し名そのものを枠キーにする。
    const hm = line.match(/^【\s*([^【】]+?)\s*】/);
    if (hm) {
      const label = hm[1].trim();
      if (INFO_HEADINGS.has(label)) {
        skipInfo = true;
        continue;
      }
      skipInfo = false;
      kind = sectionKeyFromLabel(label);
      continue;
    }
    // 情報セクション（予想される失敗 など）の中身は読み飛ばす
    if (skipInfo) continue;
    // 「未確認」注記行は取り込み対象外
    if (/^※/.test(line)) continue;
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

    let notifyLeadMinutes: number | null = null;
    const tm = t.match(/^(.*)[（(]\s*([^（()）]+?)\s*[）)]\s*$/);
    if (tm) {
      const inner = tm[2].trim();
      const lead = parseLead(inner);
      // 「（3時間前）」等はリード時間として取り込む。解釈できない括弧はタイトルの一部として残す。
      if (lead !== null || /なし|前|開始/.test(inner)) {
        t = tm[1].trim();
        notifyLeadMinutes = lead;
      }
    }
    if (!t) continue;
    items.push({ kind, title: t, notifyLeadMinutes, isDone, comment: null });
  }

  return { hasBlock: true, items };
}
