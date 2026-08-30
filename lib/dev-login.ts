/**
 * 開発用ログイン（Google 連携なしで P0 を試すため）。
 * 本番では無効。明示的に有効化したい場合のみ ENABLE_DEV_LOGIN=true。
 */
export function isDevLoginEnabled(): boolean {
  if (process.env.ENABLE_DEV_LOGIN === "true") return true;
  return process.env.NODE_ENV !== "production";
}

export const DEV_USER_EMAIL = "dev@sonae.local";
