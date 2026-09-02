-- 準備リストのリマインドを複数回（最大5個）持てるように。
ALTER TABLE "Event" ADD COLUMN "listReminderLeads" TEXT NOT NULL DEFAULT '[1440]';
ALTER TABLE "Event" ADD COLUMN "sentListReminderLeads" TEXT NOT NULL DEFAULT '[]';

-- 既存値を配列へ移行（null は空配列）。
UPDATE "Event"
SET "listReminderLeads" = CASE
  WHEN "listReminderLeadMinutes" IS NULL THEN '[]'
  ELSE '[' || "listReminderLeadMinutes"::text || ']'
END;
