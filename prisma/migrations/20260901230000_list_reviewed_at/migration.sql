-- 生成リストを編集せず「確認しました」と押した日時
ALTER TABLE "Event" ADD COLUMN "listReviewedAt" TIMESTAMP(3);
