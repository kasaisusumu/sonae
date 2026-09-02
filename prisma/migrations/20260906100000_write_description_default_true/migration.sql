-- 説明欄書き込みの既定を true に（初回連携で calendar.events も要求する運用に合わせる）。
-- 既存行の値は変更しない（読み取りのみで連携済みの人はそのまま）。
ALTER TABLE "UserGoogleAccount" ALTER COLUMN "writeDescriptionEnabled" SET DEFAULT true;
