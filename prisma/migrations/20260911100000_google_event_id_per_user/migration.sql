-- googleEventId をユーザー横断ではなく「ユーザーごと」に一意にする。
-- 理由: 招待・共有された Google カレンダーの予定は、複数ユーザーの
-- カレンダーに同じ googleEventId で現れることがある（例: 同じ会議に招待
-- された2人）。これまでの全ユーザー共通の一意制約だと、後から連携した側の
-- 取り込み（Event.create）が一意制約違反で失敗し、アプリ側では「もう取り込み
-- 済み」の重複として黙って無視していた。相手の既存データは無事だが、
-- 自分の予定が一切取り込まれない不具合になっていた。
-- 既存データは変更しない（旧制約が既に googleEventId 単独で一意だったため、
-- (userId, googleEventId) の組でも重複は存在しない＝安全に置き換えられる）。
DROP INDEX "Event_googleEventId_key";

CREATE UNIQUE INDEX "Event_userId_googleEventId_key" ON "Event"("userId", "googleEventId");
