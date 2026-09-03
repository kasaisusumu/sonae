"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { usePathname } from "next/navigation";

/**
 * ページ内コーチマーク。
 * そのページに「初めて来たとき」だけ、実際のボタンをハイライトしながら
 * 1 つずつ説明する。スライド形式のチュートリアル（<Tutorial />）を補完する。
 * 表示済みかどうかはページごとに localStorage で覚える。
 */

type Step = { sel: string; title: string; body: string };
type Tour = { key: string; match: (path: string) => boolean; steps: Step[] };

const FLAG_PREFIX = "mm_coach_";

const TOURS: Tour[] = [
  {
    key: "home_v5",
    match: (p) => p === "/",
    steps: [
      {
        sel: '[data-coach="menu"]',
        title: "困ったら左上の ☰",
        body: "使い方・チュートリアル・注意・ページ移動は、いつでもここから開けます。",
      },
      {
        sel: '[data-coach="savings"]',
        title: "防げた分の見える化",
        body: "「防げた」と選んだ失敗の推定額の合計です（参考値）。下のグラフは棒をタップで内訳。",
      },
    ],
  },
  {
    key: "events_v3",
    match: (p) => p === "/events",
    steps: [
      {
        sel: '[data-coach="event-card"]',
        title: "予定のカード",
        body: "どこをタップしても準備リストへ。細いバーは準備の進み具合です。",
      },
      {
        sel: '[data-coach="sync"]',
        title: "取り込み",
        body: "普段は自動。すぐ反映したいときだけ「↻ 取り込む」を押してください。",
      },
    ],
  },
  {
    key: "event_v4",
    match: (p) => /^\/events\/[^/]+$/.test(p),
    steps: [
      {
        sel: '[data-coach="checklist"]',
        title: "準備すること・持ち物",
        body: "予定を入れると自動で用意されます。用意できたら左のチェックを付けるだけ。",
      },
      {
        sel: '[data-coach="item-expand"]',
        title: "∨ で項目の詳細",
        body: "その項目だけの通知タイミング・メモ・リンク・写真を設定できます。",
      },
      {
        sel: '[data-coach="add-item"]',
        title: "直すと賢くなる",
        body: "いる／いらないを直す・足すと、次の似た予定から反映されます。増えすぎることはありません。",
      },
    ],
  },
  {
    key: "failures_v2",
    match: (p) => p === "/failures",
    steps: [
      {
        sel: '[data-coach="fail-new"]',
        title: "うっかりを記録する",
        body: "「何が起きたか」だけでOK。金額は空で大丈夫。予定に紐づけると先回りできます。",
      },
      {
        sel: '[data-coach="fail-list"]',
        title: "防げた／防げなかった",
        body: "結果を選べます。「防げた」にしたものだけ、ホームの節約額に積み上がります。",
      },
    ],
  },
  {
    key: "savings_v4",
    match: (p) => p === "/savings",
    steps: [
      {
        sel: '[data-coach="learning-search"]',
        title: "横断検索",
        body: "自動で覚えた内容と、名前を付けたテンプレートを、まとめて探せます。",
      },
      {
        sel: '[data-coach="learning-tabs"]',
        title: "学習内容 / テンプレート",
        body: "左：自動で覚えたこと。右：あなたが名前を付けて保存したセット。",
      },
      {
        sel: '[data-coach="learning-tree"]',
        title: "予定名の樹形図",
        body: "各予定を開くと、その時どんなリストになるかを確認・その場で編集できます。",
      },
    ],
  },
  {
    key: "settings_v5",
    match: (p) => p === "/settings",
    steps: [
      {
        sel: '[data-coach="menu"]',
        title: "困ったら左上の ☰",
        body: "使い方・チュートリアル・注意・ページ移動は、いつでもここから。",
      },
      {
        sel: '[data-coach="settings-google"]',
        title: "カレンダー連携",
        body: "同期するカレンダーの選択、再接続、解除。解除しても予定と学習内容は残ります。",
      },
      {
        sel: '[data-coach="settings-desc"]',
        title: "説明欄への書き込み",
        body: "予定の説明欄に準備リストを追記します（日時・タイトルは変えません）。既定はオン。ここでオフにできます。",
      },
    ],
  },
];

