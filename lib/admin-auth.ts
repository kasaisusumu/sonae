import crypto from "node:crypto";
import { secret } from "@/lib/session";

/**
 * 管理者として許可されたメールアドレス一覧（ADMIN_EMAIL、カンマ区切り・大小無視）。
 * Vercel の環境変数入力欄に `.env.example` の書き方（`"a@example.com"`）をそのまま
 * 引用符付きで貼ってしまう事故がありうるので、前後の引用符も念のため取り除く。
 */
function allowedAdminEmails(): string[] {
  return (process.env.ADMIN_EMAIL ?? "")
    .split(",")
    .map((s) => s.trim().replace(/^["']+|["']+$/g, "").trim().toLowerCase())
    .filter(Boolean);
}

/** ログイン中のメールアドレスが管理者（ADMIN_EMAIL に一致）かどうか。 */
export function isAdminEmail(email: string | null | undefined): boolean {
  return !!email && allowedAdminEmails().includes(email.toLowerCase());
}

export const ADMIN_VERIFIED_COOKIE = "sonae_admin_verified";

// Google 再ログイン確認から、この時間だけ /admin を見続けられる。
// スクロール（pull-to-refresh 等）での偶発的な再読み込みでもログイン画面に
// 戻されないよう、1 リクエスト限りの使い切りトークンではなく「時間帯」にした。
// この時間を過ぎたら、また Google 再ログインが必要になる。
export const ADMIN_VERIFIED_MAX_AGE_MS = 20 * 60 * 1000;

function signVerified(userId: string, issuedAtMs: number): string {
  return crypto
    .createHmac("sha256", secret())
    .update(`admin-verified:${userId}:${issuedAtMs}`)
    .digest("hex");
}

/**
 * 管理者としての Google 再ログインが成功した直後に呼ぶ。
 * 「いつ確認できたか」を自己署名した値を返し、Cookie にそのまま入れる。
 */
export function issueAdminVerifiedCookieValue(userId: string): string {
  const issuedAtMs = Date.now();
  return `${issuedAtMs}.${signVerified(userId, issuedAtMs)}`;
}

/**
 * Cookie の値が「このユーザー本人が、有効期限内に Google 再ログインを
 * 済ませたもの」かどうかを検証する。消費（使い切り）はしないので、
 * 期限内なら同じ Cookie で何度アクセス・再読み込みしても通る。
 */
export function isAdminVerifiedCookieValid(
  raw: string | null | undefined,
  userId: string,
): boolean {
  if (!raw) return false;
  const idx = raw.lastIndexOf(".");
  if (idx <= 0) return false;
  const issuedAtMs = Number(raw.slice(0, idx));
  const sig = raw.slice(idx + 1);
  if (!Number.isFinite(issuedAtMs)) return false;

  const expected = signVerified(userId, issuedAtMs);
  if (
    sig.length !== expected.length ||
    !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))
  ) {
    return false;
  }

  const age = Date.now() - issuedAtMs;
  // 未来すぎる（クロックずれ許容 5 秒）か、古すぎるものは無効。
  return age >= -5000 && age <= ADMIN_VERIFIED_MAX_AGE_MS;
}
