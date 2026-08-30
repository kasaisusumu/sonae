-- spec 9.2: CategoryLearning を EventFeature + EditRecord + LearnedRule に置き換える
-- 既存の CategoryLearning のデータは confidence 低め (0.4) の LearnedRule に変換して保持する

-- AlterTable: ChecklistItem に「提案」用カラム
ALTER TABLE "ChecklistItem" ADD COLUMN "isSuggested" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "suggestionRuleId" TEXT,
ADD COLUMN "suggestionType" TEXT,
ADD COLUMN "suggestionValue" TEXT;

-- CreateTable: EventFeature
CREATE TABLE "EventFeature" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "isOverseas" BOOLEAN,
    "durationNights" INTEGER,
    "isWeekday" BOOLEAN NOT NULL DEFAULT true,
    "keywords" TEXT NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "EventFeature_pkey" PRIMARY KEY ("id")
);

-- CreateTable: EditRecord
CREATE TABLE "EditRecord" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "categoryId" TEXT,
    "addedItems" TEXT NOT NULL DEFAULT '[]',
    "removedItems" TEXT NOT NULL DEFAULT '[]',
    "timingChanges" TEXT NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "EditRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable: LearnedRule
CREATE TABLE "LearnedRule" (
    "id" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "featureSignature" TEXT NOT NULL DEFAULT '{}',
    "ruleType" TEXT NOT NULL,
    "target" TEXT NOT NULL,
    "value" TEXT,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0.35,
    "confirmedCount" INTEGER NOT NULL DEFAULT 1,
    "contradictedCount" INTEGER NOT NULL DEFAULT 0,
    "lastConfirmedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "isUserLocked" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "LearnedRule_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "EventFeature_eventId_key" ON "EventFeature"("eventId");
CREATE INDEX "EditRecord_categoryId_idx" ON "EditRecord"("categoryId");
CREATE INDEX "LearnedRule_categoryId_ruleType_idx" ON "LearnedRule"("categoryId", "ruleType");
CREATE UNIQUE INDEX "LearnedRule_categoryId_ruleType_target_featureSignature_key" ON "LearnedRule"("categoryId", "ruleType", "target", "featureSignature");

ALTER TABLE "EventFeature" ADD CONSTRAINT "EventFeature_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EditRecord" ADD CONSTRAINT "EditRecord_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EditRecord" ADD CONSTRAINT "EditRecord_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "LearnedRule" ADD CONSTRAINT "LearnedRule_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── データ移行: CategoryLearning -> LearnedRule (confidence 0.4, 連続確認1, ワイルドカード署名) ──

-- excludedItems -> exclude_item
INSERT INTO "LearnedRule" ("id","categoryId","featureSignature","ruleType","target","value","confidence","confirmedCount","contradictedCount","lastConfirmedAt","isUserLocked","createdAt","updatedAt")
SELECT gen_random_uuid()::text, cl."categoryId", '{}', 'exclude_item', trim(v), NULL, 0.4, 1, 0, now(), false, now(), now()
FROM "CategoryLearning" cl, jsonb_array_elements_text(cl."excludedItems"::jsonb) AS v
WHERE trim(v) <> ''
ON CONFLICT ("categoryId","ruleType","target","featureSignature") DO NOTHING;

-- fixedItems -> fixed_item
INSERT INTO "LearnedRule" ("id","categoryId","featureSignature","ruleType","target","value","confidence","confirmedCount","contradictedCount","lastConfirmedAt","isUserLocked","createdAt","updatedAt")
SELECT gen_random_uuid()::text, cl."categoryId", '{}', 'fixed_item', trim(e->>'title'),
       NULLIF(e->>'timingLabel',''), 0.4, 1, 0, now(), false, now(), now()
FROM "CategoryLearning" cl, jsonb_array_elements(cl."fixedItems"::jsonb) AS e
WHERE (e->>'title') IS NOT NULL AND trim(e->>'title') <> ''
ON CONFLICT ("categoryId","ruleType","target","featureSignature") DO NOTHING;

-- timingOverrides -> timing_override
INSERT INTO "LearnedRule" ("id","categoryId","featureSignature","ruleType","target","value","confidence","confirmedCount","contradictedCount","lastConfirmedAt","isUserLocked","createdAt","updatedAt")
SELECT gen_random_uuid()::text, cl."categoryId", '{}', 'timing_override', trim(kv.key), kv.value, 0.4, 1, 0, now(), false, now(), now()
FROM "CategoryLearning" cl, jsonb_each_text(cl."timingOverrides"::jsonb) AS kv
WHERE trim(kv.key) <> '' AND COALESCE(kv.value,'') <> ''
ON CONFLICT ("categoryId","ruleType","target","featureSignature") DO NOTHING;

-- 旧テーブルを廃止
ALTER TABLE "CategoryLearning" DROP CONSTRAINT IF EXISTS "CategoryLearning_categoryId_fkey";
DROP TABLE "CategoryLearning";
