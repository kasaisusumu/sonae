-- 20261019130000_default_feature_mode_production の巻き戻し。
-- 列の既定値を 'test' に戻す。
-- 注: このマイグレーションが実行した UPDATE（'test' だった既存ユーザーを 'production' に
-- 戻す処理）は、どの行が元々 'test' だったかの記録が残らないため逆変換できない。
-- 本番昇格前は featureMode 列自体が存在しなかったため、通常は実害が無い想定。

ALTER TABLE "User" ALTER COLUMN "featureMode" SET DEFAULT 'test';

DELETE FROM "_prisma_migrations" WHERE migration_name = '20261019130000_default_feature_mode_production';
