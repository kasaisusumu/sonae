-- CreateTable
CREATE TABLE "StandalonePriorityItem" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "priority" TEXT NOT NULL,
    "isDone" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StandalonePriorityItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StandalonePriorityItem_userId_idx" ON "StandalonePriorityItem"("userId");

-- AddForeignKey
ALTER TABLE "StandalonePriorityItem" ADD CONSTRAINT "StandalonePriorityItem_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
