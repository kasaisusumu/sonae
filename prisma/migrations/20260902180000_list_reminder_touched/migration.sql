-- ユーザーが明示的に「準備リストのリマインド」を変えた日時（学習で上書きしてよいかの判定用）
ALTER TABLE "Event" ADD COLUMN "listReminderTouchedAt" TIMESTAMP(3);
