-- 予定終了後の「失敗あった？」に「なかった」を押した日時
ALTER TABLE "Event" ADD COLUMN "noFailureAt" TIMESTAMP(3);
