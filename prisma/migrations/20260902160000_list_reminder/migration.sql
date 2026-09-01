-- 準備リスト全体のリマインド通知（予定の何分前に1回）。既定は1日前。
ALTER TABLE "Event" ADD COLUMN "listReminderLeadMinutes" INTEGER DEFAULT 1440;
ALTER TABLE "Event" ADD COLUMN "listReminderNotifiedAt" TIMESTAMP(3);
