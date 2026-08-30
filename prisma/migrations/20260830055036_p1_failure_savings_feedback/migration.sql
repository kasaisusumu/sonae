-- AlterTable
ALTER TABLE "Event" ADD COLUMN "failureWarningAckAt" DATETIME;

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_SavingsEntry" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "eventId" TEXT,
    "failureLogId" TEXT,
    "amountYen" INTEGER NOT NULL DEFAULT 0,
    "confirmedByUser" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SavingsEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SavingsEntry_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "SavingsEntry_failureLogId_fkey" FOREIGN KEY ("failureLogId") REFERENCES "FailureLog" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_SavingsEntry" ("amountYen", "confirmedByUser", "createdAt", "eventId", "failureLogId", "id", "userId") SELECT "amountYen", "confirmedByUser", "createdAt", "eventId", "failureLogId", "id", "userId" FROM "SavingsEntry";
DROP TABLE "SavingsEntry";
ALTER TABLE "new_SavingsEntry" RENAME TO "SavingsEntry";
CREATE UNIQUE INDEX "SavingsEntry_eventId_failureLogId_key" ON "SavingsEntry"("eventId", "failureLogId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
