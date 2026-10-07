-- AlterTable
ALTER TABLE "UserGoogleAccount" ADD COLUMN     "syncError" TEXT,
ADD COLUMN     "syncErrorAt" TIMESTAMP(3);

