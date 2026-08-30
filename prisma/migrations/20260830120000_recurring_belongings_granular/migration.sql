-- DropIndex
DROP INDEX "LearnedRule_categoryId_ruleType_idx";

-- DropIndex
DROP INDEX "LearnedRule_categoryId_ruleType_target_featureSignature_key";

-- AlterTable
ALTER TABLE "ChecklistItem" ADD COLUMN     "kind" TEXT NOT NULL DEFAULT 'task';

-- AlterTable
ALTER TABLE "Event" ADD COLUMN     "recurringEventId" TEXT;

-- AlterTable
ALTER TABLE "EventFeature" ADD COLUMN     "timeBucket" TEXT;

-- AlterTable
ALTER TABLE "LearnedRule" ADD COLUMN     "itemKind" TEXT NOT NULL DEFAULT 'task';

-- CreateIndex
CREATE INDEX "Event_userId_recurringEventId_idx" ON "Event"("userId", "recurringEventId");

-- CreateIndex
CREATE INDEX "LearnedRule_categoryId_itemKind_ruleType_idx" ON "LearnedRule"("categoryId", "itemKind", "ruleType");

-- CreateIndex
CREATE UNIQUE INDEX "LearnedRule_categoryId_itemKind_ruleType_target_featureSign_key" ON "LearnedRule"("categoryId", "itemKind", "ruleType", "target", "featureSignature");

