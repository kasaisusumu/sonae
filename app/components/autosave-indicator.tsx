"use client";

import { useEffect, useState } from "react";

/**
 * 自動保存中の目立つインジケータ。
 * ・黒地・白文字で目立たせる
 * ・右上ではなく右下に固定
 * ・スマホでキーボードが出ているときは、キーボードで隠れていない画面部分の右下へ
 *   （visualViewport の縮小ぶんを下マージンに足す）
 */
export function AutosaveIndicator({ show }: { show: boolean }) {
  const [bottom, setBottom] = useState(16);

  useEffect(() => {
    if (!show || typeof window === "undefined") return;
    const vv = window.visualViewport;
    if (!vv) return;
    const update = () => {
      // キーボードなどでビューポートが縮んだぶん（＝下に隠れている高さ）
      const hidden = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      setBottom(hidden + 16);
    };
    update();
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
    };
  }, [show]);

  if (!show) return null;

  return (
    <div
      aria-live="polite"
      style={{ bottom }}
      className="fixed right-3 z-[80] flex items-center gap-2 rounded-full bg-foreground px-4 py-2 text-xs font-semibold text-white shadow-lg ring-1 ring-white/20"
    >
      <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/35 border-t-white" />
      自動保存中…
    </div>
  );
}
