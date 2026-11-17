-- CreateEnum
CREATE TYPE "FollowStatus" AS ENUM ('pending', 'accepted');

-- Add profile images
ALTER TABLE "User"
ADD COLUMN "avatarData" BYTEA,
ADD COLUMN "avatarMime" VARCHAR(64),
ADD COLUMN "avatarUpdatedAt" TIMESTAMPTZ(6);

-- Existing relationships were already active before follow requests existed.
ALTER TABLE "Follow"
ADD COLUMN "status" "FollowStatus" NOT NULL DEFAULT 'accepted';

-- CreateTable
CREATE TABLE "PasswordResetToken" (
    "userId" UUID NOT NULL,
    "tokenHash" VARCHAR(64) NOT NULL,
    "expiresAt" TIMESTAMPTZ(6) NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PasswordResetToken_pkey" PRIMARY KEY ("userId")
);

-- CreateIndex
CREATE UNIQUE INDEX "PasswordResetToken_tokenHash_key" ON "PasswordResetToken"("tokenHash");

-- CreateIndex
CREATE INDEX "PasswordResetToken_expiresAt_idx" ON "PasswordResetToken"("expiresAt");

-- CreateIndex
CREATE INDEX "Follow_followingId_status_createdAt_idx" ON "Follow"("followingId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "Follow_followerId_status_createdAt_idx" ON "Follow"("followerId", "status", "createdAt");

-- AddForeignKey
ALTER TABLE "PasswordResetToken"
ADD CONSTRAINT "PasswordResetToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
