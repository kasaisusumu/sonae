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

// ソフトキーボードを呼ばない input type（チェックボックス・ラジオ・ファイル選択等）。
// これらにフォーカスしても下のバーを隠さない（2026-10-24: フォーカスだけで判定する
// ように変更した直後、急ぎ/そのうちの完了チェックボックス・復活チェックボックスに
// タップするたびにバーが消える不具合が見つかり修正）。
const NON_KEYBOARD_INPUT_TYPES = new Set([
  "checkbox",
  "radio",
  "range",
  "color",
  "file",
  "button",
  "submit",
  "reset",
  "image",
  "hidden",
]);

function isEditableElement(el: Element | null): boolean {
  if (!el) return false;
  const tag = el.tagName;
  if (tag === "INPUT") {
    const type = (el as HTMLInputElement).type || "text";
    return !NON_KEYBOARD_INPUT_TYPES.has(type);
  }
  return tag === "TEXTAREA" || (el as HTMLElement).isContentEditable;
}

/**
 * スマホのキーボードが出ている間だけ true。
 * キーボードが出ると、`position:sticky; bottom:0` のバーがキーボードの上まで
 * “せり上がって”画面中央に浮いてしまうため、その間は隠す。
 *
 * 2026-10〜: 以前は `visualViewport` の縮み幅（しきい値150px）と、入力欄への
 * フォーカスの両方が true のときだけ隠す方式だった（ブラウザのアドレスバー／
 * ツールバーの伸縮だけでも150pxを超えることがあり、縮み幅だけで判定すると
 * キーボードと無関係にバーが消えたまま戻らない不具合があったため、フォーカスの
 * 有無も条件に加えていた）。
 *
 * 2026-10-24: それでも「キーボードを出すとバーがせり上がって見える」との指摘が
 * あった。原因は、iOSのホーム画面追加（PWAスタンドアロン）では、キーボード表示時に
 * `visualViewport` の `resize` イベントが実際のキーボード表示より遅れて発火する、
 * あるいは環境によってはほぼ発火しない（`window.innerHeight` もキーボードに
 * あわせて縮んでしまい差分で判定できない、等）ことがあり、「縮み幅」の確認を
 * 待っている間（あるいはいつまでも）隠れずに見えてしまうため。
 * **判定を入力欄のフォーカス有無だけに一本化した**（`visualViewport` には一切
 * 依存しない）。このバー自体 `sm:hidden` でスマホ幅でしか出ないため、この幅で
 * 入力欄にフォーカスが入る＝ほぼ確実にソフトキーボードが出る、という前提に立つ
 * （Bluetoothキーボード使用時など稀にキーボードが出ないままバーだけ隠れる
 * ケースはあるが、フォーカスを外せば即座に戻るため実害は小さいと判断した）。
 * 以前のビューポート縮み判定で防いでいた「ブラウザのツールバーの伸縮だけで誤って
 * 隠れる」問題も、フォーカス前提にしたことで同時に解消される。
 */
function useKeyboardOpen(): boolean {
  const [focusedEditable, setFocusedEditable] = useState(false);

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

  return focusedEditable;
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
