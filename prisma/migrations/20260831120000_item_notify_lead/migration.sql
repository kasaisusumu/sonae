-- 準備すること／持ち物の項目ごとに「予定の何分前に通知するか」を持たせる。
ALTER TABLE "ChecklistItem" ADD COLUMN "notifyLeadMinutes" INTEGER;
ALTER TABLE "ChecklistItem" ADD COLUMN "notifiedAt" TIMESTAMP(3);
