import { NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/session";
import { loadLockScreenImage } from "@/lib/lock-screen-image";
import { renderWallpaper, resolveAspectRatio } from "@/lib/wallpaper-render";
import { isPriorityExtrasEnabled } from "@/lib/priority-mode";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * /settings の「ロック画面の背景画像」欄のプレビュー。ショートカット用トークンではなく
 * 通常のログイン（セッションクッキー）で認証する。壁紙APIと同じ描画処理を呼ぶ。
 */
export async function GET(request: Request): Promise<Response> {
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!(await isPriorityExtrasEnabled(userId))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const bg = await loadLockScreenImage(userId);
  const bgRatio = bg && bg.width > 0 ? bg.height / bg.width : null;
  const ratio = resolveAspectRatio(url.searchParams.get("w"), url.searchParams.get("h"), bgRatio);

  const image = await renderWallpaper(userId, ratio, bg);
  image.headers.set("Cache-Control", "no-store");
  return image;
}
