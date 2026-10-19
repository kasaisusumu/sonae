-- DropIndex
DROP INDEX "FailureLog_eventId_idx";

-- AlterTable
ALTER TABLE "Event" ADD COLUMN     "lastWrittenContentHash" TEXT;
