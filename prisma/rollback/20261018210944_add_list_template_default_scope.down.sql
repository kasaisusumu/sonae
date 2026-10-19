-- 20261018210944_add_list_template_default_scope の巻き戻し。
-- 追加した列を削除する。既存行は列が消えるだけで、行自体は失われない。

ALTER TABLE "ListTemplate" DROP COLUMN IF EXISTS "defaultScope";

DELETE FROM "_prisma_migrations" WHERE migration_name = '20261018210944_add_list_template_default_scope';
