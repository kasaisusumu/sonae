-- 説明欄の直接編集を二重に取り込まない（webhook と cron の競合対策）ための、
-- 直近に取り込んだ受信テキストのハッシュ。
ALTER TABLE "Event" ADD COLUMN "lastInboundHash" TEXT;
