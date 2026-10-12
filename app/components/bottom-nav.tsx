"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/", label: "ホーム" },
  { href: "/events", label: "予定" },
  { href: "/failures", label: "失敗ログ" },
  { href: "/savings", label: "マニュアル" },
  { href: "/settings", label: "設定" },
];

function isEditableElement(el: Element | null): boolean {
  if (!el) return false;
  const tag = el.tagName;
  return (
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    (el as HTMLElement).isContentEditable
  );
}

/**
 * スマホのキーボードが出ている間だけ true。
 * キーボードで visualViewport が縮むと、`position:fixed; bottom:0` のバーが
 * キーボードの上まで“せり上がって”画面中央に浮いてしまうため、その間は隠す。
 * URL バーの伸縮（〜100px）で誤検知しないよう、しきい値は大きめ（150px）。
 *
 * 2026-10〜: 入力欄にフォーカスが無いときはビューポートが縮んでいても隠さない
 * （`focusedEditable` を同時に見る）。ブラウザのアドレスバー／ツールバーの
 * 伸縮だけでも 150px を超えることがあり、それだけでバーが消えたまま戻らない
 * 不具合があった。フォーカスの有無も条件に加えることで、キーボード以外が
 * 原因の縮みでは隠さないようにし、かつ `focusout` の瞬間に即座に復帰できる
 * （ビューポートのリサイズイベントが遅れる端末があるため、フォーカス解除を
 * 復帰のトリガーとしても使う）。
 */
function useKeyboardOpen(): boolean {
  const [shrunk, setShrunk] = useState(false);
  const [focusedEditable, setFocusedEditable] = useState(false);

  useEffect(() => {
    const vv = typeof window !== "undefined" ? window.visualViewport : null;
    if (!vv) return;
    const update = () => {
      const hidden = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      setShrunk(hidden > 150);
    };
    update();
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
    };
  }, []);

  useEffect(() => {
    const onFocusIn = (e: FocusEvent) =>
      setFocusedEditable(isEditableElement(e.target as Element | null));
    const onFocusOut = () => setFocusedEditable(false);
    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("focusout", onFocusOut);
    return () => {
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("focusout", onFocusOut);
    };
  }, []);

  return shrunk && focusedEditable;
}

export function BottomNav({ pendingReview = 0 }: { pendingReview?: number }) {
  const pathname = usePathname();
  const keyboardOpen = useKeyboardOpen();

  // キーボードが出ている間はバーを出さない（せり上がり防止）。
  if (keyboardOpen) return null;

  return (
    <nav
      data-coach="bottom-nav"
      className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-surface sm:hidden"
    >
      <ul
        className="mx-auto flex max-w-3xl px-2 pt-1.5"
        style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 0.375rem)" }}
      >
        {TABS.map((tab) => {
          const active =
            tab.href === "/"
              ? pathname === "/"
              : pathname.startsWith(tab.href);
          const dot = tab.href === "/failures" && pendingReview > 0;
          return (
            <li key={tab.href} className="flex-1">
              <Link
                href={tab.href}
                aria-current={active ? "page" : undefined}
                className={`relative flex flex-col items-center justify-center gap-1 rounded-xl py-2 text-[11px] no-underline transition-colors ${
                  active
                    ? "bg-accent-soft font-semibold text-teal-dark"
                    : "text-muted hover:text-foreground"
                }`}
              >
                {tab.label}
                {dot && (
                  <span className="absolute right-3 top-1.5 h-1.5 w-1.5 rounded-full bg-warn" />
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
