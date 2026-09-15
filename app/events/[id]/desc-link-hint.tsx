"use client";

import { useEffect, useState } from "react";
import { dismissDescLinkHint, trackFeatureUse } from "@/app/actions";

/**
 * Google カレンダーの説明欄に入っているリンクから開いたときだけ出す案内。
 * 「今後表示しない」にチェックを入れて OK を押すまでは、開くたびに毎回表示する
 * （他のポップアップのような「1回だけ」ではない。ユーザーからの明示指定）。
 * 表示するかどうか（＝ src=cal で来たか・既に「今後表示しない」済みか）は
 * サーバー側（app/events/[id]/page.tsx）で判定し、show で渡す。
 */
export function DescLinkHint({ show }: { show: boolean }) {
  const [open, setOpen] = useState(show);
  const [dontShowAgain, setDontShowAgain] = useState(false);

  useEffect(() => {
    if (show) void trackFeatureUse("popup:desc-link-hint:shown");
  }, [show]);

  if (!open) return null;

  function close() {
    if (dontShowAgain) {
      void dismissDescLinkHint();
    }
    setOpen(false);
  }

  return (
    <div
      className="fixed inset-0 z-[58] flex items-center justify-center bg-black/45 p-4"
      onClick={close}
    >
      <div
        className="w-full max-w-sm rounded-2xl bg-surface p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-base font-semibold text-foreground">
          カレンダーの説明欄からも編集できます
        </h2>
        <div className="mt-2 space-y-2 text-sm leading-relaxed text-muted">
          <p>
            この予定の Google カレンダーの説明欄に直接書き込んでも、準備リストに反映されます。
          </p>
          <p>「・」で始めて書くと、新しい未完了の項目として追加されます。</p>
          <p>行の先頭を1マス空けて書くと、すぐ上の項目へのメモとして扱われます。</p>
        </div>
        <label className="mt-4 flex items-center gap-2 text-xs text-muted">
          <input
            type="checkbox"
            checked={dontShowAgain}
            onChange={(e) => setDontShowAgain(e.target.checked)}
            className="accent-[var(--foreground)]"
          />
          今後表示しない
        </label>
        <div className="mt-3 flex justify-end">
          <button
            type="button"
            onClick={close}
            className="rounded-lg bg-foreground px-4 py-2 text-sm font-semibold text-white"
          >
            OK
          </button>
        </div>
      </div>
    </div>
  );
}
