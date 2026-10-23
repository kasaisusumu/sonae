import { randomBytes, createHash, timingSafeEqual } from "crypto";
import { prisma } from "@/lib/prisma";

/** iPhoneショートカット用APIの認証トークン（2026-10-23追加）。 */
const TOKEN_PREFIX = "smm_";

/** 生のトークンを新規発行する。表示は発行直後の1回だけで、保存するのはハッシュだけ。 */
export function generateRawShortcutToken(): string {
  return TOKEN_PREFIX + randomBytes(24).toString("base64url");
}

export function hashShortcutToken(raw: string): string {
  return createHash("sha256").update(raw, "utf8").digest("hex");
}

/**
 * `Authorization: Bearer <token>` からユーザーIDを引く。
 * 見つからない・形式不正・無効化済みは全て同じ null を返す（失敗理由を外に漏らさない）。
 * 生トークンはハッシュ化してからDBを完全一致（インデックス）で引くため、
 * 生の文字列を1文字ずつ比較することはない（タイミング攻撃を避ける）。
 * 見つかった後のハッシュ同士の比較も timingSafeEqual で行う（念のための二重防御）。
 */
export async function resolveShortcutToken(
  authorizationHeader: string | null,
): Promise<{ userId: string; tokenId: string } | null> {
  if (!authorizationHeader) return null;
  const m = /^Bearer\s+(.+)$/i.exec(authorizationHeader.trim());
  if (!m) return null;
  const raw = m[1].trim();
  if (!raw) return null;

  const hash = hashShortcutToken(raw);
  const row = await prisma.shortcutToken.findUnique({
    where: { tokenHash: hash },
    select: { id: true, userId: true, tokenHash: true, revokedAt: true },
  });
  if (!row || row.revokedAt) return null;

  const a = Buffer.from(hash, "hex");
  const b = Buffer.from(row.tokenHash, "hex");
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  await prisma.shortcutToken
    .update({ where: { id: row.id }, data: { lastUsedAt: new Date() } })
    .catch(() => {});

  return { userId: row.userId, tokenId: row.id };
}
