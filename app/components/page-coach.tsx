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
    key: "home_v2",
    match: (p) => p === "/",
    steps: [
      {
        sel: '[data-coach="how-to"]',
        title: "まずはここ",
        body: "アプリ全体の流れを、いつでもここで見返せます。",
      },
      {
        sel: '[data-coach="savings"]',
        title: "節約額のダッシュボード",
        body: "「防げた」失敗の推定額が、ここに積み上がっていきます。",
      },
      {
        sel: '[data-coach="bottom-nav"]',
        title: "画面の切り替え",
        body: "予定・失敗ログ・学習・設定は、この下のバーから移動します。",
      },
    ],
  },
  {
    key: "event_v2",
    match: (p) => /^\/events\/[^/]+$/.test(p),
    steps: [
      {
        sel: '[data-coach="failure-suggest"]',
        title: "こんな失敗もあり得ます",
        body: "似た予定で起きた失敗を先回りで出します。関係なければ「今回は関係ない」で消せます。",
      },
      {
        sel: '[data-coach="checklist"]',
        title: "準備すること・持ち物",
        body: "用意できたらチェック。文言の変更・追加・削除は自動保存され、次の似た予定から学習されます。",
      },
      {
        sel: '[data-coach="item-expand"]',
        title: "この「く」で詳細",
        body: "開くと通知タイミングとメモを設定できます。もう一度押すと閉じます。",
      },
      {
        sel: '[data-coach="add-section"]',
        title: "枠を増やせます",
        body: "「買うもの」など独自の枠を追加できます。カレンダーの説明欄と学習ページにもそのまま反映されます。",
      },
      {
        sel: '[data-coach="regen"]',
        title: "作り直す",
        body: "AI で準備すること・持ち物を作り直します（あなたが足した枠は残ります）。",
      },
    ],
  },
  {
    key: "savings_v2",
    match: (p) => p === "/savings",
    steps: [
      {
        sel: '[data-coach="learning-search"]',
        title: "横断検索",
        body: "自動で覚えた学習内容と、名前を付けたテンプレートをまとめて探せます。",
      },
      {
        sel: '[data-coach="learning-tabs"]',
        title: "学習内容 / テンプレート",
        body: "自動で覚えた内容と、保存したテンプレートをここで切り替えます。",
      },
    ],
  },
  {
    key: "settings_v2",
    match: (p) => p === "/settings",
    steps: [
      {
        sel: '[data-coach="replay-tutorial"]',
        title: "チュートリアル",
        body: "最初の説明をいつでも見返せます。困ったらここへ。",
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

export function PageCoach() {
  const pathname = usePathname();
  const [tour, setTour] = useState<Tour | null>(null);
  const [idx, setIdx] = useState(0);
  const [rect, setRect] = useState<Rect | null>(null);
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
    });

    if (!t || readFlag(t.key)) {
      return () => {
        cancelled = true;
      };
    }

    // スライド式チュートリアルが閉じるのを待ってから開始
    //（Suspense のストリーミング描画を少し待つ意味も兼ねる）
    const start = () => {
      if (cancelled) return;
      if (document.querySelector("[data-mm-tutorial]")) {
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
          el.scrollIntoView({ block: "center", behavior: "smooth" });
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

  if (!tour || !rect) return null;

  const step = tour.steps[idx];
  const vh = typeof window !== "undefined" ? window.innerHeight : 800;
  const vw = typeof window !== "undefined" ? window.innerWidth : 400;
  const tipW = Math.min(320, vw - 24);
  const spaceBelow = vh - (rect.top + rect.height);
  const placeBelow = spaceBelow > 210 || rect.top < 150;
  const tipLeft = Math.max(12, Math.min(rect.left, vw - tipW - 12));
  const tipStyle: CSSProperties = placeBelow
    ? { top: rect.top + rect.height + 12, left: tipLeft, width: tipW }
    : { bottom: vh - rect.top + 12, left: tipLeft, width: tipW };

  const last = idx === tour.steps.length - 1;

  return (
    <div className="fixed inset-0 z-[55]" aria-live="polite">
      {/* クリックを吸収する層（どこを押しても次へ） */}
      <div className="absolute inset-0" onClick={next} />

      {/* スポットライト（周囲を暗く／対象を縁取り） */}
      <div
        className="pointer-events-none absolute rounded-xl border-2 border-teal transition-all duration-200"
        style={{
          top: rect.top,
          left: rect.left,
          width: rect.width,
          height: rect.height,
          boxShadow: "0 0 0 9999px rgba(0,0,0,0.55)",
        }}
      />

      {/* 説明カード */}
      <div
        className="absolute rounded-2xl bg-surface p-4 shadow-2xl"
        style={tipStyle}
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-sm font-semibold text-foreground">{step.title}</h3>
        <p className="mt-1 text-[13px] leading-relaxed text-muted">
          {step.body}
        </p>
        <div className="mt-3 flex items-center justify-between">
          <button
            type="button"
            onClick={finish}
            className="text-[11px] text-muted hover:text-foreground"
          >
            スキップ
          </button>
          <div className="flex items-center gap-2">
            <span className="text-[11px] tabular-nums text-muted">
              {idx + 1}/{tour.steps.length}
            </span>
            {idx > 0 && (
              <button
                type="button"
                onClick={back}
                className="rounded-lg border border-border px-2.5 py-1 text-xs text-muted hover:border-foreground/40"
              >
                戻る
              </button>
            )}
            <button
              type="button"
              onClick={next}
              className="rounded-lg bg-teal px-3 py-1 text-xs font-medium text-white hover:bg-teal-dark"
            >
              {last ? "おわり" : "次へ"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
