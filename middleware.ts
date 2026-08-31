import { NextResponse, type NextRequest } from "next/server";

// lib/session.ts は prisma などを読み込むため middleware(Edge) からは import しない。
// 定数だけここに持つ（値は lib/session.ts と一致させること）。
const COOKIE_NAME = "sonae_session";
const SESSION_MAX_AGE = 60 * 60 * 24 * 180; // 180 日

/**
 * スライディングセッション。
 * ログインしている限り、アクセスのたびにセッション Cookie の期限を延長する。
 * → 明示的にログアウトしない限り勝手にログアウトされず、データは常に同じアカウントに紐づく。
 * 署名の検証は読み取り時（lib/session）に行うので、ここでは値をそのまま延長するだけ。
 */
export function middleware(req: NextRequest) {
  const res = NextResponse.next();
  const current = req.cookies.get(COOKIE_NAME)?.value;
  if (current) {
    res.cookies.set(COOKIE_NAME, current, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: SESSION_MAX_AGE,
    });
  }
  return res;
}

export const config = {
  matcher: [
    // 静的アセットと Service Worker 以外のすべて
    "/((?!_next/static|_next/image|favicon.ico|icons/|sw.js|manifest.webmanifest).*)",
  ],
};
