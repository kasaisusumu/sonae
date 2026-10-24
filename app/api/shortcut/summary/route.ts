import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveShortcutToken } from "@/lib/shortcut-token";
import { loadPriorityHomeLists, type PriorityHomeRow } from "@/lib/priority-home";
import { appBaseUrl } from "@/lib/google";
import { formatDateShort } from "@/lib/format";
import { isPriorityExtrasEnabled } from "@/lib/priority-mode";

export const dynamic = "force-dynamic";

const MAX_LIST = 5;

/** 失敗理由を外に出さない、共通の401（トークン無し・形式不正・無効化済み・該当無し、全部同じ）。 */
function unauthorized(): NextResponse {
  return NextResponse.json({ error: "unauthorized" }, { status: 401 });
}

function eventUrl(eventId: string): string {
  return `${appBaseUrl()}/events/${eventId}`;
}

function formatPriorityLines(rows: PriorityHomeRow[]): string[] {
  const lines = rows.slice(0, MAX_LIST).map((r) => {
    if (r.isStandalone || !r.eventId || !r.eventTitle || !r.eventDate) {
      return `- ${r.title}`;
    }
    return `- ${r.title}（${r.eventTitle}・${formatDateShort(r.eventDate)}${r.isPast ? "・過去" : ""}） ${eventUrl(r.eventId)}`;
  });
  if (rows.length > MAX_LIST) lines.push(`ほか${rows.length - MAX_LIST}件`);
  return lines;
}

/**
 * iPhoneショートカット用の読み取り専用API（2026-10-23追加）。
 * `Authorization: Bearer <トークン>` ヘッダー、または `?token=` クエリパラメータで
 * 認証し、常にそのトークンの持ち主のデータだけを返す（userId を全てのクエリに
 * 必ず入れる）。認証に失敗した理由（トークン無し／形式不正／無効化済み／該当無し）は
 * 区別せず、常に同じ401を返す。
 */
export async function GET(request: Request): Promise<NextResponse> {
  const url = new URL(request.url);
  const auth = await resolveShortcutToken(
    request.headers.get("authorization"),
    url.searchParams.get("token"),
  );
  if (!auth) return unauthorized();
  const { userId } = auth;
  // ver2.1（急ぎ/そのうち関連機能一式）がOFFのユーザーは、トークン自体は有効でも
  // 使わせない（同じ401で、理由は区別しない）。
  if (!(await isPriorityExtrasEnabled(userId))) return unauthorized();

  const now = new Date();

  const [nextEvent, priorityLists] = await Promise.all([
    // 「次の予定」の条件は lib/wallpaper-render.tsx の renderWallpaper と完全に揃える
    // （開始済みだが終了していない予定も含める）。揃っていないと、壁紙とこのAPIで
    // 「次の予定」が食い違って見える（2026-10-24のバグレビューで発覚・修正）。
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
        checklistItems: {
          where: { isSuggested: false, isDone: false },
          orderBy: { sortOrder: "asc" },
          select: { title: true },
        },
      },
    }),
    loadPriorityHomeLists(userId),
  ]);

  const lines: string[] = [];

  if (nextEvent) {
    lines.push(`次の予定: ${nextEvent.title}（${formatDateShort(nextEvent.eventDatetime)}）`);
    lines.push(eventUrl(nextEvent.id));
    if (nextEvent.checklistItems.length > 0) {
      lines.push("準備リスト:");
      for (const it of nextEvent.checklistItems.slice(0, MAX_LIST)) {
        lines.push(`- ${it.title}`);
      }
      if (nextEvent.checklistItems.length > MAX_LIST) {
        lines.push(`ほか${nextEvent.checklistItems.length - MAX_LIST}件`);
      }
    }
  } else {
    lines.push("次の予定はありません。");
  }

  lines.push("");
  lines.push("急ぎ:");
  lines.push(
    ...(priorityLists.urgent.length > 0
      ? formatPriorityLines(priorityLists.urgent)
      : ["（なし）"]),
  );

  lines.push("");
  lines.push("そのうち:");
  lines.push(
    ...(priorityLists.later.length > 0
      ? formatPriorityLines(priorityLists.later)
      : ["（なし）"]),
  );

  return NextResponse.json({ text: lines.join("\n") });
}
