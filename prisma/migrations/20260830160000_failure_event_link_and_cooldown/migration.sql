-- Event: 説明欄カクつき対策と事後通知フラグ
ALTER TABLE "Event" ADD COLUMN "lastInboundEditAt" TIMESTAMP(3);
ALTER TABLE "Event" ADD COLUMN "postFailureCheckNotifiedAt" TIMESTAMP(3);

-- FailureLog: どの予定で起きたか（任意）
ALTER TABLE "FailureLog" ADD COLUMN "eventId" TEXT;

ALTER TABLE "FailureLog"
  ADD CONSTRAINT "FailureLog_eventId_fkey"
  FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "FailureLog_userId_categoryId_idx" ON "FailureLog"("userId", "categoryId");
CREATE INDEX "FailureLog_eventId_idx" ON "FailureLog"("eventId");
