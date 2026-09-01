"use client";

import { useEffect, useState, type ReactNode } from "react";

const KEY = "mm_tutorial_v2";
const EVENT = "mm:open-tutorial";

type Slide = { id: string; title: string; body: string };

const SLIDES: Slide[] = [
  {
    id: "welcome",
    title: "ようこそ",
    body: "「私のマネージャー」は、予定を入れるだけで“準備すること”と“持ち物”を自動で用意します。使うほど、あなた専用の手順書に育ちます。おもな画面をさっと見ていきましょう。",
  },
  {
    id: "connect",
    title: "① Google カレンダーとつなぐ",
    body: "設定、またはホームの「はじめかた」から連携します。以後、カレンダーに予定を入れるだけで自動で取り込まれます（アプリ内での手動追加はありません）。読み取りのみで、書き込みは設定でオンにしたときだけです。",
  },
  {
    id: "desc",
    title: "② カレンダーの説明欄にも自動で書く",
    body: "書き込みをオンにすると、予定の説明欄に準備リスト（チェック状態つき）を自動で書き込みます。そこにある「準備リスト: …」のリンクをタップすれば、その予定のページが直接ひらきます。カレンダー側で説明欄を編集してもアプリに取り込まれます（双方向）。元の説明文は残し、「--- 私のマネージャー ---」の部分だけ差し替えます。",
  },
  {
    id: "open",
    title: "③ 予定を開いて準備リストを見る",
    body: "予定をタップすると「準備すること」と「持ち物」が出ます。用意できたらチェック（チェック済みは次に開いたとき下へ）。各項目の ∨ を開くと、その項目だけの通知タイミング・メモ・リンク・写真を設定できます（写真は自動で圧縮）。",
  },
  {
    id: "section",
    title: "④ リストの枠は自由に増やせる",
    body: "「準備すること」「持ち物」に加えて、「買うもの」など自分の枠を追加・改名・削除できます。増やした枠は、カレンダーの説明欄と「学習」ページにもそのまま反映されます。",
  },
  {
    id: "learn",
    title: "⑤ 直すと賢くなる",
    body: "いる／いらないを直す、項目を足す、通知タイミングを決める——どれも自動保存され（メモだけは「メモを保存」ボタン）、次の似た予定から反映されます。学習は“精度を上げる”ためのもので、リストが際限なく増えることはありません。一度決めた通知は、以後その学習どおりが初期値になります。",
  },
  {
    id: "template",
    title: "⑥ よく使うセットはテンプレに",
    body: "リスト下の「⭐ 名前をつけて保存」でテンプレ化。別の予定では「📋 テンプレから」「📆 他の予定から」で呼び出せます。作成・編集は「学習」タブでもできます。",
  },
  {
    id: "failure",
    title: "⑦ うっかりは失敗ログに",
    body: "予定ページの「似た予定でよくある失敗」か、「失敗ログ」ページから記録します。責めるためではなく、次に似た予定が来たときに先回りするためです。各記録に「防げた／防げなかった」を選べます。",
  },
  {
    id: "chart",
    title: "⑧ 防げた失敗はグラフで見える",
    body: "ホームに「防げた失敗」のグラフが常に出ます。ティール＝金額、オレンジ＝件数の二軸で、「月／週／日」を切り替えられます（選んだ表示は次回も保持）。「防げた」と選んだ推定損失額の合計が、今月の推定節約額です（参考値・自動判定なし）。",
  },
  {
    id: "menu",
    title: "⑨ 困ったら左上の ☰",
    body: "どのページでも、左上の ☰ から「このページの使い方をみる」「アプリのチュートリアル」「このアプリについて・注意」を開けます。ページの移動やログアウトもここから。",
  },
  {
    id: "done",
    title: "準備OK",
    body: "この説明は、左上の ☰ →「アプリのチュートリアル」でいつでも読み返せます。各ページの ☰ →「このページの使い方をみる」を押すと、実際のボタンを1つずつ指しながら説明します。それでは、はじめましょう。",
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
                  className="w-1 rounded-t bg-teal"
                  style={{ height: `${b}%` }}
                />
                <span
                  className="w-1 rounded-t bg-warn"
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
