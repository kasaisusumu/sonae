"use client";

import { useEffect, useState, type ReactNode } from "react";
import { markTutorialSeen } from "@/app/actions";

const KEY = "mm_tutorial_v3";
const EVENT = "mm:open-tutorial";

type Slide = { id: string; title: string; body: string };

const SLIDES: Slide[] = [
  {
    id: "open",
    title: "① もう手動で作らなくてOK",
    body: "カレンダーに予定を書くと「準備すること」と「持ち物」が自動で用意されます。",
  },
  {
    id: "learn",
    title: "② 直すと賢くなる",
    body: "いる／いらないを直す・足すだけ。次に似た予定が来たら、あなた好みで出てきます。",
  },
  {
    id: "desc",
    title: "③ カレンダーから直接ひらける",
    body: "予定の説明欄のリンクをタップすれば、その予定の準備リストがそのまま開きます。",
  },
  {
    id: "setup",
    title: "④ 仕上げに、この2つ",
    body: "①この画面を「ホーム画面に追加」 ②通知をオン。困ったときは左上の ☰ からいつでも。",
  },
];

function Visual({ id }: { id: string }): ReactNode {
  const box = "rounded-lg border border-border bg-background p-3";
  switch (id) {
    case "setup":
      return (
        <div className={`${box} space-y-1.5 text-xs`}>
          <div className="flex items-center gap-2">
            <span className="text-base">📲</span>
            <span>この画面を「ホーム画面に追加」</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-base">🔔</span>
            <span>通知をオン（新しい予定・準備のリマインド）</span>
          </div>
        </div>
      );
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

--- 私の準備マニュアル ---
準備リスト: https://…

【予想される失敗】
⚠ 集合時間に遅刻した

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
            <span className="rounded-md border border-border px-1.5 text-[10px] text-muted">
              ∨
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="flex-1">☐ 常備薬</span>
            <span className="text-[10px] text-teal-dark">🔔1日前</span>
            <span className="rounded-md border border-teal/40 bg-teal-soft px-1.5 text-[10px] text-teal-dark">
              ∧
            </span>
          </div>
          <div className="ml-3 rounded-md bg-surface-muted p-1.5 text-[10px] text-muted">
            通知 / メモ・リンク / ＋写真
          </div>
          <div className="flex items-center gap-2 text-muted line-through">
            <span className="flex-1">☑ 充電器</span>
          </div>
        </div>
      );
    case "section":
      return (
        <div className={`${box} space-y-1 text-xs`}>
          <p className="font-medium">【準備すること】</p>
          <p className="font-medium">【持ち物】</p>
          <p className="font-medium text-teal-dark">【買うもの】 ＋</p>
        </div>
      );
    case "chart":
      return (
        <div className={`${box}`}>
          <div className="mb-1 flex justify-end gap-1 text-[9px]">
            <span className="rounded bg-surface px-1 text-teal-dark">月</span>
            <span className="rounded px-1 text-muted">週</span>
            <span className="rounded px-1 text-muted">日</span>
          </div>
          <div className="flex items-end gap-1" style={{ height: 44 }}>
            {[
              [10, 30],
              [24, 60],
              [8, 20],
              [40, 90],
              [16, 45],
              [28, 70],
            ].map(([a, b], i) => (
              <div key={i} className="flex flex-1 items-end justify-center gap-0.5">
                <span
                  className="w-1 rounded-t bg-chart-amount"
                  style={{ height: `${b}%` }}
                />
                <span
                  className="w-1 rounded-t bg-chart-count"
                  style={{ height: `${a}%` }}
                />
              </div>
            ))}
          </div>
          <p className="mt-1 text-[9px] text-muted">■金額 ■件数</p>
        </div>
      );
    case "menu":
      return (
        <div className={`${box} text-xs`}>
          <p className="font-semibold">☰ メニュー</p>
          <ul className="mt-1 space-y-0.5 text-[11px] text-muted">
            <li>・このページの使い方をみる</li>
            <li>・アプリのチュートリアル</li>
            <li>・このアプリについて・注意</li>
          </ul>
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

export function Tutorial({ tutorialDone = false }: { tutorialDone?: boolean }) {
  const [open, setOpen] = useState(false);
  const [i, setI] = useState(0);

  useEffect(() => {
    const show = () => {
      setI(0);
      setOpen(true);
    };
    window.addEventListener(EVENT, show);
    try {
      // 「防ぎたい失敗」の初回プロンプトが先。それが終わってから自動表示する
      //（終了時に mm:open-tutorial を投げてくれる）。手動再生は EVENT で常に可能。
      // 完了状態はサーバー側でも持つ（PWA でも再表示しないため）。
      if (
        !tutorialDone &&
        !localStorage.getItem(KEY) &&
        localStorage.getItem("mm_prevent_goals_v1")
      ) {
        queueMicrotask(show);
      }
    } catch {
      /* localStorage 不可の環境では出さない */
    }
    return () => window.removeEventListener(EVENT, show);
  }, [tutorialDone]);

  function finish() {
    try {
      localStorage.setItem(KEY, "done");
    } catch {
      /* ignore */
    }
    void markTutorialSeen();
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
              className="rounded-lg bg-foreground px-4 py-1.5 text-sm font-medium text-surface hover:opacity-90"
            >
              {last ? "はじめる" : "次へ"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
