-- 管理画面の「利用時間」用の軽量な活動ログ。1 ユーザー・1 分につき最大 1 行。
-- CreateTable
CREATE TABLE "ActivityMinute" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "minuteAt" TIMESTAMP(3) NOT NULL,
    "dayKey" TEXT NOT NULL,

    CONSTRAINT "ActivityMinute_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ActivityMinute_userId_minuteAt_key" ON "ActivityMinute"("userId", "minuteAt");

-- CreateIndex
CREATE INDEX "ActivityMinute_userId_dayKey_idx" ON "ActivityMinute"("userId", "dayKey");

-- AddForeignKey
ALTER TABLE "ActivityMinute" ADD CONSTRAINT "ActivityMinute_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
