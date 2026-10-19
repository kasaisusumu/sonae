-- 本番昇格（1019-2）対応。20261014090000_feature_mode が User.featureMode を
-- DEFAULT 'test' で追加したが、これをそのまま本番に適用すると既存の本番ユーザー全員が
-- 自動的に ver2（未来の自分へのメッセージ・3択）扱いになってしまう。
-- 既存・新規ユーザーとも既定は ver1（production）にする。
ALTER TABLE "User" ALTER COLUMN "featureMode" SET DEFAULT 'production';

-- このマイグレーション適用時点で既に 'test' になっている行（=本番昇格前に
-- featureMode 列が追加された際の既定値バックフィルで 'test' になった既存ユーザー）を
-- 'production' に戻す。ユーザー自身が明示的に ver2 へ切り替えた記録
-- （FeatureModeChange）が無い行だけを対象にする（念のための防御。本番昇格前は
-- featureMode 列自体が存在しなかったため、通常はこの条件で全行が対象になるはず）。
UPDATE "User"
SET "featureMode" = 'production'
WHERE "featureMode" = 'test'
  AND NOT EXISTS (
    SELECT 1 FROM "FeatureModeChange" fmc
    WHERE fmc."userId" = "User"."id" AND fmc."toMode" = 'test'
  );
