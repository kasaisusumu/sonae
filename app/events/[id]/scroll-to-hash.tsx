"use client";

import { useEffect } from "react";

/**
 * 通知の deep link（例 #failure-check）先の要素が Suspense の後に現れても、
 * 数秒間はポーリングして一度だけスクロールする。
 */
export function ScrollToHash() {
  useEffect(() => {
    const id = window.location.hash.slice(1);
    if (!id) return;
    let tries = 0;
    const timer = window.setInterval(() => {
      const el = document.getElementById(id);
      if (el) {
        // 折りたたみ（<details>）が対象なら開いてからスクロール
        if (el.tagName === "DETAILS") (el as HTMLDetailsElement).open = true;
        el.closest("details")?.setAttribute("open", "");
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        window.clearInterval(timer);
      } else if (++tries > 40) {
        window.clearInterval(timer);
      }
    }, 250);
    return () => window.clearInterval(timer);
  }, []);
  return null;
}
