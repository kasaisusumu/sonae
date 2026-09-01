-- メモの画像を「予定単位」から「準備リストの各項目単位」に付け替える。
-- 旧 EventImage は破棄する（検証版のため移行データなし）。
DROP TABLE IF EXISTS "EventImage";

-- CreateTable
CREATE TABLE "ChecklistItemImage" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "slot" TEXT NOT NULL,
    "data" TEXT NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "bytes" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChecklistItemImage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ChecklistItemImage_eventId_kind_slot_idx" ON "ChecklistItemImage"("eventId", "kind", "slot");

-- AddForeignKey
ALTER TABLE "ChecklistItemImage" ADD CONSTRAINT "ChecklistItemImage_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;
