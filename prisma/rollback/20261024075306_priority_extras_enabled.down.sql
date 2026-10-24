-- ver2.1トグル列の追加を取り消す。追加のみのマイグレーションなので、逆順にDROPするだけ。
ALTER TABLE "User" DROP COLUMN "priorityExtrasEnabled";
