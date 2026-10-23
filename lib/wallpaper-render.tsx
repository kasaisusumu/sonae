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

/** 壁紙の描き下ろし時刻（JST）。上部の小さなウィジェットに「最終更新」として表示する。 */
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

interface LeftLine {
  kind: "header" | "item" | "comment" | "more";
  text: string;
  done?: boolean;
}

// 幅が許す限り項目を出し、空きがあるのに「ほかN件」で早期に畳まない方針（ユーザー指定）。
// Satori側で実際の折り返し後の高さを事前計測できないため、パネルの高さに対して
// 十分に余裕のある上限を置き、実地描画で確認しながら調整した値。
const MAX_LEFT_ITEMS = 5;
const MAX_RIGHT_ITEMS = 2;

/**
 * 左半分の行を、カレンダー説明欄と同じ書式・同じ記号で組み立てる。
 * 💌過去の自分よりメッセージ（あれば）を先頭に、そのあと準備リストの各枠を続ける
 * （カレンダー説明欄の buildSonaeBlock と同じ並び。ユーザー指定で2026-10-23に追加）。
 */
function buildLeftLines(
  items: DescItem[],
  sections: string[],
  messages: { body: string; isDone: boolean }[],
): LeftLine[] {
  const lines: LeftLine[] = [];
  let shown = 0;
  let omitted = 0;

  if (messages.length > 0) {
    lines.push({ kind: "header", text: "過去の自分よりメッセージ" });
    for (const m of messages) {
      if (shown >= MAX_LEFT_ITEMS) {
        omitted++;
        continue;
      }
      lines.push({ kind: "item", text: `${m.isDone ? CHECK_DONE : CHECK_TODO} ${oneLine(m.body)}`, done: m.isDone });
      shown++;
    }
  }

  const order = sections.filter((k) => !k.startsWith("@"));
  const seen = new Set<string>();
  for (const key of order) {
    if (seen.has(key)) continue;
    seen.add(key);
    const group = items.filter((i) => (i.kind ?? "task") === key).sort(checkedLast);
    if (group.length === 0) continue;
    const remaining = MAX_LEFT_ITEMS - shown;
    if (remaining <= 0) {
      omitted += group.length;
      continue;
    }
    const take = group.slice(0, remaining);
    const rest = group.length - take.length;
    lines.push({ kind: "header", text: `${sectionLabel(key)}${progress(group)}` });
    for (const it of take) {
      const text = bullet(it);
      const [main, comment] = text.split("\n");
      lines.push({ kind: "item", text: main, done: !!it.isDone });
      if (comment) lines.push({ kind: "comment", text: comment.trim() });
    }
    shown += take.length;
    omitted += rest;
  }
  if (omitted > 0) lines.push({ kind: "more", text: `ほか${omitted}件` });
  return lines;
}

function rightRows(rows: PriorityHomeRow[]): { shown: PriorityHomeRow[]; omitted: number } {
  return {
    shown: rows.slice(0, MAX_RIGHT_ITEMS),
    omitted: Math.max(0, rows.length - MAX_RIGHT_ITEMS),
  };
}

