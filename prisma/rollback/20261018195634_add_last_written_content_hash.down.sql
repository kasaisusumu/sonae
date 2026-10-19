-- 20261018195634_add_last_written_content_hash の巻き戻し。
-- 追加した列を削除し、削除したインデックスを戻す。
-- 既存行（Event等）は列が消えるだけで、行自体は失われない。

ALTER TABLE "Event" DROP COLUMN IF EXISTS "lastWrittenContentHash";

CREATE INDEX IF NOT EXISTS "FailureLog_eventId_idx" ON "FailureLog"("eventId");

DELETE FROM "_prisma_migrations" WHERE migration_name = '20261018195634_add_last_written_content_hash';
