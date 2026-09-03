"use client";

import { useState } from "react";
import { formatYen } from "@/lib/format";
import {
  FailureReviewRow,
  type FRRow,
} from "@/app/components/failure-review-row";

/**
 * ホームの節約カード内「今月防げたこと」。基本は1件だけ表示し、
 * 「… 全部見る（N件）」でポップアップに全件を出す。
 * ポップアップの中身は失敗ログページ「過去の失敗予測の振り返り」と同じ形式で、
 * 中でスクロールできる。
 */
export function MonthlyPreventedPopup({ rows }: { rows: FRRow[] }) {
  const [open, setOpen] = useState(false);
  if (rows.length === 0) return null;

  const first = rows[0];

  return (
    <div className="mt-4 rounded-xl bg-surface/10 p-4">
      <p className="text-xs font-semibold text-surface/80">今月防げたこと</p>
      <ul className="mt-2 space-y-1 text-sm text-surface/90">
        <li className="flex items-baseline justify-between gap-3">
          <span className="min-w-0 truncate">
            ・{first.description}
            {first.eventTitle ? (
              <span className="text-surface/60"> （{first.eventTitle}）</span>
            ) : null}
          </span>
          <span className="shrink-0 tabular-nums">
            {first.estimatedLossYen > 0
              ? formatYen(first.estimatedLossYen)
              : "±0"}
          </span>
        </li>
      </ul>

      {rows.length > 1 && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="mt-1.5 text-[11px] text-surface/75 underline hover:text-surface"
        >
          … 全部見る（{rows.length}件）
        </button>
      )}

      {open && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4"
          onClick={() => setOpen(false)}
        >
          <div
            className="flex max-h-[85vh] w-full max-w-md flex-col overflow-hidden rounded-2xl bg-background text-foreground shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-3 border-b border-border bg-surface p-4">
              <p className="text-sm font-semibold text-foreground">
                今月 防げた失敗（{rows.length}件）
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
            <ul className="space-y-2 overflow-y-auto p-3">
              {rows.map((r, i) => (
                <FailureReviewRow key={r.id || `x${i}`} log={r} />
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}
