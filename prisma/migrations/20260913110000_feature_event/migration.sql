-- 管理画面の「機能・ページ利用状況」用の素朴なイベントログ。
-- CreateTable
CREATE TABLE "FeatureEvent" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "eventKey" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FeatureEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FeatureEvent_userId_eventKey_idx" ON "FeatureEvent"("userId", "eventKey");

-- CreateIndex
CREATE INDEX "FeatureEvent_eventKey_occurredAt_idx" ON "FeatureEvent"("eventKey", "occurredAt");

-- AddForeignKey
ALTER TABLE "FeatureEvent" ADD CONSTRAINT "FeatureEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
