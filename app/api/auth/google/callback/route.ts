import { NextResponse, after, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { exchangeCode, ensureWatch } from "@/lib/google";
import { setSession } from "@/lib/session";
import { ensureDefaultCategories } from "@/lib/categories";
import { syncUserCalendar, refineFallbackCategories } from "@/lib/sync";
import {
  isAdminEmail,
  issueAdminVerifiedCookieValue,
  ADMIN_VERIFIED_COOKIE,
  ADMIN_VERIFIED_MAX_AGE_MS,
} from "@/lib/admin-auth";

export const runtime = "nodejs";
export const maxDuration = 60;

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
  const oauthDest = store.get("sonae_oauth_dest")?.value;
  store.delete("sonae_oauth_state");
  store.delete("sonae_oauth_write");
  store.delete("sonae_oauth_dest");

  if (error || !code || !state || state !== expectedState) {
    // 管理画面の再ログイン中の失敗は、元のセッションを保ったまま /admin に
    // 戻して理由を表示する（/ に戻すと、ログイン済みのままなので
    // auth=failed のメッセージが表示されず「何も起きなかった」ように見えてしまう）。
    if (oauthDest === "admin") {
      return NextResponse.redirect(`${base}/admin?err=state`);
    }
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

    // 管理画面（/admin）の毎回ログイン確認フロー。カレンダー同期などは不要なので、
    // 本人確認ができたらここで即・確認済み Cookie を発行して /admin に戻す。
    // ここで isAdminEmail が false のときは setSession を呼ばない
    // （ブラウザに他の Google アカウントがログイン済みだと select_account 前は
    // そちらのアカウントで認証されうる。ここでセッションを書き換えると、確認に
    // 失敗しただけなのに「元々ログインしていた正しいアカウント」から
    // ログアウトされたように見えてしまうため、元のセッションはそのまま残す）。
    if (oauthDest === "admin") {
      if (!isAdminEmail(profile.email)) {
        return NextResponse.redirect(
          `${base}/admin?err=mismatch&who=${encodeURIComponent(profile.email)}`,
        );
      }
      await setSession(user.id);
      store.set(ADMIN_VERIFIED_COOKIE, issueAdminVerifiedCookieValue(user.id), {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        path: "/admin",
        maxAge: Math.floor(ADMIN_VERIFIED_MAX_AGE_MS / 1000),
      });
      return NextResponse.redirect(`${base}/admin`);
    }

    await setSession(user.id);

    // カレンダー変更の即時通知（push watch）を登録。失敗してもポーリングで代替。
    await ensureWatch(user.id).catch((e) =>
      console.error("[auth/callback] ensureWatch 失敗:", e),
    );

    // 接続直後に 1 回だけ取り込み、初回から予定が並んで見えるようにする。
    // （初回同期は通知しない。準備リスト生成は開いたとき／LiveSync に任せる。）
    // 速さ優先でキーワードだけの判定にしているため、まずは「その他」止まりで表示。
    await syncUserCalendar(user.id, { skipAiCategory: true }).catch((e) =>
      console.error("[auth/callback] 初回同期に失敗:", e),
    );

    // レスポンスは待たせず、その後で「その他」止まりの予定を AI でカテゴリ分けし直す
    // （カテゴリの自動生成）。連携直後は既存予定がまとまって入るため、1 回で少し多めに。
    after(() =>
      refineFallbackCategories(user.id, 20, { firstSync: true }).catch((e) =>
        console.error("[auth/callback] 初回カテゴリ振り直しに失敗:", e),
      ),
    );

    const dest = wantedWrite ? "/settings" : "/events?connected=1";
    return NextResponse.redirect(`${base}${dest}`);
  } catch (e) {
    console.error("[auth/callback] 失敗:", e);
    if (oauthDest === "admin") {
      return NextResponse.redirect(`${base}/admin?err=exchange`);
    }
    return NextResponse.redirect(`${base}/?auth=failed`);
  }
}
