-- AlterTable: 差分同期トークン & Google Calendar watch チャンネル
ALTER TABLE "UserGoogleAccount" ADD COLUMN "syncToken" TEXT;
ALTER TABLE "UserGoogleAccount" ADD COLUMN "watchChannelId" TEXT;
ALTER TABLE "UserGoogleAccount" ADD COLUMN "watchResourceId" TEXT;
ALTER TABLE "UserGoogleAccount" ADD COLUMN "watchExpiration" TIMESTAMP(3);

-- AlterTable: 新規追加通知の記録
ALTER TABLE "Event" ADD COLUMN "notifiedAt" TIMESTAMP(3);
