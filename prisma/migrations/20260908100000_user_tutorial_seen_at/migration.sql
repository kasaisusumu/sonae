-- 導入チュートリアルの完了/スキップをサーバー側でも保持する
-- （PWA をホーム画面に追加すると localStorage が分かれてチュートリアルが再表示されるため）。
ALTER TABLE "User" ADD COLUMN "tutorialSeenAt" TIMESTAMP(3);
