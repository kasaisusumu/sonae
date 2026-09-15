-- カテゴリ横断パターン提案機能（ruleType="pattern_item"）用のフィールドを追加。
-- AlterTable
ALTER TABLE "EventFeature" ADD COLUMN "eventLengthBucket" TEXT;

-- AlterTable
ALTER TABLE "LearnedRule" ADD COLUMN "slotType" TEXT,
                          ADD COLUMN "patternTemplate" TEXT,
                          ADD COLUMN "aiConfidence" DOUBLE PRECISION;

-- CreateIndex
CREATE INDEX "LearnedRule_ruleType_slotType_idx" ON "LearnedRule"("ruleType", "slotType");
