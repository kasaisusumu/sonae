"use client";

import { useState, type ReactNode } from "react";
import { trackFeatureUse } from "@/app/actions";

/**
 * ⓘ ボタン。押すと画面中央に読みやすいポップアップで説明を出す。
 * （tooltip 方式だと右端で画面外にはみ出し、横スクロールが出ていたので中央固定に）
 * 見出しや <p> の中に置けるよう、要素は span / button のみで組む。
 * `id` は管理画面の利用状況分析用の識別子（`lib/track-catalog.ts` の
 * `INFOHINT_KEYS` と対応させる。新しく置いたら両方に追記すること）。
 *
 * `open`/`onOpenChange` を渡すと開閉状態を呼び出し元が持つ「制御あり」モードになる
 * （省略時は内部の useState で自分で持つ）。頻繁に key が振り直されて丸ごと再マウントされる
 * 行（例: 準備リストの項目行。自動保存のたびに key が変わる）の中に置く場合、内部 state だと
 * 保存が完了した瞬間に再マウントされて開いたポップアップが即閉じてしまう。呼び出し元の、
 * 再マウントされない場所に state を持たせて渡すことでそれを避けられる。
 */
export function InfoHint({
  id,
  children,
  pages,
  label = "説明を見る",
  open: controlledOpen,
  onOpenChange,
}: {
  id: string;
  /** 通常は1ページ。複数ページにしたいときは `pages` を使う（`children` とは排他）。 */
  children?: ReactNode;
  /** 指定すると複数ページ化し、下に「1/N」とページ送りボタンが出る。 */
  pages?: ReactNode[];
  label?: string;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const [localOpen, setLocalOpen] = useState(false);
  const [pageIndex, setPageIndex] = useState(0);
  const open = controlledOpen ?? localOpen;
  const setOpen = onOpenChange ?? setLocalOpen;
  const isPaged = !!pages && pages.length > 1;
  const content = pages ? pages[Math.min(pageIndex, pages.length - 1)] : children;
  return (
    <>
      <button
        type="button"
        aria-label={label}
        aria-expanded={open}
        onClick={() => {
          setPageIndex(0);
          setOpen(true);
          void trackFeatureUse(`infohint:${id}`);
        }}
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
            {content}
            <span className="mt-3 flex items-center justify-between">
              {isPaged ? (
                <>
                  <button
                    type="button"
                    onClick={() => setPageIndex((i) => Math.max(0, i - 1))}
                    disabled={pageIndex === 0}
                    className="rounded-lg border border-border px-2.5 py-1 text-xs text-muted hover:border-foreground/40 disabled:opacity-30"
                  >
                    ← 前へ
                  </button>
                  <span className="text-[11px] tabular-nums text-muted">
                    {pageIndex + 1} / {pages!.length}
                  </span>
                  {pageIndex < pages!.length - 1 ? (
                    <button
                      type="button"
                      onClick={() => setPageIndex((i) => Math.min(pages!.length - 1, i + 1))}
                      className="rounded-lg border border-border px-2.5 py-1 text-xs text-muted hover:border-foreground/40"
                    >
                      次へ →
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setOpen(false)}
                      className="rounded-lg bg-foreground px-3 py-1 text-xs font-medium text-surface hover:opacity-90"
                    >
                      閉じる
                    </button>
                  )}
                </>
              ) : (
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="ml-auto rounded-lg bg-foreground px-3 py-1 text-xs font-medium text-surface hover:opacity-90"
                >
                  閉じる
                </button>
              )}
            </span>
          </span>
        </span>
      )}
    </>
  );
}
