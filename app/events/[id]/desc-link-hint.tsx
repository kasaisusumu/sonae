"use client";

import { useEffect, useState, type ReactNode } from "react";
import { dismissDescLinkHint, trackFeatureUse } from "@/app/actions";

type Page = { title: string; body: ReactNode };

const PAGES: Page[] = [
  {
    title: "カレンダーの説明欄からも編集できます",
    body: (
      <>
        <p>
          この予定の Google カレンダーの説明欄に直接書き込んでも、準備リストに反映されます。
          たとえば、説明欄が今こうなっているとします。
        </p>
        <pre className="whitespace-pre-wrap rounded-lg bg-surface-muted px-3 py-2 font-mono text-[11px] leading-relaxed text-foreground">
{`【準備すること】 1/3
☑ お茶を買う（1時間前）
・集合時間を確認`}
        </pre>
      </>
    ),
  },
  {
    title: "① 新しい項目を足す",
    body: (
      <>
        <p>
          「・」で始めて1行足すと、新しい未完了の項目になります。例えば最後に
          次の行を書き足すと…
        </p>
        <pre className="whitespace-pre-wrap rounded-lg bg-surface-muted px-3 py-2 font-mono text-[11px] leading-relaxed text-foreground">
{`・保険証を持っていく`}
        </pre>
        <p>
          → 準備リストに「<strong className="text-foreground">保険証を持っていく</strong>」が
          未完了の項目として追加されます。
        </p>
      </>
    ),
  },
  {
    title: "② 項目にメモを付ける",
    body: (
      <>
        <p>
          項目の行のすぐ下に、先頭を1マス空けて書くと、その項目へのメモになります。
          「集合時間を確認」の下にこう書くと…
        </p>
        <pre className="whitespace-pre-wrap rounded-lg bg-surface-muted px-3 py-2 font-mono text-[11px] leading-relaxed text-foreground">
{`・集合時間を確認
 9時に駅の改札で`}
        </pre>
        <p>
          → 「集合時間を確認」という項目に「
          <strong className="text-foreground">9時に駅の改札で</strong>
          」というメモが付きます（先頭の空白1マスがポイントです）。
        </p>
      </>
    ),
  },
];

/**
 * Google カレンダーの説明欄に入っているリンクから開いたときだけ出す案内。
 * 「今後表示しない」にチェックを入れて OK を押すまでは、開くたびに毎回表示する
 * （他のポップアップのような「1回だけ」ではない。ユーザーからの明示指定）。
 * 表示するかどうか（＝ src=cal で来たか・既に「今後表示しない」済みか）は
 * サーバー側（app/events/[id]/page.tsx）で判定し、show で渡す。
 * 内容が長いため、Tutorial（app/components/tutorial.tsx）と同じ
 * 戻る/次へ・ページ番号のページ送り UI で3ページに分けている。
 */
export function DescLinkHint({ show }: { show: boolean }) {
  const [open, setOpen] = useState(show);
  const [dontShowAgain, setDontShowAgain] = useState(false);
  const [i, setI] = useState(0);

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

  const page = PAGES[i];
  const last = i === PAGES.length - 1;

  return (
    <div
      className="fixed inset-0 z-[58] flex items-center justify-center bg-black/45 p-4"
      onClick={close}
    >
      <div
        className="flex max-h-[85vh] w-full max-w-sm flex-col overflow-y-auto rounded-2xl bg-surface p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-base font-semibold text-foreground">{page.title}</h2>
        <div className="mt-2 space-y-3 text-sm leading-relaxed text-muted">
          {page.body}
        </div>

        {last && (
          <label className="mt-4 flex items-center gap-2 text-xs text-muted">
            <input
              type="checkbox"
              checked={dontShowAgain}
              onChange={(e) => setDontShowAgain(e.target.checked)}
              className="accent-[var(--foreground)]"
            />
            今後表示しない
          </label>
        )}

        <div className="mt-4 flex items-center justify-between">
          <span className="text-[11px] tabular-nums text-muted">
            {i + 1}/{PAGES.length}
          </span>
          <div className="flex items-center gap-2">
            {i > 0 && (
              <button
                type="button"
                onClick={() => setI(i - 1)}
                className="rounded-lg border border-border px-3 py-1.5 text-sm text-muted hover:border-foreground/40"
              >
                戻る
              </button>
            )}
            <button
              type="button"
              onClick={() => (last ? close() : setI(i + 1))}
              className="rounded-lg bg-foreground px-4 py-1.5 text-sm font-medium text-surface hover:opacity-90"
            >
              {last ? "OK" : "次へ"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
