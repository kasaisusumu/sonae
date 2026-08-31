-- 名前を付けて保存できる準備リストのテンプレート

-- CreateTable
CREATE TABLE "ListTemplate" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "note" TEXT,
    "sourceEventId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ListTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ListTemplateItem" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'task',
    "title" TEXT NOT NULL,
    "notifyLeadMinutes" INTEGER,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ListTemplateItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ListTemplate_userId_idx" ON "ListTemplate"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "ListTemplate_userId_name_key" ON "ListTemplate"("userId", "name");

-- CreateIndex
CREATE INDEX "ListTemplateItem_templateId_idx" ON "ListTemplateItem"("templateId");

-- AddForeignKey
ALTER TABLE "ListTemplate" ADD CONSTRAINT "ListTemplate_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ListTemplateItem" ADD CONSTRAINT "ListTemplateItem_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "ListTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;
