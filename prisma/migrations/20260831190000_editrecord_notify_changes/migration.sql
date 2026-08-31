-- 編集の生ログにも通知リード時間の変更を残す（学習内容の樹形図で辿れるように）
ALTER TABLE "EditRecord" ADD COLUMN "notifyChanges" TEXT NOT NULL DEFAULT '{}';
