-- AlterTable
ALTER TABLE "EventFutureMessage" ADD COLUMN     "priority" TEXT;

-- CreateTable
CREATE TABLE "ChecklistItemPriority" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "normTitle" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "priority" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChecklistItemPriority_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShortcutToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "label" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "ShortcutToken_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ChecklistItemPriority_userId_idx" ON "ChecklistItemPriority"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "ChecklistItemPriority_eventId_kind_normTitle_key" ON "ChecklistItemPriority"("eventId", "kind", "normTitle");

-- CreateIndex
CREATE UNIQUE INDEX "ShortcutToken_tokenHash_key" ON "ShortcutToken"("tokenHash");

-- CreateIndex
CREATE INDEX "ShortcutToken_userId_idx" ON "ShortcutToken"("userId");

-- AddForeignKey
ALTER TABLE "ChecklistItemPriority" ADD CONSTRAINT "ChecklistItemPriority_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChecklistItemPriority" ADD CONSTRAINT "ChecklistItemPriority_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShortcutToken" ADD CONSTRAINT "ShortcutToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
