"use client";

import { useState, type ReactNode } from "react";

/**
 * ⓘ ボタン。押すと画面中央に読みやすいポップアップで説明を出す。
 * （tooltip 方式だと右端で画面外にはみ出し、横スクロールが出ていたので中央固定に）
 * 見出しや <p> の中に置けるよう、要素は span / button のみで組む。
 */
export function InfoHint({
  children,
  label = "説明を見る",
}: {
  children: ReactNode;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        aria-label={label}
        aria-expanded={open}
        onClick={() => setOpen(true)}
        className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-border align-middle text-[10px] font-semibold leading-none text-muted hover:border-foreground/50 hover:text-foreground"
      >
        i
      </button>
      {open && (
        <span
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4"
          onClick={() => setOpen(false)}
        >
          <span
            className="block w-[min(22rem,92vw)] rounded-xl border border-border bg-surface p-4 text-left text-[13px] font-normal leading-relaxed text-foreground shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            {children}
            <span className="mt-3 block text-right">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-lg bg-foreground px-3 py-1 text-xs font-medium text-surface hover:opacity-90"
              >
                閉じる
              </button>
            </span>
          </span>
        </span>
      )}
    </>
  );
}
