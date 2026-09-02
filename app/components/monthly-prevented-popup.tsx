"use client";

import { useState } from "react";
import { formatYen } from "@/lib/format";

type Item = {
  description: string;
  amountYen: number;
  eventTitle: string | null;
};

/**
 * ホームの節約カード内「今月防げたこと」。基本は1件だけ表示し、
 * 「… 全部見る（N件）」でポップアップに全件を出す。
 */
export function MonthlyPreventedPopup({ items }: { items: Item[] }) {
  const [open, setOpen] = useState(false);
  if (items.length === 0) return null;

  return (
    <div className="mt-4 rounded-xl bg-surface/10 p-4">
      <p className="text-xs font-semibold text-surface/80">今月防げたこと</p>
      <ul className="mt-2 space-y-1 text-sm text-surface/90">
        <li className="flex items-baseline justify-between gap-3">
          <span className="min-w-0 truncate">
            ・{items[0].description}
            {items[0].eventTitle ? (
              <span className="text-surface/60"> （{items[0].eventTitle}）</span>
            ) : null}
          </span>
          <span className="shrink-0 tabular-nums">
            {items[0].amountYen > 0 ? formatYen(items[0].amountYen) : "±0"}
          </span>
        </li>
      </ul>

      {items.length > 1 && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="mt-1.5 text-[11px] text-surface/75 underline hover:text-surface"
        >
          … 全部見る（{items.length}件）
        </button>
      )}

      {open && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4"
          onClick={() => setOpen(false)}
        >
          <div
            className="flex max-h-[80vh] w-full max-w-sm flex-col overflow-hidden rounded-2xl bg-surface shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-3 border-b border-border p-4">
              <p className="text-sm font-semibold text-foreground">
                今月防げたこと（{items.length}件）
              </p>
              <button
                type="button"
                aria-label="閉じる"
                onClick={() => setOpen(false)}
                className="rounded-lg px-2 py-1 text-muted hover:bg-surface-muted"
              >
                ✕
              </button>
            </div>
            <ul className="divide-y divide-border overflow-y-auto p-4 text-sm">
              {items.map((it, i) => (
                <li
                  key={i}
                  className="flex items-baseline justify-between gap-3 py-2 first:pt-0 last:pb-0"
                >
                  <span className="min-w-0">
                    ・{it.description}
                    {it.eventTitle ? (
                      <span className="text-muted"> （{it.eventTitle}）</span>
                    ) : null}
                  </span>
                  <span className="shrink-0 tabular-nums text-muted">
                    {it.amountYen > 0 ? formatYen(it.amountYen) : "±0"}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}
