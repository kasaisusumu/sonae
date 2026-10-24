-- 1023-1: ChecklistItemPriority・ShortcutToken の追加、EventFutureMessage.priority の追加を取り消す。
-- 追加のみのマイグレーションなので、逆順にDROPするだけ（データの巻き戻しは不要）。

DROP TABLE IF EXISTS "ShortcutToken";
DROP TABLE IF EXISTS "ChecklistItemPriority";
ALTER TABLE "EventFutureMessage" DROP COLUMN IF EXISTS "priority";
