"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

const BASE_TABS = [
  { href: "/", label: "ホーム" },
  { href: "/events", label: "予定" },
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

export function BottomNav({
  pendingReview = 0,
  failuresLabel = "未来の自分へ",
}: {
  pendingReview?: number;
  /** 機能モードで変わる「/failures」タブの表示名（本番版=失敗ログ／テスト版=未来の自分へ）。 */
  failuresLabel?: string;
}) {
  const pathname = usePathname();
  const keyboardOpen = useKeyboardOpen();
  const TABS = [
    BASE_TABS[0],
    BASE_TABS[1],
    { href: "/failures", label: failuresLabel },
    BASE_TABS[2],
    BASE_TABS[3],
  ];

  return (
    <nav
      data-coach="bottom-nav"
      aria-hidden={keyboardOpen}
      // position: fixed だと、スマホのブラウザのツールバー（アドレスバー）が
      // スクロールで自動的に隠れる/出るたびに、バーの位置が追いつくように
      // 一瞬ジャンプして見える不具合があった（ユーザー指摘により2026-10-20:
      // 「使ってる時に下のバーが上がってくる」＝キーボードではなくスクロール中）。
      // sticky にして通常のレイアウトの一部にすると、この追従ジャンプが起きない
      // （body が flex flex-col のレイアウトなので、このバーが一番下に来る）。
      // キーボードが出ている間は、以前は return null（即消える／即出る）していたが、
      // キーボードが閉じた瞬間に何もアニメーションせず突然現れるのが「バーが上がって
      // 来る」ように見えていた（ユーザー指摘により2026-10-20）。transform + transition
      // でスライドさせ、現れ方を滑らかにする。
      className={`sticky bottom-0 z-20 border-t border-border bg-surface transition-transform duration-150 sm:hidden ${
        keyboardOpen ? "pointer-events-none translate-y-full" : "translate-y-0"
      }`}
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
