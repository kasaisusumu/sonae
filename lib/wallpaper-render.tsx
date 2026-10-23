/**
 * ロック画面用の壁紙画像（2026-10-23追加）。`next/og`（ImageResponse、Node ランタイム）
 * で、ユーザーが登録した背景画像の上に「直近の予定の準備リスト」と「急ぎ／そのうち」を
 * 描き込む。iPhoneのショートカットが `/api/shortcut/wallpaper.png` 経由でこれを取得する。
 *
 * 左半分の準備リストは、カレンダー説明欄に書き込んでいるもの（lib/description.ts の
 * buildSonaeBlock）の「リンク無しバージョン」を忠実に再現する（ユーザー指定）。
 * 見出し・進捗（done/total）・☑/・の記号・リード時間の書式・コメントの字下げ・
 * 💌過去の自分よりメッセージまで、lib/description.ts の同じ関数（bullet・progress・
 * checkedLast・CHECK_DONE/CHECK_TODO・oneLine）をそのまま使う。
 *
 * 表示件数は固定の上限ではなく、パネルの実高さに対する概算の折り返し行数から
 * 動的に決める（ユーザー指摘「文字が書ける場所が余っているなら、そこまで全部
 * 書くようにして」。Satoriは実際の描画結果の高さを事前に教えてくれないため、
 * 1文字ぶんの概算幅（全角1em・半角0.55em）とパネルの実幅から折り返し行数を
 * 見積もり、使った高さを積み上げて「ほかN件」の1行ぶんを必ず残して埋める）。
 */
import fs from "node:fs/promises";
import path from "node:path";
import { ImageResponse } from "next/og";
import { prisma } from "@/lib/prisma";
import { resolveSections, sectionLabel } from "@/lib/sections";
import {
  bullet,
  progress,
  checkedLast,
  oneLine,
  CHECK_DONE,
  CHECK_TODO,
  type DescItem,
} from "@/lib/description";
import { getEventDescriptionMessages } from "@/lib/future-messages";
import { loadPriorityHomeLists, type PriorityHomeRow } from "@/lib/priority-home";
import { loadLockScreenImage } from "@/lib/lock-screen-image";
import { APP_NAME } from "@/lib/app-info";
import { JST } from "@/lib/format";

export const OUTPUT_WIDTH = 1170;
export const MIN_RATIO = 1.5;
export const MAX_RATIO = 2.5;
export const DEFAULT_RATIO = 19.5 / 9;

/** w・h（端末の画面サイズ、単位不問）から出力の縦横比（h/w）を決める。 */
export function resolveAspectRatio(
  wRaw: string | null,
  hRaw: string | null,
  fallbackImageRatio: number | null,
): number {
  const w = Number(wRaw);
  const h = Number(hRaw);
  if (Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0) {
    const r = h / w;
    if (r >= MIN_RATIO && r <= MAX_RATIO) return r;
  }
  if (fallbackImageRatio && fallbackImageRatio >= MIN_RATIO && fallbackImageRatio <= MAX_RATIO) {
    return fallbackImageRatio;
  }
  return DEFAULT_RATIO;
}

let fontCache: Buffer | null = null;
async function loadFont(): Promise<Buffer> {
  if (fontCache) return fontCache;
  const file = path.join(process.cwd(), "assets", "fonts", "KomorebiGothic-P.ttf");
  fontCache = await fs.readFile(file);
  return fontCache;
}

