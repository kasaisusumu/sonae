import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import crypto from "node:crypto";
import { buildConsentUrl } from "@/lib/google";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const base = process.env.APP_BASE_URL || req.nextUrl.origin;
  // 既定で「予定の編集」スコープも要求する（説明欄書き込みを初回から有効に）。
  // 読み取りだけにしたい場合は ?write=0 を付ける。
  const withWrite = req.nextUrl.searchParams.get("write") !== "0";
  try {
    const state = crypto.randomBytes(16).toString("hex");
    const url = buildConsentUrl(state, withWrite);
    const store = await cookies();
    const cookieOpts = {
      httpOnly: true,
      sameSite: "lax" as const,
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 10,
    };
    store.set("sonae_oauth_state", state, cookieOpts);
    store.set("sonae_oauth_write", withWrite ? "1" : "0", cookieOpts);
    return NextResponse.redirect(url);
  } catch (e) {
    // GOOGLE_CLIENT_ID などの環境変数が未設定のとき
    console.error("[auth/google] 設定エラー:", e);
    return NextResponse.redirect(`${base}/?auth=config`);
  }
}
