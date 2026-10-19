-- CreateTable
CREATE TABLE "ChecklistScopeRule" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "normTitle" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "genres" TEXT NOT NULL DEFAULT '[]',
    "genreKeywords" TEXT NOT NULL DEFAULT '[]',
    "keywords" TEXT NOT NULL DEFAULT '[]',
    "categoryIds" TEXT NOT NULL DEFAULT '[]',
    "signature" TEXT,
    "sourceEventId" TEXT,
    "sourceEventTitle" TEXT,
    "reason" TEXT,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChecklistScopeRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EventChecklistScope" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "normTitle" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "ruleId" TEXT,
    "reason" TEXT,
    "source" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'proposed',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EventChecklistScope_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ChecklistScopeRule_userId_archivedAt_idx" ON "ChecklistScopeRule"("userId", "archivedAt");

-- CreateIndex
CREATE INDEX "EventChecklistScope_userId_idx" ON "EventChecklistScope"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "EventChecklistScope_eventId_kind_normTitle_key" ON "EventChecklistScope"("eventId", "kind", "normTitle");

-- AddForeignKey
ALTER TABLE "ChecklistScopeRule" ADD CONSTRAINT "ChecklistScopeRule_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventChecklistScope" ADD CONSTRAINT "EventChecklistScope_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventChecklistScope" ADD CONSTRAINT "EventChecklistScope_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventChecklistScope" ADD CONSTRAINT "EventChecklistScope_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "ChecklistScopeRule"("id") ON DELETE SET NULL ON UPDATE CASCADE;

