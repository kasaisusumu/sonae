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
        className="max-h-[85vh] w-full max-w-sm overflow-y-auto rounded-2xl bg-surface p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-base font-semibold text-foreground">
          カレンダーの説明欄からも編集できます
        </h2>
        <div className="mt-2 space-y-3 text-sm leading-relaxed text-muted">
          <p>
            この予定の Google カレンダーの説明欄に直接書き込んでも、準備リストに反映されます。
            たとえば、説明欄が今こうなっているとします。
          </p>
          <pre className="whitespace-pre-wrap rounded-lg bg-surface-muted px-3 py-2 font-mono text-[11px] leading-relaxed text-foreground">
{`【準備すること】 1/3
☑ お茶を買う（1時間前）
・集合時間を確認`}
          </pre>
          <div>
            <p className="font-medium text-foreground">① 新しい項目を足す</p>
            <p>
              「・」で始めて1行足すと、新しい未完了の項目になります。例えば最後に
              次の行を書き足すと…
            </p>
            <pre className="mt-1 whitespace-pre-wrap rounded-lg bg-surface-muted px-3 py-2 font-mono text-[11px] leading-relaxed text-foreground">
{`・保険証を持っていく`}
            </pre>
            <p>
              → 準備リストに「<strong className="text-foreground">保険証を持っていく</strong>」が
              未完了の項目として追加されます。
            </p>
          </div>
          <div>
            <p className="font-medium text-foreground">② 項目にメモを付ける</p>
            <p>
              項目の行のすぐ下に、先頭を1マス空けて書くと、その項目へのメモになります。
              「集合時間を確認」の下にこう書くと…
            </p>
            <pre className="mt-1 whitespace-pre-wrap rounded-lg bg-surface-muted px-3 py-2 font-mono text-[11px] leading-relaxed text-foreground">
{`・集合時間を確認
 9時に駅の改札で`}
            </pre>
            <p>
              → 「集合時間を確認」という項目に「
              <strong className="text-foreground">9時に駅の改札で</strong>
              」というメモが付きます（先頭の空白1マスがポイントです）。
            </p>
          </div>
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
