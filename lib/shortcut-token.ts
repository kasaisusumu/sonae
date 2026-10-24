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
 * `Authorization: Bearer <token>` ヘッダー、または `?token=` クエリパラメータから
 * ユーザーIDを引く（ヘッダーを優先。どちらか一方があれば認証できる）。
 * クエリパラメータ対応は、iPhoneショートカットの「URLの内容を取得」で毎回ヘッダーを
 * 設定しなくても、トークン入りの1本のURLをそのまま貼るだけで使えるようにするため
 * （ユーザー指定・2026-10-23）。URLにトークンが含まれる分、アクセスログ等に残る
 * 可能性はヘッダー方式より高くなるが、ショートカット側の設定を単純にする利点を優先した。
 * 見つからない・形式不正・無効化済みは全て同じ null を返す（失敗理由を外に漏らさない）。
 * 生トークンはハッシュ化してからDBを完全一致（インデックス）で引くため、
 * 生の文字列を1文字ずつ比較することはない（タイミング攻撃を避ける）。
 * 見つかった後のハッシュ同士の比較も timingSafeEqual で行う（念のための二重防御）。
 */
export async function resolveShortcutToken(
  authorizationHeader: string | null,
  queryToken?: string | null,
): Promise<{ userId: string; tokenId: string } | null> {
  const fromHeader = authorizationHeader
    ? /^Bearer\s+(.+)$/i.exec(authorizationHeader.trim())?.[1]?.trim()
    : null;
  const raw = fromHeader || queryToken?.trim() || null;
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
