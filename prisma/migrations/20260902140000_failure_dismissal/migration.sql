-- 「失敗ログの提案」を却下したもの（その予定では以後提案しない）

CREATE TABLE "FailureDismissal" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "descKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FailureDismissal_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "FailureDismissal_userId_idx" ON "FailureDismissal"("userId");

CREATE UNIQUE INDEX "FailureDismissal_eventId_descKey_key" ON "FailureDismissal"("eventId", "descKey");

ALTER TABLE "FailureDismissal" ADD CONSTRAINT "FailureDismissal_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "FailureDismissal" ADD CONSTRAINT "FailureDismissal_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;
