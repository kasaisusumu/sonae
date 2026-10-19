-- 本番昇格（1019-2）対応。20261018195634_add_last_written_content_hash が
-- FailureLog.eventId のインデックスを（テスト環境側の schema 整理の過程で）削除していた。
-- 本番の ver1（失敗ログ機能）は引き続きこのテーブルを実運用で使うため、復元する。
CREATE INDEX "FailureLog_eventId_idx" ON "FailureLog"("eventId");
