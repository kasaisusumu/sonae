-- 失敗ログにも予定の特徴シグネチャを持たせ、チェックリスト学習と同じ粒度で
-- 「似た予定」にだけ警告できるようにする。既存行は "{}"（カテゴリ全体）扱い。
ALTER TABLE "FailureLog" ADD COLUMN "featureSignature" TEXT NOT NULL DEFAULT '{}';
