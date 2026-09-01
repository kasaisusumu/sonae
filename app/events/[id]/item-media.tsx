"use client";

import { useRef, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import {
  addChecklistItemImage,
  deleteChecklistItemImage,
} from "@/app/actions";

export type ItemImage = {
  id: string;
  data: string;
  width: number;
  height: number;
};

const MAX_DIM = 1280; // 長辺の上限（px）
const TARGET_BYTES = 320 * 1024; // これ以下を狙って再エンコード
const MAX_PER_ITEM = 4;

const bytesOfDataUrl = (d: string) =>
  Math.floor(((d.length - d.indexOf(",") - 1) * 3) / 4);

/** ブラウザ内で画像を縮小・再エンコードして、軽いデータ URL にする。 */
export async function compressImage(
  file: File,
): Promise<{ data: string; width: number; height: number } | null> {
  if (!file.type.startsWith("image/")) return null;

  const src: HTMLImageElement | ImageBitmap | null = await createImageBitmap(
    file,
  ).catch(async () => {
    const url = URL.createObjectURL(file);
    try {
      return await new Promise<HTMLImageElement | null>((res) => {
        const el = new Image();
        el.onload = () => res(el);
        el.onerror = () => res(null);
        el.src = url;
      });
    } finally {
      URL.revokeObjectURL(url);
    }
  });
  if (!src) return null;

  const iw = "width" in src ? src.width : 0;
  const ih = "height" in src ? src.height : 0;
  if (!iw || !ih) return null;

  const scale = Math.min(1, MAX_DIM / Math.max(iw, ih));
  const w = Math.max(1, Math.round(iw * scale));
  const h = Math.max(1, Math.round(ih * scale));

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.drawImage(src as CanvasImageSource, 0, 0, w, h);

  let quality = 0.72;
  let type = "image/webp";
  let data = canvas.toDataURL(type, quality);
  if (!data.startsWith("data:image/webp")) {
    type = "image/jpeg";
    data = canvas.toDataURL(type, quality);
  }
  while (bytesOfDataUrl(data) > TARGET_BYTES && quality > 0.4) {
    quality -= 0.12;
    data = canvas.toDataURL(type, quality);
  }
  return { data, width: w, height: h };
}

/** 文字列中の URL をリンクにする（メモのリンク表示用）。 */
export function Linkify({ text }: { text: string }): ReactNode {
  return text.split(/(https?:\/\/[^\s]+)/g).map((part, i) =>
    /^https?:\/\//.test(part) ? (
      <a
        key={i}
        href={part}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(e) => e.stopPropagation()}
        className="break-all text-teal-dark underline"
      >
        {part}
      </a>
    ) : (
      <span key={i}>{part}</span>
    ),
  );
}

/**
 * 準備リスト項目のメモに付ける写真。
 * - サムネイル一覧（✕ で削除。ボタンは常時表示＝スマホでも消せる）
 * - 「＋ 写真」で選択 → ブラウザで圧縮 → 保存
 * - タップで拡大（中央表示）
 * 未保存の項目（itemId 無し）や項目名が空のときは追加不可。
 */
export function ItemImages({
  eventId,
  kind,
  title,
  canAttach,
  images,
}: {
  eventId: string;
  kind: string;
  title: string;
  canAttach: boolean;
  images: ItemImage[];
}) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [zoom, setZoom] = useState<ItemImage | null>(null);
  const [, startTransition] = useTransition();

  async function onFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setBusy(true);
    setNote(null);
    let added = 0;
    let failed = 0;
    for (const file of Array.from(files)) {
      if (images.length + added >= MAX_PER_ITEM) {
        failed++;
        continue;
      }
      try {
        const c = await compressImage(file);
        if (!c) {
          failed++;
          continue;
        }
        const res = await addChecklistItemImage({
          eventId,
          kind,
          title,
          data: c.data,
          width: c.width,
          height: c.height,
        });
        if (res.ok) added++;
        else {
          failed++;
          setNote(res.error ?? "追加できませんでした。");
        }
      } catch {
        failed++;
      }
    }
    setBusy(false);
    if (fileRef.current) fileRef.current.value = "";
    if (added > 0) {
      setNote(`${added}枚を追加${failed ? `（${failed}枚は失敗）` : ""}`);
      router.refresh();
    } else if (failed > 0 && !note) {
      setNote("追加できませんでした。");
    }
  }

  function remove(id: string) {
    if (!window.confirm("この画像を削除しますか？")) return;
    const fd = new FormData();
    fd.set("id", id);
    startTransition(async () => {
      await deleteChecklistItemImage(fd);
      router.refresh();
    });
  }

  return (
    <div className="space-y-1.5">
      {images.length > 0 && (
        <ul className="flex flex-wrap gap-1.5">
          {images.map((img) => (
            <li
              key={img.id}
              className="relative h-16 w-16 overflow-hidden rounded-md border border-border bg-background"
            >
              <button
                type="button"
                onClick={() => setZoom(img)}
                className="block h-full w-full"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={img.data}
                  alt="メモの写真"
                  loading="lazy"
                  className="h-full w-full object-cover"
                />
              </button>
              <button
                type="button"
                onClick={() => remove(img.id)}
                aria-label="写真を削除"
                className="absolute right-0.5 top-0.5 rounded-full bg-black/60 px-1 text-[10px] leading-4 text-white"
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={busy || !canAttach || images.length >= MAX_PER_ITEM}
          className="rounded-md border border-dashed border-border px-2 py-0.5 text-[11px] text-muted hover:border-teal hover:text-teal-dark disabled:opacity-50"
        >
          {busy ? "追加中…" : "＋ 写真"}
        </button>
        {!canAttach && (
          <span className="text-[11px] text-muted">
            先に項目名を入れて保存すると付けられます
          </span>
        )}
        {note && <span className="text-[11px] text-teal-dark">{note}</span>}
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={(e) => onFiles(e.target.files)}
        />
      </div>

      {zoom && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4"
          onClick={() => setZoom(null)}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={zoom.data}
            alt="メモの写真"
            className="max-h-[85vh] max-w-full rounded-lg"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </div>
  );
}
