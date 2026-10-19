-- 20261019130100_restore_failurelog_eventid_index の巻き戻し。
-- 復元したインデックスを再度削除する（20261018195634 の巻き戻しで作り直す場合は
-- そちらを先に実行すること。順序: このdown → 20261018195634のdown）。

DROP INDEX IF EXISTS "FailureLog_eventId_idx";

DELETE FROM "_prisma_migrations" WHERE migration_name = '20261019130100_restore_failurelog_eventid_index';
