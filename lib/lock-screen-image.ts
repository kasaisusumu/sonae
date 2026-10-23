/**
 * ロック画面の背景画像（1ユーザー1枚、2026-10-23追加）。
 * ブラウザ側で長辺2,800px以内・2MB以内のJPEGに縮小変換してから送られてくる想定だが、
 * サーバー側でも種類・サイズ・寸法を必ず検証し、sharp で再エンコードして
 * EXIF 等のメタデータを除去してから保存する（`sharp(...).jpeg()` は `withMetadata()` を
 * 呼ばない既定の挙動でメタデータを落とす）。
 */
import sharp, { type Metadata } from "sharp";
import { prisma } from "@/lib/prisma";

export const LOCK_SCREEN_IMAGE_MAX_BYTES = 2 * 1024 * 1024; // 2MB
export const LOCK_SCREEN_IMAGE_MAX_EDGE = 2800;

export type LockScreenImageError =
  | "too_large"
  | "invalid_image"
  | "invalid_format"
  | "invalid_dimensions";

export interface LockScreenImageMeta {
  mime: string;
  width: number;
  height: number;
  bytes: number;
  updatedAt: Date;
}

export async function saveLockScreenImage(
  userId: string,
  buffer: Buffer,
): Promise<{ ok: true } | { ok: false; error: LockScreenImageError }> {
  if (buffer.length === 0 || buffer.length > LOCK_SCREEN_IMAGE_MAX_BYTES) {
    return { ok: false, error: "too_large" };
  }

  let meta: Metadata;
  try {
    meta = await sharp(buffer).metadata();
  } catch {
    return { ok: false, error: "invalid_image" };
  }
  if (meta.format !== "jpeg") {
    return { ok: false, error: "invalid_format" };
  }
  const w = meta.width ?? 0;
  const h = meta.height ?? 0;
  if (w <= 0 || h <= 0 || Math.max(w, h) > LOCK_SCREEN_IMAGE_MAX_EDGE) {
    return { ok: false, error: "invalid_dimensions" };
  }

  // 再エンコード（withMetadata() を呼ばない）でEXIF等のメタデータを落とす。
  // quality 90 で大きすぎる場合は 75 まで一段階だけ下げて再試行する。
  let clean = await sharp(buffer).jpeg({ quality: 90, mozjpeg: true }).toBuffer();
  if (clean.length > LOCK_SCREEN_IMAGE_MAX_BYTES) {
    clean = await sharp(buffer).jpeg({ quality: 75, mozjpeg: true }).toBuffer();
  }
  if (clean.length > LOCK_SCREEN_IMAGE_MAX_BYTES) {
    return { ok: false, error: "too_large" };
  }
  const cleanMeta = await sharp(clean).metadata();

  await prisma.lockScreenImage.upsert({
    where: { userId },
    update: {
      mime: "image/jpeg",
      data: clean,
      width: cleanMeta.width ?? w,
      height: cleanMeta.height ?? h,
      bytes: clean.length,
    },
    create: {
      userId,
      mime: "image/jpeg",
      data: clean,
      width: cleanMeta.width ?? w,
      height: cleanMeta.height ?? h,
      bytes: clean.length,
    },
  });
  return { ok: true };
}

export async function loadLockScreenImage(
  userId: string,
): Promise<{ data: Buffer; width: number; height: number } | null> {
  const row = await prisma.lockScreenImage.findUnique({
    where: { userId },
    select: { data: true, width: true, height: true },
  });
  if (!row) return null;
  return { data: Buffer.from(row.data), width: row.width, height: row.height };
}

export async function loadLockScreenImageMeta(
  userId: string,
): Promise<LockScreenImageMeta | null> {
  return prisma.lockScreenImage.findUnique({
    where: { userId },
    select: { mime: true, width: true, height: true, bytes: true, updatedAt: true },
  });
}

export async function deleteLockScreenImage(userId: string): Promise<void> {
  await prisma.lockScreenImage.deleteMany({ where: { userId } });
}
