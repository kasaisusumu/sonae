/**
 * ロック画面用の壁紙画像（2026-10-23追加）。`next/og`（ImageResponse、Node ランタイム）
 * で、ユーザーが登録した背景画像の上に「直近の予定の準備リスト」と「急ぎ／そのうち」を
 * 描き込む。iPhoneのショートカットが `/api/shortcut/wallpaper.png` 経由でこれを取得する。
 *
 * 左半分の準備リストは、カレンダー説明欄に書き込んでいるもの（lib/description.ts の
 * buildSonaeBlock）の「リンク無しバージョン」を忠実に再現する（ユーザー指定）。
 * 見出し・進捗（done/total）・☑/・の記号・リード時間の書式・コメントの字下げまで、
 * lib/description.ts の同じ関数（bullet・progress・checkedLast）をそのまま使う。
 */
import fs from "node:fs/promises";
import path from "node:path";
import { ImageResponse } from "next/og";
import { prisma } from "@/lib/prisma";
import { resolveSections, sectionLabel } from "@/lib/sections";
import { bullet, progress, checkedLast, type DescItem } from "@/lib/description";
import { loadPriorityHomeLists, type PriorityHomeRow } from "@/lib/priority-home";
import { loadLockScreenImage } from "@/lib/lock-screen-image";
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

let fontCache: { regular: Buffer; bold: Buffer } | null = null;
async function loadFonts() {
  if (fontCache) return fontCache;
  const dir = path.join(process.cwd(), "assets", "fonts");
  const [regular, bold] = await Promise.all([
    fs.readFile(path.join(dir, "NotoSansJP-Regular.ttf")),
    fs.readFile(path.join(dir, "NotoSansJP-Bold.ttf")),
  ]);
  fontCache = { regular, bold };
  return fontCache;
}

