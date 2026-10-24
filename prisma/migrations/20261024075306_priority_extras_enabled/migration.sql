-- ver2.1（急ぎ/そのうちタグ・ホーム一覧・ショートカット連携をまとめたON/OFF）。追加のみ。
ALTER TABLE "User" ADD COLUMN "priorityExtrasEnabled" BOOLEAN NOT NULL DEFAULT false;
