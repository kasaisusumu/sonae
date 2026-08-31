-- テンプレートを「準備すること(task)」用と「持ち物(belonging)」用で分ける

-- DropIndex
DROP INDEX IF EXISTS "ListTemplate_userId_name_key";

-- AlterTable
ALTER TABLE "ListTemplate" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'task';

-- 既存テンプレートは、含まれる項目の多い方の kind に寄せる（無ければ task）
UPDATE "ListTemplate" t
SET "kind" = COALESCE(
  (
    SELECT i."kind"
    FROM "ListTemplateItem" i
    WHERE i."templateId" = t."id"
    GROUP BY i."kind"
    ORDER BY COUNT(*) DESC
    LIMIT 1
  ),
  'task'
);

-- CreateIndex
CREATE UNIQUE INDEX "ListTemplate_userId_kind_name_key" ON "ListTemplate"("userId", "kind", "name");
