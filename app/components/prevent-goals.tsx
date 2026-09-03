"use client";

import { useEffect, useState } from "react";
import { seedFailureGoals } from "@/app/actions";

const KEY = "mm_prevent_goals_v1";
const TUTORIAL_KEY = "mm_tutorial_v3";

const OPTIONS = [
  "寝坊",
  "スマホを触ってて遅刻",
  "予約、連絡忘れ",
  "忘れ物",
  "バス・電車の乗り過ごし",
];

/**
 * ログインして一番はじめに出す「防ぎたい失敗はなんですか?」。
 * 選んだものを、はじめからカテゴリ全体の失敗ログとして登録する
 * （金額・予定紐付けはしない）。
 * 終わったら概念チュートリアルへ引き継ぐ（チュートリアル未完のときだけ）。
 */
export function PreventGoals() {
  const [show, setShow] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    try {
      if (!localStorage.getItem(KEY)) queueMicrotask(() => setShow(true));
    } catch {
      /* localStorage 不可の環境では出さない */
    }
  }, []);

  function toggle(v: string) {
    setPicked((p) => {
      const n = new Set(p);
      if (n.has(v)) n.delete(v);
      else n.add(v);
      return n;
    });
  }

  function finish() {
    try {
      localStorage.setItem(KEY, "1");
      if (!localStorage.getItem(TUTORIAL_KEY)) {
        window.dispatchEvent(new Event("mm:open-tutorial"));
      }
    } catch {
      /* ignore */
    }
    setShow(false);
  }

  async function submit() {
    setBusy(true);
    try {
      if (picked.size > 0) await seedFailureGoals([...picked]);
    } finally {
      setBusy(false);
      finish();
    }
  }

  if (!show) return null;

  return (
    <div
      data-mm-prevent-goals
      className="fixed inset-0 z-[61] flex items-center justify-center bg-black/55 p-4"
    >
      <div className="flex max-h-[85vh] w-full max-w-sm flex-col overflow-y-auto rounded-2xl bg-surface p-6 shadow-2xl">
        <h2 className="text-lg font-semibold text-foreground">
          防ぎたい失敗はなんですか？
        </h2>
        <p className="mt-1 text-sm text-muted">
          選んだものは、はじめから「失敗ログ」に入れておきます。似た予定が来たら
          先回りでお知らせします。あとで増やしたり消したりできます。
        </p>

        <div className="mt-4 space-y-2">
          {OPTIONS.map((o) => {
            const on = picked.has(o);
            return (
              <button
                key={o}
                type="button"
                onClick={() => toggle(o)}
                aria-pressed={on}
                className={`flex w-full items-center gap-3 rounded-xl border px-3.5 py-3 text-left text-sm transition-colors ${
                  on
                    ? "border-foreground bg-foreground text-surface"
                    : "border-border bg-surface text-foreground hover:bg-surface-muted"
                }`}
              >
                <span
                  className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md border text-xs ${
                    on
                      ? "border-surface bg-surface text-foreground"
                      : "border-border"
                  }`}
                >
                  {on ? "✓" : ""}
                </span>
                {o}
              </button>
            );
          })}
        </div>

        <button
          type="button"
          onClick={submit}
          disabled={busy}
          className="mt-5 rounded-lg bg-foreground px-4 py-2.5 text-sm font-semibold text-white [text-decoration:none] hover:opacity-90 disabled:opacity-60"
        >
          {busy
            ? "登録中…"
            : picked.size > 0
              ? `この${picked.size}つで始める`
              : "選ばずに始める"}
        </button>
        <button
          type="button"
          onClick={finish}
          disabled={busy}
          className="mt-2 text-xs text-muted hover:text-foreground"
        >
          スキップ
        </button>
      </div>
    </div>
  );
}
