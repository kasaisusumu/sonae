"use client";

import { useRef, useState } from "react";
import { saveLockScreenImageAction, deleteLockScreenImageAction } from "@/app/actions";
import { InfoHint } from "@/app/components/info-hint";

const MAX_EDGE = 2800;
const MAX_BYTES = 2 * 1024 * 1024;

/** ブラウザ側で長辺2,800px以内・2MB以内のJPEGに縮小変換する（サーバー側でも再検証する）。 */
async function resizeToJpeg(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas unsupported");
  ctx.drawImage(bitmap, 0, 0, w, h);

  // quality を段階的に下げて2MB以内に収める
  for (const quality of [0.9, 0.8, 0.7, 0.6, 0.5]) {
    const blob: Blob | null = await new Promise((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", quality),
    );
    if (blob && blob.size <= MAX_BYTES) return blob;
    if (quality === 0.5 && blob) return blob; // 最後はそのまま渡す（サーバー側で弾かれる）
  }
  throw new Error("resize failed");
}

const ERROR_LABEL: Record<string, string> = {
  too_large: "画像が大きすぎます（2MB以内にしてください）。",
  invalid_image: "画像を読み取れませんでした。",
  invalid_format: "JPEG形式にしてください。",
  invalid_dimensions: "画像の寸法が大きすぎます（長辺2,800px以内）。",
};

export function LockScreenImagePanel({ hasImage }: { hasImage: boolean }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [registered, setRegistered] = useState(hasImage);
  const [previewKey, setPreviewKey] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  async function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const resized = await resizeToJpeg(file);
      const fd = new FormData();
      fd.set("image", resized, "lock-screen.jpg");
      const res = await saveLockScreenImageAction(fd);
      if (!res.ok) {
        setError(ERROR_LABEL[res.error ?? ""] ?? "登録に失敗しました。");
      } else {
        setRegistered(true);
        setPreviewKey((k) => k + 1);
      }
    } catch {
      setError("画像の読み込みに失敗しました。");
    } finally {
      setBusy(false);
    }
  }

  function onDelete() {
    if (!window.confirm("ロック画面の背景画像を削除します。よろしいですか？")) return;
    setBusy(true);
    deleteLockScreenImageAction()
      .then(() => {
        setRegistered(false);
        setPreviewKey((k) => k + 1);
      })
      .finally(() => setBusy(false));
  }

  return (
    <div className="space-y-3">
      <h2 className="flex items-center gap-1.5 text-sm font-semibold text-muted">
        ロック画面の背景画像
        <InfoHint id="settings-lock-screen-image">
          <p className="mb-2 text-sm">
            ここに登録した画像の上に、直近の予定の準備リストと「急ぎ」「そのうち」を
            描き込んだ画像を、ショートカットがロック画面の壁紙に設定します。
          </p>
          <p className="text-[13px] text-muted">
            登録できるのは1枚だけです（新しく登録すると前の画像は上書きされます）。
          </p>
        </InfoHint>
      </h2>

      {registered && (
        <div className="overflow-hidden rounded-2xl border border-border bg-surface-muted">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            key={previewKey}
            src={`/api/settings/lock-screen-preview.png?w=1170&h=2532&t=${previewKey}`}
            alt="ロック画面の描画プレビュー"
            className="block w-full max-w-xs"
          />
        </div>
      )}

      {error && <p className="text-xs text-warn">{error}</p>}

      <div className="flex flex-wrap items-center gap-2">
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          onChange={onFileChange}
          className="hidden"
          id="lock-screen-image-input"
        />
        <label
          htmlFor="lock-screen-image-input"
          className={`cursor-pointer rounded-lg bg-surface-muted px-4 py-2 text-sm font-medium hover:bg-border ${busy ? "pointer-events-none opacity-50" : ""}`}
        >
          {busy ? "処理中…" : registered ? "画像を変更する" : "画像を登録する"}
        </label>
        {registered && (
          <button
            type="button"
            onClick={onDelete}
            disabled={busy}
            className="rounded-lg border border-border px-4 py-2 text-sm text-muted hover:border-warn hover:text-warn disabled:opacity-50"
          >
            削除
          </button>
        )}
      </div>
    </div>
  );
}
