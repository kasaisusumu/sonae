"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { usePathname } from "next/navigation";
import { Mail, Menu, Mic, Pin, Repeat, Tag } from "lucide-react";
import { trackFeatureUse } from "@/app/actions";

/**
 * ページ内コーチマーク。
 * そのページに「初めて来たとき」だけ、実際のボタンをハイライトしながら
 * 1 つずつ説明する。スライド形式のチュートリアル（<Tutorial />）を補完する。
 * 表示済みかどうかはページごとに localStorage で覚える。
 */

type Step = {
  sel: string;
  title: ReactNode;
  body: string;
  /** trueなら ver2（テスト版モード）のときだけ出す（該当要素はver1には存在しない）。 */
  testOnly?: boolean;
};
type Tour = {
  key: string;
  match: (path: string) => boolean;
  steps: Step[];
  /**
   * false の場合、ページを開いただけでは自動開始しない。"mm:coach-trigger"
   * イベント（detail: { key }）で明示的に呼ばれたときだけ開始する
   * （ユーザー指摘により2026-10-19: 予定詳細のチュートリアルが長すぎたため、
   * 「ページを開いた時」と「初めて項目を追加した時」の2部に分割した）。
   */
  auto?: boolean;
  /**
   * 指定すると、そのモード（ver1=production / ver2=test）のときだけこのツアーを対象にする。
   * 省略時は両モード共通。/failures のように、モードごとに別コンポーネント
   * （data-coach の対象要素）が出るページで使う（同じ path に複数ツアーを出し分ける）。
   */
  modeOnly?: "test" | "production";
};

const FLAG_PREFIX = "mm_coach_";

