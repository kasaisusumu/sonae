import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import crypto from "node:crypto";
import { buildConsentUrl } from "@/lib/google";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const base = process.env.APP_BASE_URL || req.nextUrl.origin;
  try {
    const state = crypto.randomBytes(16).toString("hex");
    const url = buildConsentUrl(state);
    const store = await cookies();
    store.set("sonae_oauth_state", state, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 10,
    });
    return NextResponse.redirect(url);
  } catch (e) {
    // GOOGLE_CLIENT_ID などの環境変数が未設定のとき
    console.error("[auth/google] 設定エラー:", e);
    return NextResponse.redirect(`${base}/?auth=config`);
  }
}
