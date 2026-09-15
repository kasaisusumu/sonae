-- 失敗ログに「有効だった対策」を追記できるようにする。
-- AlterTable
ALTER TABLE "FailureLog" ADD COLUMN "countermeasure" TEXT;
