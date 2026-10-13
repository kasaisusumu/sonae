-- 20261014090000_feature_mode の巻き戻し。
-- 追加した列・テーブルを削除し、_prisma_migrations の記録も取り消す。
-- 既存行（User等）は列が消えるだけで、行自体は失われない。

ALTER TABLE "FeatureModeChange" DROP CONSTRAINT IF EXISTS "FeatureModeChange_userId_fkey";
DROP INDEX IF EXISTS "FeatureModeChange_userId_changedAt_idx";
DROP TABLE IF EXISTS "FeatureModeChange";

ALTER TABLE "ChecklistScopeRule" DROP COLUMN IF EXISTS "convertedFromLearnedRuleId";
ALTER TABLE "ChecklistScopeRule" DROP COLUMN IF EXISTS "autoConverted";

ALTER TABLE "LearnedRule" DROP COLUMN IF EXISTS "convertedFromScopeRuleId";
ALTER TABLE "LearnedRule" DROP COLUMN IF EXISTS "autoConverted";

ALTER TABLE "User" DROP COLUMN IF EXISTS "featureMode";

DELETE FROM "_prisma_migrations" WHERE migration_name = '20261014090000_feature_mode';
