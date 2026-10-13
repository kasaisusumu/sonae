-- 振り返りカードのAI提案キャッシュ（ページ表示のたびにAIを呼び直さないため）。
ALTER TABLE "EventFutureMessage" ADD COLUMN "proposalJson" TEXT;
ALTER TABLE "EventFutureMessage" ADD COLUMN "proposalInputHash" TEXT;
