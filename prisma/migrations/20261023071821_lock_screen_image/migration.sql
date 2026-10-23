-- CreateTable
CREATE TABLE "LockScreenImage" (
    "userId" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "data" BYTEA NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "bytes" INTEGER NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LockScreenImage_pkey" PRIMARY KEY ("userId")
);

-- AddForeignKey
ALTER TABLE "LockScreenImage" ADD CONSTRAINT "LockScreenImage_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
