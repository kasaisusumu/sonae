-- 失敗ログの振り返り結果。null=未選択 / "prevented"=防げた / "not_prevented"=防げなかった
ALTER TABLE "FailureLog" ADD COLUMN "outcome" TEXT;

-- 既に「防げた」を計上済み（SavingsEntry がある）ものは prevented 扱いにしておく
UPDATE "FailureLog" f
SET "outcome" = 'prevented'
WHERE EXISTS (
  SELECT 1 FROM "SavingsEntry" s
  WHERE s."failureLogId" = f."id" AND s."confirmedByUser" = true
);
