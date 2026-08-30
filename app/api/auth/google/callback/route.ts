import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { exchangeCode } from "@/lib/google";
import { setSession } from "@/lib/session";
import { ensureDefaultCategories } from "@/lib/categories";

export const runtime = "nodejs";

function appBase(req: NextRequest): string {
  return process.env.APP_BASE_URL || req.nextUrl.origin;
}

export async function GET(req: NextRequest) {
  const base = appBase(req);
  const url = req.nextUrl;
  const error = url.searchParams.get("error");
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");

  const store = await cookies();
  const expectedState = store.get("sonae_oauth_state")?.value;
  store.delete("sonae_oauth_state");

  if (error || !code || !state || state !== expectedState) {
    return NextResponse.redirect(`${base}/?auth=failed`);
  }

  try {
    const { profile, accessToken, refreshToken, expiryDate } =
      await exchangeCode(code);

    const user = await prisma.user.upsert({
      where: { email: profile.email },
      update: { name: profile.name ?? undefined },
      create: { email: profile.email, name: profile.name ?? null },
    });

    await prisma.userGoogleAccount.upsert({
      where: { userId: user.id },
      update: {
        googleAccountEmail: profile.email,
        accessToken,
        // 再認可で refresh_token が返らないことがあるので、来たときだけ更新
        ...(refreshToken ? { refreshToken } : {}),
        tokenExpiry: expiryDate,
      },
      create: {
        userId: user.id,
        googleAccountEmail: profile.email,
        accessToken,
        refreshToken,
        tokenExpiry: expiryDate,
        calendarId: "primary",
      },
    });

    await ensureDefaultCategories(user.id);
    await setSession(user.id);

    return NextResponse.redirect(`${base}/events?connected=1`);
  } catch (e) {
    console.error("[auth/callback] 失敗:", e);
    return NextResponse.redirect(`${base}/?auth=failed`);
  }
}
