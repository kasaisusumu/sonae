-- 名前付きリスト（ListTemplate）由来の項目に、元テンプレートを記録する。
-- 中身の編集（タイトルの追加/削除）を検知して枠名を「◯◯（編集済み）」に変える判定に使う。
-- AlterTable
ALTER TABLE "ChecklistItem" ADD COLUMN "sourceTemplateId" TEXT;

-- CreateIndex
CREATE INDEX "ChecklistItem_sourceTemplateId_idx" ON "ChecklistItem"("sourceTemplateId");

-- AddForeignKey
ALTER TABLE "ChecklistItem" ADD CONSTRAINT "ChecklistItem_sourceTemplateId_fkey" FOREIGN KEY ("sourceTemplateId") REFERENCES "ListTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;
