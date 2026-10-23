-- ホームから予定に紐づけず追加できる急ぎ/そのうち項目（StandalonePriorityItem）の追加を取り消す。
-- 追加のみのマイグレーションなので、逆順にDROPするだけ（データの巻き戻しは不要）。

DROP TABLE IF EXISTS "StandalonePriorityItem";
