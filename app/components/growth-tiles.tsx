"use client";

import { useState } from "react";
import { X } from "lucide-react";
import type { GrowthDetailItem } from "@/lib/growth-stats";

interface Tile {
  label: string;
  value: number;
  unit: string;
  items: GrowthDetailItem[];
}

/** 「そなえさんの成長」の4タイル。タップすると内訳をポップアップで見られる。 */
export function GrowthTiles({ tiles }: { tiles: Tile[] }) {
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const open = openIndex !== null ? tiles[openIndex] : null;

  return (
    <>
      <div className="grid grid-cols-2 gap-3">
        {tiles.map((t, i) => (
          <button
            key={t.label}
            type="button"
            onClick={() => setOpenIndex(i)}
            className="rounded-xl bg-surface-muted p-4 text-left hover:bg-accent-soft active:bg-accent-soft"
          >
            <p className="text-xs text-muted">{t.label}</p>
            <p className="mt-1 text-2xl font-bold text-chart-count">
              {t.value}
              <span className="ml-0.5 text-xs font-normal text-muted">
                {t.unit}
              </span>
            </p>
            <p className="mt-1 text-[11px] text-muted underline">詳しく見る</p>
          </button>
        ))}
      </div>

      {open && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4"
          onClick={() => setOpenIndex(null)}
        >
          <div
            className="flex max-h-[85vh] w-full max-w-md flex-col overflow-hidden rounded-2xl bg-background text-foreground shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-3 border-b border-border bg-surface p-4">
              <p className="text-sm font-semibold text-foreground">
                {open.label}（{open.value}
                {open.unit}）
              </p>
              <button
                type="button"
                aria-label="閉じる"
                onClick={() => setOpenIndex(null)}
                className="rounded-lg px-2 py-1 text-muted hover:bg-surface-muted"
              >
                <X aria-hidden className="h-4 w-4" />
              </button>
            </div>
            <div className="overflow-y-auto p-3">
              {open.items.length === 0 ? (
                <p className="p-2 text-sm text-muted">まだありません。</p>
              ) : (
                <>
                  <ul className="divide-y divide-border">
                    {open.items.map((it, i) => (
                      <li key={`${it.title}-${i}`} className="px-1 py-2">
                        <p className="truncate text-sm font-medium text-foreground">
                          {it.title}
                        </p>
                        <p className="truncate text-xs text-muted">{it.detail}</p>
                      </li>
                    ))}
                  </ul>
                  {open.items.length < open.value && (
                    <p className="px-1 pt-2 text-xs text-muted">
                      最新{open.items.length}件を表示（全{open.value}
                      {open.unit}）
                    </p>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
