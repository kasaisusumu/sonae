-- AlterTable
ALTER TABLE "Event" ADD COLUMN     "futureMessageCheckedAt" TIMESTAMP(3),
ADD COLUMN     "messageReviewNotifiedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "FutureMessage" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "keywords" TEXT NOT NULL DEFAULT '[]',
    "genres" TEXT NOT NULL DEFAULT '[]',
    "genreKeywords" TEXT NOT NULL DEFAULT '[]',
    "categoryIds" TEXT NOT NULL DEFAULT '[]',
    "scope" TEXT NOT NULL DEFAULT 'keyword',
    "archivedAt" TIMESTAMP(3),
    "contextSummary" TEXT,
    "sourceEventTitle" TEXT,
    "sourceCategoryId" TEXT,
    "confirmedCount" INTEGER NOT NULL DEFAULT 0,
    "lastConfirmedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FutureMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EventFutureMessage" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'shown',
    "matchedBy" TEXT NOT NULL,
    "matchReason" TEXT,
    "notifiedAt" TIMESTAMP(3),
    "reviewNotifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EventFutureMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MessageProposalRecord" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "proposed" TEXT NOT NULL,
    "final" TEXT NOT NULL,
    "fieldChanged" TEXT NOT NULL,
    "acceptedAsIs" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MessageProposalRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FutureMessage_userId_idx" ON "FutureMessage"("userId");

-- CreateIndex
CREATE INDEX "EventFutureMessage_userId_idx" ON "EventFutureMessage"("userId");

-- CreateIndex
CREATE INDEX "EventFutureMessage_messageId_idx" ON "EventFutureMessage"("messageId");

-- CreateIndex
CREATE UNIQUE INDEX "EventFutureMessage_eventId_messageId_key" ON "EventFutureMessage"("eventId", "messageId");

-- CreateIndex
CREATE INDEX "MessageProposalRecord_userId_idx" ON "MessageProposalRecord"("userId");

-- CreateIndex
CREATE INDEX "MessageProposalRecord_messageId_idx" ON "MessageProposalRecord"("messageId");

-- AddForeignKey
ALTER TABLE "FutureMessage" ADD CONSTRAINT "FutureMessage_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventFutureMessage" ADD CONSTRAINT "EventFutureMessage_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventFutureMessage" ADD CONSTRAINT "EventFutureMessage_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "FutureMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventFutureMessage" ADD CONSTRAINT "EventFutureMessage_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MessageProposalRecord" ADD CONSTRAINT "MessageProposalRecord_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MessageProposalRecord" ADD CONSTRAINT "MessageProposalRecord_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "FutureMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MessageProposalRecord" ADD CONSTRAINT "MessageProposalRecord_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

