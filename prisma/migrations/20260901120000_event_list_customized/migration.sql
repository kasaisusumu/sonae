-- 同名グループから切り離して個別編集した予定かどうか。
ALTER TABLE "Event" ADD COLUMN "listCustomized" BOOLEAN NOT NULL DEFAULT false;

-- 既に個別編集の履歴（EditRecord）がある予定は、切り離し済みとみなす。
UPDATE "Event" e
SET "listCustomized" = true
WHERE EXISTS (SELECT 1 FROM "EditRecord" r WHERE r."eventId" = e."id");