function compactDate(d: Date): string {
  const parts = d.toLocaleString("ja-JP", {
    timeZone: JST,
    month: "numeric",
    day: "numeric",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
  return parts;
}

/** 壁紙の描き下ろし時刻（JST）。下部に「最終更新」として表示する。 */
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

const MAX_LEFT_ITEMS = 6;

/** 左半分の準備リスト行を、カレンダー説明欄と同じ書式・同じ記号で組み立てる。 */
function buildLeftLines(
  items: DescItem[],
  sections: string[],
): LeftLine[] {
  const order = sections.filter((k) => !k.startsWith("@"));
  const lines: LeftLine[] = [];
  let shown = 0;
  let omitted = 0;
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

const MAX_RIGHT_ITEMS = 2;

function rightRows(rows: PriorityHomeRow[]): { shown: PriorityHomeRow[]; omitted: number } {
  return {
    shown: rows.slice(0, MAX_RIGHT_ITEMS),
    omitted: Math.max(0, rows.length - MAX_RIGHT_ITEMS),
  };
}

const PANEL_BG = "rgba(10,12,18,0.55)";
const TEXT_MAIN = "#ffffff";
const TEXT_SUB = "rgba(255,255,255,0.72)";
const TEXT_DONE = "rgba(255,255,255,0.5)";

export async function renderWallpaper(
  userId: string,
  ratio: number,
): Promise<ImageResponse> {
  const width = OUTPUT_WIDTH;
  const height = Math.round(width * ratio);

  const now = new Date();
  const [nextEvent, priorityLists, bgImage, fonts] = await Promise.all([
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
    loadFonts(),
  ]);

  const topSafe = Math.round(height * 0.3);
  const bottomSafe = Math.round(height * 0.12);
  const contentHeight = height - topSafe - bottomSafe;
  const outerPad = Math.round(width * 0.035);
  const halfGap = Math.round(width * 0.025);
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
      )
    : [];

  const urgent = rightRows(priorityLists.urgent);
  const later = rightRows(priorityLists.later);

  const bgDataUri = bgImage
    ? `data:image/jpeg;base64,${bgImage.data.toString("base64")}`
    : null;

  function PanelHeading({ text }: { text: string }) {
    return (
      <div
        style={{
          fontSize: 46,
          lineHeight: 1.25,
          fontWeight: 700,
          color: TEXT_MAIN,
          width: "100%",
          display: "flex",
          marginBottom: 14,
        }}
      >
        {text}
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
          backgroundColor: "#151a23",
          fontFamily: "NotoSansJP",
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
              borderRadius: 28,
              padding: 26,
              overflow: "hidden",
            }}
          >
            {nextEvent ? (
              <div style={{ display: "flex", flexDirection: "column", width: "100%" }}>
                <div
                  style={{
                    fontSize: 54,
                    lineHeight: 1.25,
                    fontWeight: 700,
                    color: TEXT_MAIN,
                    width: "100%",
                    display: "flex",
                  }}
                >
                  {nextEvent.title.slice(0, 16)}
                </div>
                <div
                  style={{
                    fontSize: 40,
                    lineHeight: 1.25,
                    color: TEXT_SUB,
                    width: "100%",
                    marginBottom: 18,
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
                            fontSize: 42,
                            lineHeight: 1.25,
                            fontWeight: 700,
                            color: TEXT_SUB,
                            width: "100%",
                            marginTop: i === 0 ? 0 : 16,
                            marginBottom: 6,
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
                            fontSize: 32,
                            lineHeight: 1.25,
                            color: TEXT_SUB,
                            width: "100%",
                            paddingLeft: 24,
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
                            fontSize: 32,
                            lineHeight: 1.25,
                            color: TEXT_SUB,
                            width: "100%",
                            marginTop: 8,
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
                          fontSize: 40,
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
                    <div style={{ fontSize: 38, lineHeight: 1.25, color: TEXT_SUB, width: "100%", display: "flex" }}>
                      準備リストはまだありません
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div style={{ fontSize: 40, lineHeight: 1.25, color: TEXT_SUB, width: "100%", display: "flex" }}>
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
                borderRadius: 28,
                padding: 24,
                overflow: "hidden",
              }}
            >
              <PanelHeading text={`🔥 急ぎ（${priorityLists.urgent.length}）`} />
              <div style={{ display: "flex", flexDirection: "column", width: "100%" }}>
                {urgent.shown.map((r) => (
                  <div key={r.key} style={{ display: "flex", flexDirection: "column", width: "100%", marginBottom: 14 }}>
                    <div style={{ fontSize: 36, lineHeight: 1.25, color: TEXT_MAIN, width: "100%", display: "flex" }}>
                      {r.title.slice(0, 12)}
                    </div>
                    <div style={{ fontSize: 26, lineHeight: 1.25, color: TEXT_SUB, width: "100%", display: "flex" }}>
                      {r.eventTitle.slice(0, 10)}・{compactDate(r.eventDate)}
                    </div>
                  </div>
                ))}
                {urgent.shown.length === 0 && (
                  <div style={{ fontSize: 32, lineHeight: 1.25, color: TEXT_SUB, width: "100%", display: "flex" }}>
                    （なし）
                  </div>
                )}
                {urgent.omitted > 0 && (
                  <div style={{ fontSize: 28, lineHeight: 1.25, color: TEXT_SUB, width: "100%", display: "flex" }}>
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
                borderRadius: 28,
                padding: 24,
                overflow: "hidden",
              }}
            >
              <PanelHeading text={`🕒 そのうち（${priorityLists.later.length}）`} />
              <div style={{ display: "flex", flexDirection: "column", width: "100%" }}>
                {later.shown.map((r) => (
                  <div key={r.key} style={{ display: "flex", flexDirection: "column", width: "100%", marginBottom: 14 }}>
                    <div style={{ fontSize: 36, lineHeight: 1.25, color: TEXT_MAIN, width: "100%", display: "flex" }}>
                      {r.title.slice(0, 12)}
                    </div>
                    <div style={{ fontSize: 26, lineHeight: 1.25, color: TEXT_SUB, width: "100%", display: "flex" }}>
                      {r.eventTitle.slice(0, 10)}・{compactDate(r.eventDate)}
                    </div>
                  </div>
                ))}
                {later.shown.length === 0 && (
                  <div style={{ fontSize: 32, lineHeight: 1.25, color: TEXT_SUB, width: "100%", display: "flex" }}>
                    （なし）
                  </div>
                )}
                {later.omitted > 0 && (
                  <div style={{ fontSize: 28, lineHeight: 1.25, color: TEXT_SUB, width: "100%", display: "flex" }}>
                    ほか{later.omitted}件
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

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
          <div
            style={{
              fontSize: 24,
              lineHeight: 1.25,
              color: "rgba(255,255,255,0.55)",
              display: "flex",
            }}
          >
            最終更新: {formatUpdatedAt(now)}
          </div>
        </div>
      </div>
    ),
    {
      width,
      height,
      fonts: [
        { name: "NotoSansJP", data: fonts.regular, weight: 400, style: "normal" },
        { name: "NotoSansJP", data: fonts.bold, weight: 700, style: "normal" },
      ],
    },
  );
}