const TOURS: Tour[] = [
  {
    key: "home_v6",
    match: (p) => p === "/",
    steps: [
      {
        sel: '[data-coach="menu"]',
        title: (
          <>
            困ったら左上の <Menu aria-hidden className="inline h-4 w-4" />
          </>
        ),
        body: "使い方・チュートリアル・注意・ページ移動は、いつでもここから開けます。",
      },
    ],
  },
  {
    // 手動「↻ 取り込む」ボタンを廃止（自動取り込みのみになった）ため、そのステップを削除
    // （2026-10〜）。key を上げて、既に events_v3 を見た人にも更新後のツアーを出す。
    key: "events_v4",
    match: (p) => p === "/events",
    steps: [
      {
        sel: '[data-coach="event-card"]',
        title: "予定のカード",
        body: "どこをタップしても準備リストへ。細いバーは準備の進み具合です。",
      },
    ],
  },
  {
    // 予定詳細を初めて開いたときの案内。1つずつ、他ポップアップと重ねない、
    // 導入チュートリアル完了後に出す（共通ルール）。key を上げると再表示される。
    // event_v8: 「次回の出し方」のステップを追加（ver2だけ。testOnly参照）。
    key: "event_v8",
    match: (p) => /^\/events\/[^/]+$/.test(p),
    steps: [
      {
        sel: '[data-coach="checklist"]',
        title: "これは“たたき台”です",
        body: "予定から自動で用意した準備リスト。ここから、あなたに合わせて直していきます。用意できた項目は左のチェックを付けるだけ。",
      },
      {
        sel: '[data-coach="dictation"]',
        title: "まずは「話して作る」が早い",
        body: "スマホのキーボードのマイクキーで、持ち物や準備を思いつくまま話すだけ。AI が枠に振り分けて追加します。ゼロから打つより速いです。",
      },
      {
        sel: '[data-coach="future-message"]',
        title: (
          <span className="inline-flex items-center gap-1">
            <Mail aria-hidden className="h-4 w-4" />
            過去の自分よりメッセージ
          </span>
        ),
        body: "いつか思い出したいことを書いておくと、次に似た予定が入ったときに知らせます。",
        // ver1（本番版）はこの枠の代わりに「考えられる失敗」が出るため対象が無い
        // （2026-10-19修正。以前は testOnly が無く、本番版でこの1ステップだけ
        // 対象が見つからず無駄に待ってから飛ばされていた）。
        testOnly: true,
      },
    ],
  },
  {
    // 予定詳細のチュートリアルの後半（長すぎたため2部に分割、2026-10-19〜）。
    // ページを開いただけでは出さず、項目を初めて自分で追加したときに
    // checklist-editor.tsx から "mm:coach-trigger" イベントで呼ばれる（auto: false）。
    key: "event_item_v1",
    match: (p) => /^\/events\/[^/]+$/.test(p),
    auto: false,
    steps: [
      {
        sel: '[data-coach="item-expand"]',
        title: "∨ で項目の詳細",
        body: "その項目だけの通知タイミング・メモ・リンク・写真を設定できます。",
      },
      {
        sel: '[data-coach="item-scope"]',
        title: (
          <span className="inline-flex items-center gap-1">
            <Pin aria-hidden className="h-3.5 w-3.5" />
            <Repeat aria-hidden className="h-3.5 w-3.5" />
            <Tag aria-hidden className="h-3.5 w-3.5" />
            次回の出し方
          </span>
        ),
        body: "この項目を次も出すかを選べます。今回だけ／似た予定（用途が同じ予定にもAIが判断して出す）／この名前（予定名からキーワードを決め、そのキーワードを含む予定にだけ出す）。タップで選び直せます。",
        testOnly: true,
      },
      {
        sel: '[data-coach="add-item"]',
        title: "直すほど、あなた仕様に",
        body: "いる／いらないを直す・足すと学習して、次から似た予定で似たリストを最初から出します。増えすぎることはありません。",
      },
    ],
  },
  {
    // ver2（テスト版）の /failures（未来の自分へ）。本番版は別コンポーネント
    // （対象要素が異なる）なので modeOnly で出し分ける（以前はここが無く、
    // 本番版で対象要素が見つからずツアーが空振りしていた不具合。2026-10-19修正）。
    key: "messages_v1",
    match: (p) => p === "/failures",
    modeOnly: "test",
    steps: [
      {
        sel: '[data-coach="message-new"]',
        title: "メッセージを書く",
        body: "予定が未定でも書けます。キーワード・ジャンルが一致する予定が入ったとき、自動で知らせます。",
      },
      {
        sel: '[data-coach="message-dictation"]',
        title: (
          <span className="inline-flex items-center gap-1">
            <Mic aria-hidden className="h-4 w-4" />
            声でも記録できます
          </span>
        ),
        body: "話すだけでAIが本文・キーワード・ジャンルをまとめます。マイクキーからどうぞ。",
      },
      {
        sel: '[data-coach="message-list"]',
        title: "登録した内容を確認・編集",
        body: "いつでも直したり、過去に移したり、削除したりできます。",
      },
    ],
  },
  {
    // ver1（本番版）の /failures（失敗ログ）。message-new 等の test 版と対になる、
    // fail-new 等の要素を対象にする（2026-10-19追加。この組が無かったため本番版では
    // 空振りしていた）。
    key: "failures_prod_v1",
    match: (p) => p === "/failures",
    modeOnly: "production",
    steps: [
      {
        sel: '[data-coach="fail-new"]',
        title: "ひとこと記録する",
        body: "必須は「何が起きたか」だけ。予定を選べばその予定に、選ばなければカテゴリ全体の記録になります。",
      },
      {
        sel: '[data-coach="fail-dictation"]',
        title: (
          <span className="inline-flex items-center gap-1">
            <Mic aria-hidden className="h-4 w-4" />
            声でも記録できます
          </span>
        ),
        body: "話すだけでAIが内容・対策を整えます。マイクキーからどうぞ。",
      },
      {
        sel: '[data-coach="fail-list"]',
        title: "登録した内容を確認・編集",
        body: "これからの失敗予測・過去の振り返り・予定に紐づかない記録を、分けて確認できます。",
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
        body: "自動で覚えた内容と、名前を付けたマニュアルを、まとめて探せます。",
      },
      {
        sel: '[data-coach="learning-tabs"]',
        title: "学習内容 / マニュアル",
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
        title: (
          <>
            困ったら左上の <Menu aria-hidden className="inline h-4 w-4" />
          </>
        ),
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

/** ver1（本番モード）では testOnly のステップ（対象要素がver1に無い）を除く。 */
function filterTourForMode(t: Tour, isProductionMode: boolean): Tour {
  if (!isProductionMode) return t;
  return { ...t, steps: t.steps.filter((s) => !s.testOnly) };
}

/** modeOnly が指定されたツアーは、該当するモードのときだけ対象にする。 */
function matchesMode(t: Tour, isProductionMode: boolean): boolean {
  if (!t.modeOnly) return true;
  return t.modeOnly === (isProductionMode ? "production" : "test");
}

export function PageCoach({
  tutorialDone = false,
  isProductionMode = false,
}: {
  tutorialDone?: boolean;
  /** ver1（本番の機能モード）かどうか。testOnly なステップを出し分けるために使う。 */
  isProductionMode?: boolean;
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
  // auto: false のツアーはここでは拾わない（明示的なトリガーでのみ開始）。
  useEffect(() => {
    let cancelled = false;
    const found =
      TOURS.find(
        (x) => x.auto !== false && x.match(pathname) && matchesMode(x, isProductionMode),
      ) ?? null;
    const t = found ? filterTourForMode(found, isProductionMode) : null;

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
        "[data-mm-tutorial],[data-mm-guided],[data-mm-firstseen],[data-mm-desclink],[data-mm-scopehint]",
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
      void trackFeatureUse(`popup:coach:${t.key}:shown`);
    };
    const timer = window.setTimeout(start, 600);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [pathname, tutorialDone, isProductionMode]);

  // メニューの「このページの使い方をみる」から手動で開始する。
  // このページにツアーが無ければ何もしない。
  useEffect(() => {
    const onOpen = () => {
      const found =
        TOURS.find(
          (x) => x.auto !== false && x.match(pathname) && matchesMode(x, isProductionMode),
        ) ?? null;
      const t = found ? filterTourForMode(found, isProductionMode) : null;
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
      void trackFeatureUse(`popup:coach:${t.key}:shown`);
    };
    window.addEventListener("mm:open-coach", onOpen);
    return () => window.removeEventListener("mm:open-coach", onOpen);
  }, [pathname, isProductionMode]);

  // auto: false のツアーを、特定の操作（例: 項目を初めて追加した）から明示的に開始する。
  // window.dispatchEvent(new CustomEvent("mm:coach-trigger", { detail: { key } })) で呼ぶ。
  useEffect(() => {
    let cancelled = false;
    let timer = 0;
    const onTrigger = (e: Event) => {
      const key = (e as CustomEvent<{ key?: string }>).detail?.key;
      const found = key ? TOURS.find((x) => x.key === key) : null;
      const t = found ? filterTourForMode(found, isProductionMode) : null;
      if (!t || t.steps.length === 0 || readFlag(t.key)) return;

      const tryStart = () => {
        if (cancelled) return;
        if (
          document.querySelector(
            "[data-mm-tutorial],[data-mm-guided],[data-mm-firstseen],[data-mm-desclink],[data-mm-scopehint],[data-mm-coach]",
          )
        ) {
          timer = window.setTimeout(tryStart, 400);
          return;
        }
        rectRef.current = null;
        setRect(null);
        setIdx(0);
        setTour(t);
        void trackFeatureUse(`popup:coach:${t.key}:shown`);
      };
      tryStart();
    };
    window.addEventListener("mm:coach-trigger", onTrigger);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      window.removeEventListener("mm:coach-trigger", onTrigger);
    };
  }, [isProductionMode]);

  const finish = useCallback((skipped: boolean) => {
    setTour((cur) => {
      if (cur) {
        writeFlag(cur.key);
        void trackFeatureUse(`popup:coach:${cur.key}:${skipped ? "skip" : "complete"}`);
      }
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
        finish(false);
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
      if (idx + 1 >= tour.steps.length) finish(false);
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
      if (e.key === "Escape") finish(true);
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
            onClick={() => finish(true)}
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
