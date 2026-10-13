-- 機能モード切替（テスト版／本番版）。追加のみ。
ALTER TABLE "User" ADD COLUMN "featureMode" TEXT NOT NULL DEFAULT 'test';

ALTER TABLE "LearnedRule" ADD COLUMN "autoConverted" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "LearnedRule" ADD COLUMN "convertedFromScopeRuleId" TEXT;

ALTER TABLE "ChecklistScopeRule" ADD COLUMN "autoConverted" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "ChecklistScopeRule" ADD COLUMN "convertedFromLearnedRuleId" TEXT;

CREATE TABLE "FeatureModeChange" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "fromMode" TEXT NOT NULL,
    "toMode" TEXT NOT NULL,
    "convertedCount" INTEGER NOT NULL DEFAULT 0,
    "dormantCount" INTEGER NOT NULL DEFAULT 0,
    "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FeatureModeChange_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "FeatureModeChange_userId_changedAt_idx" ON "FeatureModeChange"("userId", "changedAt");

ALTER TABLE "FeatureModeChange" ADD CONSTRAINT "FeatureModeChange_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
