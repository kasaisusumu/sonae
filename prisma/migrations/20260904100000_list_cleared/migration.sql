-- ユーザーが準備リストを「全部消した」状態を覚える。
ALTER TABLE "Event" ADD COLUMN "listCleared" BOOLEAN NOT NULL DEFAULT false;
