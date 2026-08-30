-- AlterTable
ALTER TABLE "Event" ADD COLUMN "autoManaged" BOOLEAN NOT NULL DEFAULT true;

-- 既存の Google 由来の予定は「連携時に既にあった予定」とみなし、自動管理の対象外にする
UPDATE "Event" SET "autoManaged" = false WHERE "source" = 'google';
