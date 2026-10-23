import { NextResponse } from "next/server";
import { resolveShortcutToken } from "@/lib/shortcut-token";
import { loadLockScreenImage } from "@/lib/lock-screen-image";
import { renderWallpaper, resolveAspectRatio } from "@/lib/wallpaper-render";
import { trackEvent } from "@/lib/track";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * iPhoneショートカット用の、ロック画面の壁紙画像（2026-10-23追加）。
 * `Authorization: Bearer <トークン>` ヘッダー、または `?token=` クエリパラメータで
 * 認証し、常にそのトークンの持ち主のデータ・背景画像だけを使う。毎回その場で
 * 描き直す（Cache-Control: no-store）。
 */
export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const auth = await resolveShortcutToken(
    request.headers.get("authorization"),
    url.searchParams.get("token"),
  );
  if (!auth) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const bg = await loadLockScreenImage(auth.userId);
  const bgRatio = bg && bg.width > 0 ? bg.height / bg.width : null;
  const ratio = resolveAspectRatio(url.searchParams.get("w"), url.searchParams.get("h"), bgRatio);

  const image = await renderWallpaper(auth.userId, ratio);
  image.headers.set("Cache-Control", "no-store");
  trackEvent(auth.userId, "feature:lock-screen-wallpaper-fetch");
  return image;
}
