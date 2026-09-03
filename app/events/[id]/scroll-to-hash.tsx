"use client";

import { useEffect } from "react";

/**
 * 通知の deep link（例 #failure-check）先の要素が Suspense の後に現れても、
 * 数秒間はポーリングして一度だけスクロールする。
 * すでに同じ予定ページを開いている状態で通知をタップした場合は、フルリロード
 * ではなくハッシュだけが変わる（sw.js → sw-register.tsx）。その場合も拾えるよう
 * mount 時だけでなく hashchange でも走らせる。
 */
export function ScrollToHash() {
  useEffect(() => {
    let timer = 0;
    const run = () => {
      const id = window.location.hash.slice(1);
      if (!id) return;
      window.clearInterval(timer);
      let tries = 0;
      timer = window.setInterval(() => {
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
    };
    run();
    window.addEventListener("hashchange", run);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("hashchange", run);
    };
  }, []);
  return null;
}
