-- AdminLoginToken は使い切りトークン方式（スクロール等の再読み込みで
-- ログイン画面に戻される不具合があった）から、時間帯ベースの確認 Cookie
-- （lib/admin-auth.ts の isAdminVerifiedCookieValid）に置き換えたため不要。
-- DropForeignKey
ALTER TABLE "AdminLoginToken" DROP CONSTRAINT "AdminLoginToken_userId_fkey";

-- DropTable
DROP TABLE "AdminLoginToken";