type Rect = { top: number; left: number; width: number; height: number };

function readFlag(key: string): boolean {
  try {
    return localStorage.getItem(FLAG_PREFIX + key) != null;
  } catch {
    return true; // localStorage 不可なら出さない
  }
}
function writeFlag(key: string) {
  try {
    localStorage.setItem(FLAG_PREFIX + key, "done");
  } catch {
    /* ignore */
  }
}

export function PageCoach({
  tutorialDone = false,
}: {
  tutorialDone?: boolean;
}) {
  const pathname = usePathname();
  const [tour, setTour] = useState<Tour | null>(null);
  const [idx, setIdx] = useState(0);
  const [rect, setRect] = useState<Rect | null>(null);
  const [nudge, setNudge] = useState(false);
  const rectRef = useRef<Rect | null>(null);

  const applyRect = useCallback((r: Rect | null) => {
    const prev = rectRef.current;
    if (
      prev === r ||
      (prev &&
        r &&
        Math.abs(prev.top - r.top) < 0.5 &&
        Math.abs(prev.left - r.left) < 0.5 &&
        Math.abs(prev.width - r.width) < 0.5 &&
        Math.abs(prev.height - r.height) < 0.5)
    ) {
      return;
    }
    rectRef.current = r;
    setRect(r);
  }, []);

  // パスが変わったら、そのページのツアーを（未表示なら）仕込む
  useEffect(() => {
    let cancelled = false;
    const t = TOURS.find((x) => x.match(pathname)) ?? null;

    // まず今の表示をリセット（effect 内の同期 setState を避けてマイクロタスクで）
    queueMicrotask(() => {
      if (cancelled) return;
      rectRef.current = null;
      setRect(null);
      setIdx(0);
      setTour(null);
      setNudge(false);
    });

    if (!t || readFlag(t.key)) {
      return () => {
        cancelled = true;
      };
    }

    // 導入チュートリアルが完全に終わってから開始する。
    // 終わっていない（サーバー側フラグも localStorage も無い）なら、代わりに
    // 「先にチュートリアルを見て」の誘導ポップアップを出す。
    const introDone = () => {
      try {
        return tutorialDone || localStorage.getItem("mm_tutorial_v3") != null;
      } catch {
        return tutorialDone;
      }
    };
    const anotherPopup = () =>
      !!document.querySelector(
        "[data-mm-tutorial],[data-mm-guided],[data-mm-firstseen],[data-mm-prevent-goals]",
      );

    const start = () => {
      if (cancelled) return;
      if (!introDone()) {
        // チュートリアル自体が出ている間は何もしない（あとで再判定）
        if (document.querySelector("[data-mm-tutorial]")) {
          window.setTimeout(start, 500);
          return;
        }
        try {
          if (sessionStorage.getItem("mm_coach_nudge_v1")) return;
        } catch {
          /* ignore */
        }
        setNudge(true);
        return;
      }
      if (anotherPopup()) {
        window.setTimeout(start, 400);
        return;
      }
      setTour(t);
    };
    const timer = window.setTimeout(start, 600);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [pathname, tutorialDone]);

  // メニューの「このページの使い方をみる」から手動で開始する。
  // このページにツアーが無ければ何もしない。
  useEffect(() => {
    const onOpen = () => {
      const t = TOURS.find((x) => x.match(pathname)) ?? null;
      if (!t) return;
      try {
        localStorage.removeItem(FLAG_PREFIX + t.key);
      } catch {
        /* ignore */
      }
      rectRef.current = null;
      setRect(null);
      setIdx(0);
      setTour(t);
    };
    window.addEventListener("mm:open-coach", onOpen);
    return () => window.removeEventListener("mm:open-coach", onOpen);
  }, [pathname]);

  const finish = useCallback(() => {
    setTour((cur) => {
      if (cur) writeFlag(cur.key);
      return null;
    });
    rectRef.current = null;
    setRect(null);
  }, []);

  const next = useCallback(() => {
    setIdx((i) => {
      const t = tour;
      if (!t) return i;
      if (i + 1 >= t.steps.length) {
        finish();
        return i;
      }
      return i + 1;
    });
  }, [tour, finish]);

  const back = useCallback(() => setIdx((i) => Math.max(0, i - 1)), []);

  // 現在のステップの対象要素を探し、位置を追い続ける
  useEffect(() => {
    if (!tour) return;
    const step = tour.steps[idx];
    if (!step) return;

    let raf = 0;
    let ticks = 0;
    let visible = false;

    const bail = () => {
      if (idx + 1 >= tour.steps.length) finish();
      else setIdx((i) => i + 1);
    };

    const measure = () => {
      const el = document.querySelector<HTMLElement>(step.sel);
      const r = el?.getBoundingClientRect();
      if (el && r && (r.width > 0 || r.height > 0)) {
        if (!visible) {
          visible = true;
          // 背の高い対象は上端を画面上部へ寄せて、説明カードを下に置ける余白を作る。
          // 小さい対象は動きすぎないよう nearest。
          const tall = r.height > window.innerHeight * 0.5;
          el.scrollIntoView({
            block: tall ? "start" : "nearest",
            behavior: "smooth",
          });
        }
        const pad = 6;
        applyRect({
          top: r.top - pad,
          left: r.left - pad,
          width: r.width + pad * 2,
          height: r.height + pad * 2,
        });
      } else if (!visible) {
        applyRect(null);
      }
      raf = window.requestAnimationFrame(() => {
        // 対象が一定時間見えなければ（未描画・非表示）その step は飛ばす
        if (!visible) {
          ticks += 1;
          if (ticks > 360) {
            // ≒ 6 秒
            bail();
            return;
          }
        }
        measure();
      });
    };
    measure();

    const onScroll = () => {
      const el = document.querySelector<HTMLElement>(step.sel);
      if (!el) return;
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) return;
      const pad = 6;
      applyRect({
        top: r.top - pad,
        left: r.left - pad,
        width: r.width + pad * 2,
        height: r.height + pad * 2,
      });
    };
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);
    return () => {
      window.cancelAnimationFrame(raf);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
    };
  }, [tour, idx, finish, applyRect]);

  // Esc で終了
  useEffect(() => {
    if (!tour) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") finish();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [tour, finish]);

  // ツアーの状態を全体に知らせる（各画面が「例」の仮表示を出し入れするため）。
  // step が進むたびにも投げ直す＝Suspense で遅れて出てきた画面にも届く。
  useEffect(() => {
    window.dispatchEvent(
      new CustomEvent("mm:coach", { detail: { active: !!tour } }),
    );
  }, [tour, idx]);

  // 導入チュートリアル未完了の誘導ポップアップ
  if (nudge && !tour) {
    return (
      <div
        data-mm-coach
        className="fixed inset-0 z-[57] flex items-center justify-center bg-black/50 p-4"
      >
        <div className="w-full max-w-sm rounded-2xl bg-surface p-6 shadow-2xl">
          <h2 className="text-base font-semibold text-foreground">
            先に「アプリの使い方」を見てみませんか？
          </h2>
          <p className="mt-2 text-sm text-muted">
            最初にアプリ全体のチュートリアルを見ておくと、各ページの案内もスムーズです。
          </p>
          <div className="mt-5 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                try {
                  sessionStorage.setItem("mm_coach_nudge_v1", "1");
                } catch {
                  /* ignore */
                }
                setNudge(false);
              }}
              className="rounded-lg border border-border px-3 py-1.5 text-sm text-muted hover:border-foreground/40"
            >
              あとで
            </button>
            <button
              type="button"
              onClick={() => {
                window.dispatchEvent(new Event("mm:open-tutorial"));
                setNudge(false);
              }}
              className="rounded-lg bg-foreground px-4 py-1.5 text-sm font-medium text-surface hover:opacity-90"
            >
              使い方を見る
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!tour || !rect) return null;

  const step = tour.steps[idx];
  const vh = typeof window !== "undefined" ? window.innerHeight : 800;
  const vw = typeof window !== "undefined" ? window.innerWidth : 400;

  // ── 説明カードは画面内に収め、かつハイライトと重ねない ──
  const M = 12; // 画面端の余白
  const GAP = 10; // ハイライトとカードの間隔
  const tipW = Math.min(340, vw - M * 2);
  const budget = Math.max(120, Math.min(300, vh - M * 2)); // 理想の高さ

  // 対象のうち「画面内に見えている範囲」を基準にする（rect.top が負でも安全）
  const visTop = Math.max(rect.top, M);
  const visBottom = Math.min(rect.top + rect.height, vh - M);

  // ハイライトの上／下に空いている高さ
  const gapBelow = Math.max(0, vh - M - visBottom - GAP);
  const gapAbove = Math.max(0, visTop - M - GAP);
  const MIN_CARD = 92;

  let tipTop: number;
  let cardH: number;
  if (gapBelow >= gapAbove) {
    cardH = Math.max(MIN_CARD, Math.min(budget, gapBelow));
    tipTop = visBottom + GAP;
  } else {
    cardH = Math.max(MIN_CARD, Math.min(budget, gapAbove));
    tipTop = visTop - GAP - cardH;
  }
  // 画面内にクランプ（重なりを増やさない範囲で）
  tipTop = Math.max(M, Math.min(tipTop, vh - M - cardH));

  const tipLeft = Math.max(M, Math.min(rect.left, vw - tipW - M));
  const tipStyle: CSSProperties = {
    top: tipTop,
    left: tipLeft,
    width: tipW,
    maxHeight: cardH,
  };

  const last = idx === tour.steps.length - 1;

  return (
    <div data-mm-coach className="fixed inset-0 z-[55]" aria-live="polite">
      {/* クリックを吸収する層（どこを押しても次へ） */}
      <div className="absolute inset-0" onClick={next} />

      {/* スポットライト（周囲を暗く／対象を縁取り）。
          対象が白いカードでも埋もれないよう「白い縁 → 濃い区切り → 減光」の三重に。 */}
      <div
        className="pointer-events-none absolute rounded-xl transition-all duration-200"
        style={{
          top: rect.top,
          left: rect.left,
          width: rect.width,
          height: rect.height,
          boxShadow:
            "0 0 0 3px #ffffff, 0 0 0 6px rgba(0,0,0,0.85), 0 0 0 9999px rgba(0,0,0,0.66)",
        }}
      />

      {/* 説明カード（画面内に収まるよう clamp・長い本文は内部スクロール）。
          ハイライト（明るい実画面）と区別できるよう、あえて濃い面にする。 */}
      <div
        className="absolute flex flex-col rounded-2xl bg-foreground p-4 text-surface shadow-2xl ring-1 ring-white/15"
        style={tipStyle}
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="shrink-0 text-sm font-semibold text-surface">
          {step.title}
        </h3>
        <p className="mt-1 min-h-0 flex-1 overflow-y-auto text-[13px] leading-relaxed text-surface/85">
          {step.body}
        </p>
        <div className="mt-3 flex shrink-0 items-center justify-between">
          <button
            type="button"
            onClick={finish}
            className="text-[11px] text-surface/55 hover:text-surface"
          >
            スキップ
          </button>
          <div className="flex items-center gap-2">
            <span className="text-[11px] tabular-nums text-surface/55">
              {idx + 1}/{tour.steps.length}
            </span>
            {idx > 0 && (
              <button
                type="button"
                onClick={back}
                className="rounded-lg border border-surface/30 px-2.5 py-1 text-xs text-surface/80 hover:border-surface/60"
              >
                戻る
              </button>
            )}
            <button
              type="button"
              onClick={next}
              className="rounded-lg bg-surface px-3 py-1 text-xs font-medium text-foreground hover:opacity-90"
            >
              {last ? "おわり" : "次へ"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
