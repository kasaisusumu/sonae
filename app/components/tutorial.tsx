"use client";

import { useEffect, useState, type ReactNode } from "react";

const KEY = "mm_tutorial_v1";
const EVENT = "mm:open-tutorial";

type Slide = { id: string; title: string; body: string };

const SLIDES: Slide[] = [
  {
    id: "welcome",
    title: "ようこそ",
    body: "「私のマネージャー」は、予定を入れるだけで“準備すること”と“持ち物”を自動で用意します。使うほどあなた専用の手順書に育ちます。7 ステップだけ見ていきましょう。",
  },
  {
    id: "connect",
    title: "① Google カレンダーとつなぐ",
    body: "設定、またはホームの「はじめかた」から連携します。以後、カレンダーに予定を入れるだけで自動で取り込まれます（アプリ内での手動追加はありません）。",
  },
  {
    id: "desc",
    title: "② カレンダーの説明欄にも自動で書く",
    body: "連携をオンにすると、予定の説明欄に準備リスト（チェック状態つき）を自動で書き込みます。カレンダー側で説明欄をチェック／編集しても、アプリに取り込まれます（双方向）。元の説明文は残し、「--- 私のマネージャー ---」の部分だけ差し替えます。",
  },
  {
    id: "open",
    title: "③ 予定を開いて準備リストを見る",
    body: "予定をタップすると「準備すること」と「持ち物」が出ます。用意できたらチェック。チェック済みは（次にページを開いたとき）下へ移動します。予定の“準備リストのリマインド”（初期は1日前）で、当日までにまとめて通知が届きます。",
  },
  {
    id: "learn",
    title: "④ 直すと賢くなる",
    body: "いる／いらないを直す、項目を足す、🔔で通知タイミングを決める——どれも自動保存され、次の似た予定から反映されます。一度決めた通知は、以後その学習どおりが初期値になります。",
  },
  {
    id: "template",
    title: "⑤ よく使うセットはテンプレに",
    body: "リスト下の「⭐ 名前をつけて保存」でテンプレ化。別の予定では「📋 テンプレから」「📆 他の予定から」で呼び出せます。作成・編集は「学習」タブでも行えます。",
  },
  {
    id: "failure",
    title: "⑥ うっかりは失敗ログに",
    body: "予定ページ上部の「こんな失敗もあり得ます」から、似た予定の失敗を記録できます。防げた分は節約額ダッシュボード（ホーム）に積み上がります。関係なければ「今回は関係ない」で消せます。",
  },
  {
    id: "done",
    title: "準備OK",
    body: "困ったら 設定 →「チュートリアルをもう一度見る」でいつでも読み返せます。それでは、はじめましょう。",
  },
];

function Visual({ id }: { id: string }): ReactNode {
  const box = "rounded-lg border border-border bg-background p-3";
  switch (id) {
    case "welcome":
      return <div className="py-2 text-center text-5xl">🗒️✨</div>;
    case "connect":
      return (
        <div className={`${box} flex items-center gap-2 text-xs`}>
          <span className="text-lg">📅</span>
          <span>Google カレンダー</span>
          <span className="ml-auto rounded bg-teal px-2 py-0.5 text-[10px] text-white">
            連携する
          </span>
        </div>
      );
    case "desc":
      return (
        <pre className="overflow-x-auto rounded-lg border border-border bg-background p-3 text-[10px] leading-relaxed text-muted">
          {`（元の予定メモ）

--- 私のマネージャー ---
準備リスト: https://…
【持ち物】 1/3
☑ 充電器（1日前）
☐ モバイルバッテリー
☐ 常備薬
---`}
        </pre>
      );
    case "open":
      return (
        <div className={`${box} space-y-1 text-xs`}>
          <div className="flex items-center gap-2">
            <span className="flex-1">☐ モバイルバッテリー</span>
            <span className="rounded-full border border-teal/40 px-2 text-[10px] text-teal-dark">
              🔔なし
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="flex-1">☐ 常備薬</span>
          </div>
          <div className="flex items-center gap-2 text-muted line-through">
            <span className="flex-1">☑ 充電器</span>
          </div>
        </div>
      );
    case "learn":
      return (
        <div className={`${box} flex items-center gap-2 text-xs`}>
          <span className="flex-1">切符を用意する</span>
          <span className="rounded-full border border-teal/40 px-2 py-0.5 text-[10px] text-teal-dark">
            🔔3時間前
          </span>
          <span className="rounded-full border border-border px-1.5 py-0.5 text-[10px] text-muted">
            ✕
          </span>
        </div>
      );
    case "template":
      return (
        <div className="flex flex-wrap gap-1.5 text-[11px]">
          <span className="rounded-md border border-dashed border-border px-2 py-1 text-muted">
            📋 テンプレから
          </span>
          <span className="rounded-md border border-dashed border-border px-2 py-1 text-muted">
            📆 他の予定から
          </span>
          <span className="rounded-md border border-dashed border-border px-2 py-1 text-muted">
            ⭐ 名前をつけて保存
          </span>
        </div>
      );
    case "failure":
      return (
        <div className="space-y-1 rounded-lg border border-warn/30 bg-warn-soft p-3 text-xs">
          <p className="font-medium text-warn">こんな失敗もあり得ます</p>
          <p className="text-muted">集合時間に遅刻した</p>
          <div className="flex flex-wrap gap-2 text-[10px] text-muted">
            <span>◯まだ</span>
            <span>◯防げた</span>
            <span>◯防げなかった</span>
            <span>◯今回は関係ない</span>
          </div>
        </div>
      );
    case "done":
      return <div className="py-2 text-center text-5xl">🎉</div>;
  }
  return null;
}

/** 設定ページの「チュートリアルをもう一度見る」ボタン。 */
export function ReplayTutorialButton() {
  const replay = () => {
    // ページ内コーチマークも「初回」に戻して、各ページで出直すようにする
    try {
      for (let n = localStorage.length - 1; n >= 0; n--) {
        const k = localStorage.key(n);
        if (k && k.startsWith("mm_coach_")) localStorage.removeItem(k);
      }
    } catch {
      /* ignore */
    }
    window.dispatchEvent(new Event(EVENT));
  };
  return (
    <button
      type="button"
      data-coach="replay-tutorial"
      onClick={replay}
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
    <div
      data-mm-tutorial
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4"
    >
      <div className="flex max-h-[85vh] w-full max-w-sm flex-col overflow-y-auto rounded-2xl bg-surface p-6 shadow-2xl">
        <h2 className="text-lg font-semibold text-foreground">{s.title}</h2>

        <div className="my-3">
          <Visual id={s.id} />
        </div>

        <p className="whitespace-pre-line text-sm text-muted">{s.body}</p>

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
