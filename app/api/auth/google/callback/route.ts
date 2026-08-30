import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { exchangeCode, ensureWatch } from "@/lib/google";
import { setSession } from "@/lib/session";
import { ensureDefaultCategories } from "@/lib/categories";

export const runtime = "nodejs";
export const maxDuration = 30;

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
  const wantedWrite = store.get("sonae_oauth_write")?.value === "1";
  store.delete("sonae_oauth_state");
  store.delete("sonae_oauth_write");

  if (error || !code || !state || state !== expectedState) {
    return NextResponse.redirect(`${base}/?auth=failed`);
  }

  try {
    const { profile, accessToken, refreshToken, expiryDate, canWriteEvents } =
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
        // 書き込みスコープが許可されたら有効化（外れることはあっても勝手に無効化はしない）
        ...(canWriteEvents ? { writeDescriptionEnabled: true } : {}),
      },
      create: {
        userId: user.id,
        googleAccountEmail: profile.email,
        accessToken,
        refreshToken,
        tokenExpiry: expiryDate,
        calendarId: "primary",
        writeDescriptionEnabled: canWriteEvents,
      },
    });

    await ensureDefaultCategories(user.id);
    await setSession(user.id);

    // カレンダー変更の即時通知（push watch）を登録。失敗してもポーリングで代替。
    await ensureWatch(user.id).catch((e) =>
      console.error("[auth/callback] ensureWatch 失敗:", e),
    );

    const dest = wantedWrite ? "/settings" : "/events?connected=1";
    return NextResponse.redirect(`${base}${dest}`);
  } catch (e) {
    console.error("[auth/callback] 失敗:", e);
    return NextResponse.redirect(`${base}/?auth=failed`);
  }
}
