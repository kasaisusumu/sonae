-- 20261018210215_add_item_scope_categories の巻き戻し。
-- 追加した列を削除する。既存行は列が消えるだけで、行自体は失われない。

ALTER TABLE "ChecklistScopeRule" DROP COLUMN IF EXISTS "categories";

DELETE FROM "_prisma_migrations" WHERE migration_name = '20261018210215_add_item_scope_categories';
