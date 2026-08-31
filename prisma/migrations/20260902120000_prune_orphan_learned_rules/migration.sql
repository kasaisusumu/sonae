-- 一括生成などの副産物として、対応する編集履歴(EditRecord)が
-- 1件も無い学習ルールが残っている場合は掃除する（ユーザーが固定したものは残す）。
-- 今後は recall / 学習ツリーが「確認 or 編集された予定」だけを見るようになるので、
-- ここでは根拠を失った LearnedRule のみを対象にする。
DELETE FROM "LearnedRule" lr
WHERE lr."isUserLocked" = false
  AND NOT EXISTS (
    SELECT 1 FROM "EditRecord" er WHERE er."categoryId" = lr."categoryId"
  );
