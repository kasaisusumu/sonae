-- 管理画面の利用時間でPC/スマホの判別ができるようにする。追加のみ（既存行は既定値unknownになる）。
ALTER TABLE "ActivityMinute" ADD COLUMN "device" TEXT NOT NULL DEFAULT 'unknown';
