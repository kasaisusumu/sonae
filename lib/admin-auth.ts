import crypto from "node:crypto";
import { prisma } from "@/lib/prisma";
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

// この時間を過ぎたトークンは、たとえ未消費でも無効（ログインし直し）。
const TOKEN_MAX_AGE_MS = 5 * 60 * 1000;

function sign(id: string): string {
  return crypto.createHmac("sha256", secret()).update(`admin-login:${id}`).digest("hex");
}

/**
 * 管理者としての Google 再ログインが成功した直後に、その 1 回のアクセス分だけ
 * 有効なトークンを発行する。/admin を開くたびに毎回ログインし直させるための仕組み。
 */
export async function issueAdminLoginToken(userId: string): Promise<string> {
  const row = await prisma.adminLoginToken.create({ data: { userId } });
  return `${row.id}.${sign(row.id)}`;
}

/**
 * トークンを 1 回だけ消費する。成功したときだけ true を返す
 * （＝このリクエスト 1 回に限り管理画面を表示してよい）。
 * 署名不一致・期限切れ・二重使用・別ユーザーのものはすべて false。
 * DB 側の条件付き UPDATE で消費するため、同時アクセスがあっても二重には成功しない。
 */
export async function consumeAdminLoginToken(
  raw: string | null | undefined,
  userId: string,
): Promise<boolean> {
  if (!raw) return false;
  const idx = raw.lastIndexOf(".");
  if (idx <= 0) return false;
  const id = raw.slice(0, idx);
  const sig = raw.slice(idx + 1);
  const expected = sign(id);
  if (
    sig.length !== expected.length ||
    !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))
  ) {
    return false;
  }

  const cutoff = new Date(Date.now() - TOKEN_MAX_AGE_MS);
  const { count } = await prisma.adminLoginToken.updateMany({
    where: { id, userId, usedAt: null, createdAt: { gte: cutoff } },
    data: { usedAt: new Date() },
  });
  return count === 1;
}
