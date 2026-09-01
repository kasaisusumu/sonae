-- 準備リストの「枠」（セクション）の順序。既定は準備すること・持ち物。
ALTER TABLE "Event" ADD COLUMN "sectionOrder" TEXT NOT NULL DEFAULT '["task","belonging"]';
