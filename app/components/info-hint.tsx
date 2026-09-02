"use client";

import { useState, type ReactNode } from "react";

/**
 * ⓘ ボタン。押すと短い説明をポップアップ。長い注記は本文に直書きせずこれに入れる。
 */
export function InfoHint({
  children,
  label = "説明を見る",
  className = "",
}: {
  children: ReactNode;
  label?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <span className={`relative inline-block align-middle ${className}`}>
      <button
        type="button"
        aria-label={label}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-border text-[10px] font-semibold leading-none text-muted hover:border-foreground/50 hover:text-foreground"
      >
        i
      </button>
      {open && (
        <>
          <span
            className="fixed inset-0 z-40"
            onClick={() => setOpen(false)}
          />
          <span className="absolute left-0 top-5 z-50 block w-64 max-w-[75vw] rounded-lg border border-border bg-surface p-2.5 text-left text-[11px] font-normal leading-relaxed text-muted shadow-lg">
            {children}
          </span>
        </>
      )}
    </span>
  );
}