function compactDate(d: Date): string {
  return d.toLocaleString("ja-JP", {
    timeZone: JST,
    month: "numeric",
    day: "numeric",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** 壁紙の描き下ろし時刻（JST）。下部の余白に「最終更新」として小さく表示する。 */
function formatUpdatedAt(d: Date): string {
  return d.toLocaleString("ja-JP", {
    timeZone: JST,
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const LINE_HEIGHT = 1.25;

/** 1文字の概算幅（em単位）。半角英数字・記号は0.55em、それ以外（かな・漢字・絵文字等）は1em とみなす簡易推定。 */
function estimateLineCount(text: string, fontSizePx: number, usableWidthPx: number): number {
  const maxEmPerLine = Math.max(1, usableWidthPx / fontSizePx);
  let emWidth = 0;
  for (const ch of text) {
    emWidth += /[\x00-\xFF]/.test(ch) ? 0.55 : 1;
  }
  return Math.max(1, Math.ceil(emWidth / maxEmPerLine));
}

function textHeight(text: string, fontSizePx: number, usableWidthPx: number): number {
  return fontSizePx * LINE_HEIGHT * estimateLineCount(text, fontSizePx, usableWidthPx);
}

interface LeftLine {
  kind: "header" | "item" | "comment" | "more";
  text: string;
  done?: boolean;
}

const LEFT_HEADER_SIZE = 50;
const LEFT_ITEM_SIZE = 48;
const LEFT_COMMENT_SIZE = 38;
const LEFT_MORE_SIZE = 38;
const LEFT_COMMENT_INDENT = 28;

/**
 * 左半分の行を、カレンダー説明欄と同じ書式・同じ記号で組み立てる。
 * 💌過去の自分よりメッセージ（あれば）を先頭に、そのあと準備リストの各枠を続ける
 * （カレンダー説明欄の buildSonaeBlock と同じ並び。ユーザー指定で2026-10-23に追加）。
 * `budgetPx` に収まるところまで動的に詰め、残りは「ほかN件」にまとめる
 * （見出しを出すのは、その枠から最低1件は表示できるときだけ）。
 */
function buildLeftLines(
  items: DescItem[],
  sections: string[],
  messages: { body: string; isDone: boolean }[],
  usableWidthPx: number,
  budgetPx: number,
): LeftLine[] {
  const lines: LeftLine[] = [];
  let usedPx = 0;
  let omitted = 0;
  const moreReserve = LEFT_MORE_SIZE * LINE_HEIGHT + 10;

  function addGroup(
    headerText: string,
    entries: { text: string; done?: boolean; commentText?: string | null }[],
  ) {
    if (entries.length === 0) return;
    const headerH = textHeight(headerText, LEFT_HEADER_SIZE, usableWidthPx) + (lines.length === 0 ? 0 : 18) + 8;
    const firstH = textHeight(entries[0].text, LEFT_ITEM_SIZE, usableWidthPx);
    if (usedPx + headerH + firstH + moreReserve > budgetPx) {
      omitted += entries.length;
      return;
    }
    lines.push({ kind: "header", text: headerText });
    usedPx += headerH;
    for (const e of entries) {
      const h = textHeight(e.text, LEFT_ITEM_SIZE, usableWidthPx);
      const commentH = e.commentText
        ? textHeight(e.commentText, LEFT_COMMENT_SIZE, usableWidthPx - LEFT_COMMENT_INDENT)
        : 0;
      if (usedPx + h + commentH + moreReserve > budgetPx) {
        omitted++;
        continue;
      }
      lines.push({ kind: "item", text: e.text, done: e.done });
      usedPx += h;
      if (e.commentText) {
        lines.push({ kind: "comment", text: e.commentText });
        usedPx += commentH;
      }
    }
  }

  if (messages.length > 0) {
    addGroup(
      "過去の自分よりメッセージ",
      messages.map((m) => ({
        text: `${m.isDone ? CHECK_DONE : CHECK_TODO} ${oneLine(m.body)}`,
        done: m.isDone,
      })),
    );
  }

  const order = sections.filter((k) => !k.startsWith("@"));
  const seen = new Set<string>();
  for (const key of order) {
    if (seen.has(key)) continue;
    seen.add(key);
    const group = items.filter((i) => (i.kind ?? "task") === key).sort(checkedLast);
    if (group.length === 0) continue;
    addGroup(
      `${sectionLabel(key)}${progress(group)}`,
      group.map((it) => {
        const text = bullet(it);
        const [main, comment] = text.split("\n");
        return { text: main, done: !!it.isDone, commentText: comment?.trim() || null };
      }),
    );
  }

  if (omitted > 0) lines.push({ kind: "more", text: `ほか${omitted}件` });
  return lines;
}

const RIGHT_TITLE_SIZE = 43;
const RIGHT_MORE_SIZE = 34;

/**
 * 右側（急ぎ/そのうち）1枠ぶんの行を、パネルの実高さに収まるところまで動的に詰める。
 * どの予定の項目かは出さない（ユーザー指摘「その項目名の下に小さく書くやつしなくていい」
 * 2026-10-23）。項目名だけの1行ぶんの高さで見積もる。
 */
function selectRightRows(
  rows: PriorityHomeRow[],
  usableWidthPx: number,
  budgetPx: number,
): { shown: PriorityHomeRow[]; omitted: number } {
  const shown: PriorityHomeRow[] = [];
  let usedPx = 0;
  const moreReserve = RIGHT_MORE_SIZE * LINE_HEIGHT + 10;
  for (const r of rows) {
    const h = textHeight(r.title, RIGHT_TITLE_SIZE, usableWidthPx) + 14;
    if (usedPx + h + moreReserve > budgetPx) break;
    shown.push(r);
    usedPx += h;
  }
  return { shown, omitted: Math.max(0, rows.length - shown.length) };
}

const PANEL_BG = "rgba(8,10,16,0.58)";
const PANEL_BORDER = "1px solid rgba(255,255,255,0.14)";
const TEXT_MAIN = "#ffffff";
const TEXT_SUB = "rgba(255,255,255,0.74)";
const TEXT_DONE = "rgba(255,255,255,0.48)";
const TEXT_FAINT = "rgba(255,255,255,0.58)";
// このフォント（木漏れ日ゴシック）には太字の別カットが無いため、文字の縁取り
// （-webkit-text-stroke）で疑似的に太く見せる（ユーザー指摘「文字は太字にしましょっか」、
// 2026-10-23）。fontWeight:700 の指定もあわせて残す（Satoriのフォント選択自体は壊さない）。
const BOLD_STROKE: Record<string, string | number> = {
  WebkitTextStroke: "1.4px currentColor",
};

export async function renderWallpaper(
  userId: string,
  ratio: number,
): Promise<ImageResponse> {
  const width = OUTPUT_WIDTH;
  const height = Math.round(width * ratio);
  const now = new Date();

  const [nextEvent, priorityLists, bgImage, font] = await Promise.all([
    prisma.event.findFirst({
      where: {
        userId,
        OR: [
          { endDatetime: { gt: now } },
          { endDatetime: null, eventDatetime: { gte: now } },
        ],
      },
      orderBy: { eventDatetime: "asc" },
      select: {
        id: true,
        title: true,
        eventDatetime: true,
        sectionOrder: true,
        checklistItems: {
          where: { isSuggested: false },
          orderBy: { sortOrder: "asc" },
          select: { kind: true, title: true, notifyLeadMinutes: true, isDone: true, comment: true },
        },
      },
    }),
    loadPriorityHomeLists(userId),
    loadLockScreenImage(userId),
    loadFont(),
  ]);

  const nextEventMessages = nextEvent ? await getEventDescriptionMessages(nextEvent.id) : [];

  // ── レイアウト寸法 ──
  // 上から: 時計の帯(28%) → アプリ名のウィジェット → すき間 → 本体(左:準備リスト／右:急ぎ・そのうち) → 最終更新+下部アイコン(懐中電灯・カメラ等)との余白(30%)
  // 下の余白は、ロック画面下部の固定アイコン・スマートスタックと被らないよう広めに確保する
  // （ユーザー指摘「下の四つのボタンのやつと被っちゃってる」、実機スクリーンショットで確認、2026-10-23）。
  const topSafe = Math.round(height * 0.28);
  const bottomSafe = Math.round(height * 0.3);
  const outerPad = Math.round(width * 0.035);
  const halfGap = Math.round(width * 0.025);

  const headerWidgetHeight = Math.round(height * 0.06);
  const headerGap = Math.round(height * 0.012);

  const contentHeight = height - topSafe - headerWidgetHeight - headerGap - bottomSafe;
  const halfWidth = Math.round((width - outerPad * 2 - halfGap) / 2);
  const rightGap = Math.round(contentHeight * 0.03);
  const rightBoxHeight = Math.round((contentHeight - rightGap) / 2);

  // 左パネルの、タイトル・日付を除いた「項目一覧」に使える高さ・幅
  const leftPanelPadding = 30;
  const leftUsableWidth = halfWidth - leftPanelPadding * 2;
  const leftTitleH = nextEvent ? textHeight(nextEvent.title, 65, leftUsableWidth) : 0;
  const leftDateH = nextEvent ? 48 * LINE_HEIGHT + 20 : 0;
  const leftLinesBudget = contentHeight - leftPanelPadding * 2 - leftTitleH - leftDateH;

  const leftLines = nextEvent
    ? buildLeftLines(
        nextEvent.checklistItems.map((c) => ({
          kind: c.kind,
          title: c.title,
          notifyLeadMinutes: c.notifyLeadMinutes,
          isDone: c.isDone,
          comment: c.comment,
        })),
        resolveSections(nextEvent.sectionOrder, nextEvent.checklistItems.map((c) => c.kind)),
        nextEventMessages,
        leftUsableWidth,
        leftLinesBudget,
      )
    : [];

  // 右パネルの、見出しを除いた「項目一覧」に使える高さ・幅
  const rightPanelPadding = 28;
  const rightUsableWidth = halfWidth - rightPanelPadding * 2;
  const rightHeadingH = 52 + 20; // PanelHeading の実高さ（絵文字52px・下マージン20px）
  const rightLinesBudget = rightBoxHeight - rightPanelPadding * 2 - rightHeadingH;

  const urgent = selectRightRows(priorityLists.urgent, rightUsableWidth, rightLinesBudget);
  const later = selectRightRows(priorityLists.later, rightUsableWidth, rightLinesBudget);

  const bgDataUri = bgImage
    ? `data:image/jpeg;base64,${bgImage.data.toString("base64")}`
    : null;

  // emoji（🔥🕒）を本文と同じ行に混ぜると、Satoriの絵文字描画が行の高さ計算からはみ出し、
  // 次の行に重なって見えることがある。emojiだけ別のflexアイテムに分けて高さを独立させる。
  function PanelHeading({ emoji, text }: { emoji: string; text: string }) {
    return (
      <div
        style={{
          display: "flex",
          flexDirection: "row",
          alignItems: "center",
          width: "100%",
          marginBottom: 20,
        }}
      >
        <div style={{ fontSize: 52, lineHeight: 1, display: "flex", marginRight: 14 }}>{emoji}</div>
        <div
          style={{
            fontSize: 50,
            lineHeight: 1.25,
            fontWeight: 700,
            color: TEXT_MAIN,
            display: "flex",
            ...BOLD_STROKE,
          }}
        >
          {text}
        </div>
      </div>
    );
  }

  return new ImageResponse(
    (
      <div
        style={{
          width,
          height,
          display: "flex",
          flexDirection: "column",
          position: "relative",
          backgroundColor: "#13161f",
          fontFamily: "KomorebiGothic",
        }}
      >
        {bgDataUri && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={bgDataUri}
            alt=""
            width={width}
            height={height}
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              width: "100%",
              height: "100%",
              objectFit: "cover",
            }}
          />
        )}

        <div style={{ height: topSafe, width: "100%", display: "flex" }} />

        {/* 上部のウィジェット: アプリ名だけを大きく表示する
            （ユーザー指摘で2026-10-23に新設。最終更新は下部の余白に戻した）。 */}
        <div
          style={{
            height: headerWidgetHeight,
            width: "100%",
            display: "flex",
            flexDirection: "row",
            paddingLeft: outerPad,
            paddingRight: outerPad,
          }}
        >
          <div
            style={{
              width: "100%",
              height: "100%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: PANEL_BG,
              border: PANEL_BORDER,
              borderRadius: 26,
            }}
          >
            <div
              style={{
                fontSize: 54,
                lineHeight: 1.2,
                fontWeight: 700,
                color: TEXT_MAIN,
                display: "flex",
                ...BOLD_STROKE,
              }}
            >
              {APP_NAME}
            </div>
          </div>
        </div>

        <div style={{ height: headerGap, width: "100%", display: "flex" }} />

        <div
          style={{
            height: contentHeight,
            width: "100%",
            display: "flex",
            flexDirection: "row",
            paddingLeft: outerPad,
            paddingRight: outerPad,
            gap: halfGap,
          }}
        >
          {/* 左半分: 直近の予定の準備リスト（カレンダー説明欄のリンク無しバージョン） */}
          <div
            style={{
              width: halfWidth,
              height: contentHeight,
              display: "flex",
              flexDirection: "column",
              backgroundColor: PANEL_BG,
              border: PANEL_BORDER,
              borderRadius: 32,
              padding: leftPanelPadding,
              overflow: "hidden",
            }}
          >
            {nextEvent ? (
              <div style={{ display: "flex", flexDirection: "column", width: "100%" }}>
                <div
                  style={{
                    fontSize: 65,
                    lineHeight: 1.22,
                    fontWeight: 700,
                    color: TEXT_MAIN,
                    width: "100%",
                    display: "flex",
                    ...BOLD_STROKE,
                  }}
                >
                  {nextEvent.title}
                </div>
                <div
                  style={{
                    fontSize: 48,
                    lineHeight: 1.22,
                    color: TEXT_SUB,
                    width: "100%",
                    marginBottom: 20,
                    display: "flex",
                  }}
                >
                  {compactDate(nextEvent.eventDatetime)}
                </div>
                <div style={{ display: "flex", flexDirection: "column", width: "100%" }}>
                  {leftLines.map((l, i) => {
                    if (l.kind === "header") {
                      return (
                        <div
                          key={i}
                          style={{
                            fontSize: LEFT_HEADER_SIZE,
                            lineHeight: LINE_HEIGHT,
                            fontWeight: 700,
                            color: TEXT_SUB,
                            width: "100%",
                            marginTop: i === 0 ? 0 : 18,
                            marginBottom: 8,
                            display: "flex",
                            ...BOLD_STROKE,
                          }}
                        >
                          {l.text}
                        </div>
                      );
                    }
                    if (l.kind === "comment") {
                      return (
                        <div
                          key={i}
                          style={{
                            fontSize: LEFT_COMMENT_SIZE,
                            lineHeight: LINE_HEIGHT,
                            color: TEXT_SUB,
                            width: "100%",
                            paddingLeft: LEFT_COMMENT_INDENT,
                            display: "flex",
                          }}
                        >
                          {l.text}
                        </div>
                      );
                    }
                    if (l.kind === "more") {
                      return (
                        <div
                          key={i}
                          style={{
                            fontSize: LEFT_MORE_SIZE,
                            lineHeight: LINE_HEIGHT,
                            color: TEXT_SUB,
                            width: "100%",
                            marginTop: 10,
                            display: "flex",
                          }}
                        >
                          {l.text}
                        </div>
                      );
                    }
                    return (
                      <div
                        key={i}
                        style={{
                          fontSize: LEFT_ITEM_SIZE,
                          lineHeight: LINE_HEIGHT,
                          color: l.done ? TEXT_DONE : TEXT_MAIN,
                          width: "100%",
                          display: "flex",
                        }}
                      >
                        {l.text}
                      </div>
                    );
                  })}
                  {leftLines.length === 0 && (
                    <div style={{ fontSize: 46, lineHeight: 1.25, color: TEXT_SUB, width: "100%", display: "flex" }}>
                      準備リストはまだありません
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div style={{ fontSize: 48, lineHeight: 1.25, color: TEXT_SUB, width: "100%", display: "flex" }}>
                次の予定はありません
              </div>
            )}
          </div>

          {/* 右半分: 急ぎ・そのうち */}
          <div
            style={{
              width: halfWidth,
              height: contentHeight,
              display: "flex",
              flexDirection: "column",
              gap: rightGap,
            }}
          >
            <div
              style={{
                width: "100%",
                height: rightBoxHeight,
                display: "flex",
                flexDirection: "column",
                backgroundColor: PANEL_BG,
                border: PANEL_BORDER,
                borderRadius: 32,
                padding: rightPanelPadding,
                overflow: "hidden",
              }}
            >
              <PanelHeading emoji="🔥" text={`急ぎ（${priorityLists.urgent.length}）`} />
              <div style={{ display: "flex", flexDirection: "column", width: "100%" }}>
                {urgent.shown.map((r) => (
                  <div key={r.key} style={{ display: "flex", flexDirection: "column", width: "100%", marginBottom: 14 }}>
                    <div style={{ fontSize: RIGHT_TITLE_SIZE, lineHeight: LINE_HEIGHT, color: TEXT_MAIN, width: "100%", display: "flex" }}>
                      {r.title}
                    </div>
                  </div>
                ))}
                {urgent.shown.length === 0 && (
                  <div style={{ fontSize: 38, lineHeight: 1.25, color: TEXT_SUB, width: "100%", display: "flex" }}>
                    （なし）
                  </div>
                )}
                {urgent.omitted > 0 && (
                  <div style={{ fontSize: RIGHT_MORE_SIZE, lineHeight: LINE_HEIGHT, color: TEXT_SUB, width: "100%", display: "flex" }}>
                    ほか{urgent.omitted}件
                  </div>
                )}
              </div>
            </div>

            <div
              style={{
                width: "100%",
                height: rightBoxHeight,
                display: "flex",
                flexDirection: "column",
                backgroundColor: PANEL_BG,
                border: PANEL_BORDER,
                borderRadius: 32,
                padding: rightPanelPadding,
                overflow: "hidden",
              }}
            >
              <PanelHeading emoji="🕒" text={`そのうち（${priorityLists.later.length}）`} />
              <div style={{ display: "flex", flexDirection: "column", width: "100%" }}>
                {later.shown.map((r) => (
                  <div key={r.key} style={{ display: "flex", flexDirection: "column", width: "100%", marginBottom: 14 }}>
                    <div style={{ fontSize: RIGHT_TITLE_SIZE, lineHeight: LINE_HEIGHT, color: TEXT_MAIN, width: "100%", display: "flex" }}>
                      {r.title}
                    </div>
                  </div>
                ))}
                {later.shown.length === 0 && (
                  <div style={{ fontSize: 38, lineHeight: 1.25, color: TEXT_SUB, width: "100%", display: "flex" }}>
                    （なし）
                  </div>
                )}
                {later.omitted > 0 && (
                  <div style={{ fontSize: RIGHT_MORE_SIZE, lineHeight: LINE_HEIGHT, color: TEXT_SUB, width: "100%", display: "flex" }}>
                    ほか{later.omitted}件
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* 下部の余白に、最終更新時刻だけ小さく表示する（ユーザー指摘で元の位置に戻した）。 */}
        <div
          style={{
            height: bottomSafe,
            width: "100%",
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "center",
            paddingTop: 10,
          }}
        >
          <div style={{ fontSize: 24, lineHeight: 1.25, color: TEXT_FAINT, display: "flex" }}>
            最終更新: {formatUpdatedAt(now)}
          </div>
        </div>
      </div>
    ),
    {
      width,
      height,
      fonts: [
        { name: "KomorebiGothic", data: font, weight: 400, style: "normal" },
        { name: "KomorebiGothic", data: font, weight: 700, style: "normal" },
      ],
    },
  );
}
