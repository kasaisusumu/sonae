-- AlterTable
ALTER TABLE "Event" ADD COLUMN     "lastWrittenHash" TEXT;

-- AlterTable
ALTER TABLE "UserGoogleAccount" ADD COLUMN     "writeDescriptionEnabled" BOOLEAN NOT NULL DEFAULT false;

