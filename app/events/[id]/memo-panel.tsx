"use client";

import {
  useEffect,
  useRef,
  useState,
  useTransition,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import { addEventImage, deleteEventImage, setEventMemo } from "@/app/actions";

type Img = { id: string; data: string; width: number; height: number };

const MAX_DIM = 1280; // 長辺の上限（px）
const TARGET_BYTES = 320 * 1024; // これ以下を狙って再エンコード

const bytesOfDataUrl = (d: string) =>
  Math.floor(((d.length - d.indexOf(",") - 1) * 3) / 4);

/** ブラウザ内で画像を縮小・再エンコードして、軽いデータ URL にする。 */
async function compressImage(
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
  let data = canvas.toDataURL("image/webp", quality);
  let type = "image/webp";
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

/** 本文中の URL をリンクにする。 */
function linkify(text: string): ReactNode[] {
  return text.split(/(https?:\/\/[^\s]+)/g).map((part, i) =>
    /^https?:\/\//.test(part) ? (
      <a
        key={i}
        href={part}
        target="_blank"
        rel="noopener noreferrer"
        className="break-all text-teal-dark underline"
      >
        {part}
      </a>
    ) : (
      <span key={i}>{part}</span>
    ),
  );
}

export function MemoPanel({
  eventId,
  initialMemo,
  images,
}: {
  eventId: string;
  initialMemo: string | null;
  images: Img[];
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(initialMemo ?? "");
  const [serverMemo, setServerMemo] = useState(initialMemo ?? "");
  const [pending, startTransition] = useTransition();

  // サーバ側の memo が変わったら（Google 側の編集を取り込んだ等）追従する。
  // 編集中は上書きしない。effect ではなくレンダー中の同期（React 推奨パターン）。
  if (!editing && (initialMemo ?? "") !== serverMemo) {
    setServerMemo(initialMemo ?? "");
    setText(initialMemo ?? "");
  }
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [lightbox, setLightbox] = useState<Img | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const dirty = (initialMemo ?? "") !== text;

  // 入力が 1.5 秒止まったら自動保存
  useEffect(() => {
    if (!editing || !dirty || pending) return;
    const t = window.setTimeout(() => {
      const fd = new FormData();
      fd.set("eventId", eventId);
      fd.set("memo", text);
      startTransition(async () => {
        await setEventMemo(fd);
        setSavedAt(Date.now());
      });
    }, 1500);
    return () => window.clearTimeout(t);
  }, [text, editing, dirty, pending, eventId]);

  function flush() {
    if (!dirty) return;
    const fd = new FormData();
    fd.set("eventId", eventId);
    fd.set("memo", text);
    startTransition(async () => {
      await setEventMemo(fd);
      setSavedAt(Date.now());
    });
  }

  async function onFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setBusy(true);
    setNote(null);
    let added = 0;
    let failed = 0;
    for (const file of Array.from(files)) {
      try {
        const c = await compressImage(file);
        if (!c) {
          failed++;
          continue;
        }
        const res = await addEventImage({
          eventId,
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
      setNote(
        `${added}枚を追加しました${failed ? `（${failed}枚は失敗）` : ""}。`,
      );
      router.refresh();
    } else if (failed > 0 && !note) {
      setNote("画像を追加できませんでした。");
    }
  }

  function removeImage(id: string) {
    if (!window.confirm("この画像を削除しますか？")) return;
    const fd = new FormData();
    fd.set("id", id);
    startTransition(async () => {
      await deleteEventImage(fd);
      router.refresh();
    });
  }

  const hasBody = text.trim().length > 0;

  return (
    <section className="rounded-2xl bg-surface p-4">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-muted">メモ</h2>
        <div className="flex items-center gap-2 text-[11px] text-muted">
          {editing && (
            <span>
              {pending
                ? "保存中…"
                : dirty
                  ? "変更あり（自動保存）"
                  : savedAt
                    ? "保存しました"
                    : ""}
            </span>
          )}
          <button
            type="button"
            onClick={() => {
              if (editing) {
                flush();
                setEditing(false);
              } else {
                setEditing(true);
              }
            }}
            className="rounded-md border border-border px-2.5 py-1 text-xs text-muted hover:border-teal hover:text-teal-dark"
          >
            {editing ? "完了" : hasBody ? "編集" : "メモを書く"}
          </button>
        </div>
      </div>

      {editing ? (
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={4}
          placeholder={
            "自由に書けます。\nhttps://… と書くとリンクになります。\n画像は下の「＋ 画像」から。"
          }
          className="w-full rounded-lg border bg-background px-3 py-2 text-sm"
          autoFocus
        />
      ) : hasBody ? (
        <p className="whitespace-pre-wrap break-words rounded-lg bg-surface-muted p-3 text-sm text-foreground/90">
          {linkify(text)}
        </p>
      ) : (
        <p className="rounded-lg bg-surface-muted p-3 text-sm text-muted">
          まだメモはありません。「メモを書く」から追加できます。
        </p>
      )}

      {/* 画像 */}
      <div className="mt-3">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={busy || images.length >= 6}
            className="rounded-md border border-dashed border-border px-2.5 py-1 text-xs text-muted hover:border-teal hover:text-teal-dark disabled:opacity-50"
          >
            {busy ? "追加中…" : "＋ 画像"}
          </button>
          <span className="text-[11px] text-muted">
            保存時に自動で圧縮します（長辺 {MAX_DIM}px 程度・最大 6 枚）。
          </span>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            multiple
            hidden
            onChange={(e) => onFiles(e.target.files)}
          />
        </div>
        {note && <p className="mt-1 text-[11px] text-teal-dark">{note}</p>}

        {images.length > 0 && (
          <ul className="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-4">
            {images.map((img) => (
              <li
                key={img.id}
                className="group relative overflow-hidden rounded-lg border border-border bg-background"
              >
                <button
                  type="button"
                  onClick={() => setLightbox(img)}
                  className="block w-full"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={img.data}
                    alt="メモの画像"
                    loading="lazy"
                    className="aspect-square w-full object-cover"
                  />
                </button>
                <button
                  type="button"
                  onClick={() => removeImage(img.id)}
                  aria-label="画像を削除"
                  className="absolute right-1 top-1 rounded-full bg-black/55 px-1.5 py-0.5 text-[11px] text-white opacity-0 transition-opacity group-hover:opacity-100"
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {lightbox && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
          onClick={() => setLightbox(null)}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={lightbox.data}
            alt="メモの画像"
            className="max-h-[85vh] max-w-full rounded-lg"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </section>
  );
}
