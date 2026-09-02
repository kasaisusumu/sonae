"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { logout } from "@/app/actions";

const NAV: [string, string][] = [
  ["/", "ホーム"],
  ["/events", "予定"],
  ["/failures", "失敗ログ"],
  ["/savings", "学習"],
  ["/settings", "設定"],
];

/**
 * 全ページ共通・左上のメニュー（ハンバーガー）。
 * - このページの使い方（PageCoach の再表示）
 * - アプリのチュートリアル（スライド）
 * - このアプリについて / 注意（開閉）
 * - 画面の移動・ログアウト
 */
export function MenuButton() {
  const [open, setOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const pathname = usePathname();

  // ルートが変わったら閉じる（effect 内の同期 setState は避ける）
  useEffect(() => {
    queueMicrotask(() => setOpen(false));
  }, [pathname]);

  // 開いている間は body スクロールを止める＋Esc で閉じる
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open]);

  const fire = (name: string) => {
    setOpen(false);
    // パネルが閉じるアニメを待たずに発火してよい
    window.dispatchEvent(new Event(name));
  };

  return (
    <>
      <button
        type="button"
        data-coach="menu"
        aria-label="メニュー"
        aria-expanded={open}
        onClick={() => setOpen(true)}
        className="-ml-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-foreground transition-colors hover:bg-surface-muted"
      >
        <span aria-hidden className="text-lg leading-none">
          ☰
        </span>
      </button>

      {open && (
        <div className="fixed inset-0 z-50" role="dialog" aria-modal="true">
          <div
            className="absolute inset-0 bg-black/40"
            onClick={() => setOpen(false)}
          />
          <div className="absolute inset-y-0 left-0 flex w-72 max-w-[82vw] flex-col overflow-y-auto bg-surface shadow-lg">
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <span className="text-sm font-semibold text-foreground">
                メニュー
              </span>
              <button
                type="button"
                aria-label="閉じる"
                onClick={() => setOpen(false)}
                className="rounded-lg px-2 py-1 text-muted hover:bg-surface-muted"
              >
                ✕
              </button>
            </div>

            <nav className="flex flex-col gap-1 p-3">
              <p className="px-2 pb-1 pt-1 text-[11px] font-semibold uppercase tracking-wide text-muted">
                ヘルプ
              </p>
              <button
                type="button"
                onClick={() => fire("mm:open-coach")}
                className="rounded-lg px-3 py-2 text-left text-sm text-foreground hover:bg-surface-muted"
              >
                このページの使い方をみる
              </button>
              <button
                type="button"
                onClick={() => fire("mm:open-tutorial")}
                className="rounded-lg px-3 py-2 text-left text-sm text-foreground hover:bg-surface-muted"
              >
                アプリのチュートリアル（最初の説明）
              </button>
              <button
                type="button"
                onClick={() => setAboutOpen((v) => !v)}
                aria-expanded={aboutOpen}
                className="rounded-lg px-3 py-2 text-left text-sm text-foreground hover:bg-surface-muted"
              >
                このアプリについて・注意 {aboutOpen ? "▲" : "▼"}
              </button>
              {aboutOpen && (
                <ul className="mx-1 mb-1 space-y-2 rounded-lg bg-surface-muted p-3 text-xs leading-relaxed text-muted">
                  <li>
                    予定を入れるだけで「準備すること」と「持ち物」が自動で用意されます。
                    いる／いらないを直すと、次の似た予定から賢くなります。
                  </li>
                  <li>
                    Google カレンダーは読み取りのみ。設定でオンにしたときだけ、
                    予定の説明欄に準備リストを書き込みます。
                  </li>
                  <li>
                    予定の説明欄のリンクから、その予定の準備リストを直接ひらけます。
                  </li>
                  <li>
                    節約額などの金額はすべて<strong>推定値</strong>です
                    （あなたが記録した失敗のうち「防げた」と選んだ額の合計。自動判定はしていません）。
                  </li>
                  <li>これは検証版です。ログアウトしてもデータは残ります。</li>
                </ul>
              )}

              <p className="px-2 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wide text-muted">
                移動
              </p>
              {NAV.map(([href, label]) => {
                const active =
                  href === "/" ? pathname === "/" : pathname.startsWith(href);
                return (
                  <Link
                    key={href}
                    href={href}
                    onClick={() => setOpen(false)}
                    className={`rounded-lg px-3 py-2 text-sm no-underline ${
                      active
                        ? "bg-accent-soft font-semibold text-teal-dark"
                        : "text-foreground hover:bg-surface-muted"
                    }`}
                  >
                    {label}
                  </Link>
                );
              })}

              <form action={logout} className="mt-2 border-t border-border pt-2">
                <button
                  type="submit"
                  onClick={(e) => {
                    if (
                      !window.confirm(
                        "ログアウトします。データは保存され、入り直せば元に戻ります。よろしいですか？",
                      )
                    ) {
                      e.preventDefault();
                    }
                  }}
                  className="w-full rounded-lg px-3 py-2 text-left text-sm text-muted hover:bg-surface-muted"
                >
                  ログアウト
                </button>
              </form>
            </nav>
          </div>
        </div>
      )}
    </>
  );
}