const PANEL_BG = "rgba(8,10,16,0.58)";
const PANEL_BORDER = "1px solid rgba(255,255,255,0.14)";
const TEXT_MAIN = "#ffffff";
const TEXT_SUB = "rgba(255,255,255,0.74)";
const TEXT_DONE = "rgba(255,255,255,0.48)";
const TEXT_FAINT = "rgba(255,255,255,0.58)";

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
  // 上から: 時計の帯(30%) → アプリ名/最終更新のウィジェット → すき間 → 本体(左:準備リスト／右:急ぎ・そのうち) → 操作ボタンの帯(12%)
  const topSafe = Math.round(height * 0.3);
  const bottomSafe = Math.round(height * 0.12);
  const outerPad = Math.round(width * 0.035);
  const halfGap = Math.round(width * 0.025);

  const headerWidgetHeight = Math.round(height * 0.065);
  const headerGap = Math.round(height * 0.012);

  const contentHeight = height - topSafe - headerWidgetHeight - headerGap - bottomSafe;
  const halfWidth = Math.round((width - outerPad * 2 - halfGap) / 2);
  const rightGap = Math.round(contentHeight * 0.03);
  const rightBoxHeight = Math.round((contentHeight - rightGap) / 2);

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
      )
    : [];

  const urgent = rightRows(priorityLists.urgent);
  const later = rightRows(priorityLists.later);

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
        <div style={{ fontSize: 50, lineHeight: 1.25, fontWeight: 700, color: TEXT_MAIN, display: "flex" }}>
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

        {/* 新しいウィジェット: アプリ名・最終更新（ユーザー指定で2026-10-23追加）。
            下の本体パネルを低くして作った隙間に置く。 */}
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
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: PANEL_BG,
              border: PANEL_BORDER,
              borderRadius: 26,
            }}
          >
            <div style={{ fontSize: 38, lineHeight: 1.2, fontWeight: 700, color: TEXT_MAIN, display: "flex" }}>
              {APP_NAME}
            </div>
            <div style={{ fontSize: 24, lineHeight: 1.2, color: TEXT_FAINT, display: "flex", marginTop: 4 }}>
              最終更新: {formatUpdatedAt(now)}
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
              padding: 30,
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
                            fontSize: 50,
                            lineHeight: 1.25,
                            fontWeight: 700,
                            color: TEXT_SUB,
                            width: "100%",
                            marginTop: i === 0 ? 0 : 18,
                            marginBottom: 8,
                            display: "flex",
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
                            fontSize: 38,
                            lineHeight: 1.25,
                            color: TEXT_SUB,
                            width: "100%",
                            paddingLeft: 28,
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
                            fontSize: 38,
                            lineHeight: 1.25,
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
                          fontSize: 48,
                          lineHeight: 1.25,
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
                padding: 28,
                overflow: "hidden",
              }}
            >
              <PanelHeading emoji="🔥" text={`急ぎ（${priorityLists.urgent.length}）`} />
              <div style={{ display: "flex", flexDirection: "column", width: "100%" }}>
                {urgent.shown.map((r) => (
                  <div key={r.key} style={{ display: "flex", flexDirection: "column", width: "100%", marginBottom: 18 }}>
                    <div style={{ fontSize: 43, lineHeight: 1.25, color: TEXT_MAIN, width: "100%", display: "flex" }}>
                      {r.title}
                    </div>
                    <div style={{ fontSize: 31, lineHeight: 1.25, color: TEXT_SUB, width: "100%", display: "flex" }}>
                      {r.eventTitle}・{compactDate(r.eventDate)}
                    </div>
                  </div>
                ))}
                {urgent.shown.length === 0 && (
                  <div style={{ fontSize: 38, lineHeight: 1.25, color: TEXT_SUB, width: "100%", display: "flex" }}>
                    （なし）
                  </div>
                )}
                {urgent.omitted > 0 && (
                  <div style={{ fontSize: 34, lineHeight: 1.25, color: TEXT_SUB, width: "100%", display: "flex" }}>
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
                padding: 28,
                overflow: "hidden",
              }}
            >
              <PanelHeading emoji="🕒" text={`そのうち（${priorityLists.later.length}）`} />
              <div style={{ display: "flex", flexDirection: "column", width: "100%" }}>
                {later.shown.map((r) => (
                  <div key={r.key} style={{ display: "flex", flexDirection: "column", width: "100%", marginBottom: 18 }}>
                    <div style={{ fontSize: 43, lineHeight: 1.25, color: TEXT_MAIN, width: "100%", display: "flex" }}>
                      {r.title}
                    </div>
                    <div style={{ fontSize: 31, lineHeight: 1.25, color: TEXT_SUB, width: "100%", display: "flex" }}>
                      {r.eventTitle}・{compactDate(r.eventDate)}
                    </div>
                  </div>
                ))}
                {later.shown.length === 0 && (
                  <div style={{ fontSize: 38, lineHeight: 1.25, color: TEXT_SUB, width: "100%", display: "flex" }}>
                    （なし）
                  </div>
                )}
                {later.omitted > 0 && (
                  <div style={{ fontSize: 34, lineHeight: 1.25, color: TEXT_SUB, width: "100%", display: "flex" }}>
                    ほか{later.omitted}件
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        <div style={{ height: bottomSafe, width: "100%", display: "flex" }} />
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
