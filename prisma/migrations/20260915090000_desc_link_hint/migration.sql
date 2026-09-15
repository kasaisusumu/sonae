-- 説明欄のリンクから開いたときの「直接編集できます」案内を、
-- 「今後表示しない」で消したかどうか（null の間は毎回表示する）。
-- AlterTable
ALTER TABLE "User" ADD COLUMN "descLinkHintDismissedAt" TIMESTAMP(3);
