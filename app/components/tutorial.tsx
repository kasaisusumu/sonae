"use client";

import { useEffect, useState } from "react";

const KEY = "mm_tutorial_v1";
const EVENT = "mm:open-tutorial";

type Slide = { icon: string; title: string; body: string };

const SLIDES: Slide[] = [
  {
    icon: "👋",
    title: "ようこそ",
    body: "「私のマネージャー」は、予定を入れるだけで“準備すること”と“持ち物”を自動で用意します。使うほどあなた専用の手順書に育ちます。まず 6 ステップだけ見ていきましょう。",
  },
  {
    icon: "📅",
    title: "① Google カレンダーとつなぐ",
    body: "設定、またはホームの「はじめかた」から Google カレンダーを連携します。以後、カレンダーに予定を入れるだけで自動で取り込まれます（アプリ内での手動追加はありません）。",
  },
  {
    icon: "✅",
    title: "② 予定を開いて準備リストを見る",
    body: "予定をタップすると「準備すること」と「持ち物」が出ます。用意できたらチェック。チェック済みは（次にページを開いたとき）下へ移動します。予定の“準備リストのリマインド”（初期は1日前）で、当日までにまとめて通知が届きます。",
  },
  {
    icon: "✏️",
    title: "③ 直すと賢くなる",
    body: "いる／いらないを直す、項目を足す、🔔で通知タイミングを決める——どれも自動保存され、次の似た予定から反映されます。一度決めた通知は、以後その学習どおりが初期値になります。",
  },
  {
    icon: "📋",
    title: "④ よく使うセットはテンプレに",
    body: "リスト下の「⭐ 名前をつけて保存」でテンプレ化。別の予定では「📋 テンプレから」「📆 他の予定から」で呼び出せます。作成・編集は「学習」タブでも行えます。",
  },
  {
    icon: "🛟",
    title: "⑤ うっかりは失敗ログに",
    body: "予定ページ上部の「こんな失敗もあり得ます」から、似た予定の失敗を記録できます。防げた分は節約額ダッシュボード（ホーム）に積み上がります。関係なければ「今回は関係ない」で消せます。",
  },
  {
    icon: "🎉",
    title: "準備OK",
    body: "困ったら 設定 →「チュートリアルをもう一度見る」でいつでも読み返せます。それでは、はじめましょう。",
  },
];

/** 設定ページの「チュートリアルをもう一度見る」ボタン。 */
export function ReplayTutorialButton() {
  return (
    <button
      type="button"
      onClick={() => window.dispatchEvent(new Event(EVENT))}
      className="block w-full rounded-2xl bg-surface p-5 text-left transition-colors hover:bg-surface-muted"
    >
      <span className="text-sm font-semibold text-muted">使い方</span>
      <span className="mt-2 block text-sm">チュートリアルをもう一度見る →</span>
    </button>
  );
}

export function Tutorial() {
  const [open, setOpen] = useState(false);
  const [i, setI] = useState(0);

  useEffect(() => {
    const show = () => {
      setI(0);
      setOpen(true);
    };
    window.addEventListener(EVENT, show);
    try {
      // 初回（このデバイスで未完了）なら自動で開く
      if (!localStorage.getItem(KEY)) queueMicrotask(show);
    } catch {
      /* localStorage 不可の環境では出さない */
    }
    return () => window.removeEventListener(EVENT, show);
  }, []);

  function finish() {
    try {
      localStorage.setItem(KEY, "done");
    } catch {
      /* ignore */
    }
    setOpen(false);
  }

  if (!open) return null;
  const s = SLIDES[i];
  const last = i === SLIDES.length - 1;

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/50 p-4 sm:items-center">
      <div className="w-full max-w-sm rounded-2xl bg-surface p-6 shadow-2xl">
        <div className="text-3xl">{s.icon}</div>
        <h2 className="mt-2 text-lg font-semibold text-foreground">{s.title}</h2>
        <p className="mt-2 whitespace-pre-line text-sm text-muted">{s.body}</p>

        <div className="mt-5 flex items-center justify-between">
          <button
            type="button"
            onClick={finish}
            className="text-xs text-muted hover:text-foreground"
          >
            スキップ
          </button>
          <div className="flex items-center gap-2">
            <span className="text-[11px] tabular-nums text-muted">
              {i + 1}/{SLIDES.length}
            </span>
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
              onClick={() => (last ? finish() : setI(i + 1))}
              className="rounded-lg bg-teal px-4 py-1.5 text-sm font-medium text-white hover:bg-teal-dark"
            >
              {last ? "はじめる" : "次へ"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
