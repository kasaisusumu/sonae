"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useTransition,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import { reorderChecklistSections } from "@/app/actions";
import { SectionControls } from "./section-manager";

export type SectionEntry = {
  key: string;
  label: string;
  builtin: boolean;
  node: ReactNode;
};

/**
 * 予定ごとに「準備すること」「持ち物」などの枠の順番を入れ替える。
 * - 上部の「並べ替え」バーを掴んでドラッグ（マウスでもタッチでも動く Pointer Events）
 * - ▲▼ ボタンでも 1 つずつ移動（確実）
 * 並べ替えたら Event.sectionOrder に保存し、カレンダーの説明欄にも反映する。
 */
export function SectionList({
  eventId,
  entries,
}: {
  eventId: string;
  entries: SectionEntry[];
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();

  // props（サーバの並び）が変わったらローカルも合わせる（レンダー中の同期）。
  const propOrder = entries.map((e) => e.key).join("");
  const [order, setOrder] = useState<string[]>(() => entries.map((e) => e.key));
  const [syncedProp, setSyncedProp] = useState(propOrder);
  if (propOrder !== syncedProp) {
    setSyncedProp(propOrder);
    setOrder(entries.map((e) => e.key));
  }

  const byKey = new Map(entries.map((e) => [e.key, e]));
  const rowRefs = useRef<Map<string, HTMLElement>>(new Map());
  const setRowRef = useCallback((key: string, el: HTMLElement | null) => {
    if (el) rowRefs.current.set(key, el);
    else rowRefs.current.delete(key);
  }, []);

  const [dragKey, setDragKey] = useState<string | null>(null);
  const orderRef = useRef(order);
  useEffect(() => {
    orderRef.current = order;
  }, [order]);
  const dirtyRef = useRef(false);

  // 長押しで初めて「持ち上がる」。押してすぐ動かした＝スクロール意図なのでドラッグしない。
  const LONG_PRESS_MS = 320;
  const CANCEL_MOVE_PX = 8;
  const pressRef = useRef<{
    key: string;
    el: HTMLElement;
    pid: number;
    x: number;
    y: number;
    timer: number;
  } | null>(null);

  const clearPress = () => {
    if (pressRef.current) {
      window.clearTimeout(pressRef.current.timer);
      pressRef.current = null;
    }
  };
  useEffect(() => clearPress, []);

  function persist(next: string[]) {
    startTransition(async () => {
      await reorderChecklistSections({ eventId, order: next });
      router.refresh();
    });
  }

  function nudge(key: string, dir: -1 | 1) {
    const cur = [...order];
    const i = cur.indexOf(key);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= cur.length) return;
    [cur[i], cur[j]] = [cur[j], cur[i]];
    setOrder(cur);
    persist(cur);
  }

  // ── Pointer ドラッグ（マウス／タッチ共通）──
  function onHandleDown(key: string, e: ReactPointerEvent<HTMLDivElement>) {
    // ボタン類の上から始めたときはドラッグしない
    if ((e.target as HTMLElement).closest("button,a,input,select,textarea")) {
      return;
    }
    // ここでは preventDefault しない＝待っているあいだは普通にスクロールできる。
    const el = e.currentTarget as HTMLElement;
    const pid = e.pointerId;
    const timer = window.setTimeout(() => {
      // 長押し成立：ここで初めて持ち上げる
      pressRef.current = null;
      dirtyRef.current = false;
      el.setPointerCapture?.(pid);
      setDragKey(key);
      try {
        navigator.vibrate?.(12);
      } catch {
        /* 未対応環境は無視 */
      }
    }, LONG_PRESS_MS);
    pressRef.current = { key, el, pid, x: e.clientX, y: e.clientY, timer };
  }

  function onHandleMove(e: ReactPointerEvent<HTMLDivElement>) {
    // まだ持ち上がっていない：少しでも動いたら「スクロール」と判断して長押しを中止
    if (!dragKey) {
      const p = pressRef.current;
      if (p) {
        const moved = Math.hypot(e.clientX - p.x, e.clientY - p.y);
        if (moved > CANCEL_MOVE_PX) clearPress();
      }
      return;
    }
    e.preventDefault();
    const y = e.clientY;
    const cur = orderRef.current;
    let targetIdx = cur.length - 1;
    for (let i = 0; i < cur.length; i++) {
      const el = rowRefs.current.get(cur[i]);
      if (!el) continue;
      const r = el.getBoundingClientRect();
      if (y < r.top + r.height / 2) {
        targetIdx = i;
        break;
      }
    }
    const from = cur.indexOf(dragKey);
    if (from < 0 || targetIdx === from) return;
    const next = [...cur];
    next.splice(from, 1);
    next.splice(targetIdx, 0, dragKey);
    orderRef.current = next; // 次の move で即座に最新を読めるように
    dirtyRef.current = true;
    setOrder(next);
  }

  function onHandleUp(e: ReactPointerEvent<HTMLDivElement>) {
    clearPress(); // 長押し待ち中に指を離した／キャンセルされた
    if (!dragKey) return;
    (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
    const wasDirty = dirtyRef.current;
    dirtyRef.current = false;
    setDragKey(null);
    if (wasDirty) persist(orderRef.current);
  }

  return (
    <div className="space-y-3">
      {order.map((key, idx) => {
        const e = byKey.get(key);
        if (!e) return null;
        const dragging = dragKey === key;
        return (
          <div
            key={key}
            ref={(el) => setRowRef(key, el)}
            className={`space-y-1.5 rounded-xl transition-shadow ${
              dragging
                ? "opacity-80 shadow-lg ring-2 ring-teal/50"
                : dragKey
                  ? "opacity-95"
                  : ""
            }`}
          >
            <div
              onPointerDown={(ev) => onHandleDown(key, ev)}
              onPointerMove={onHandleMove}
              onPointerUp={onHandleUp}
              onPointerCancel={onHandleUp}
              // 持ち上がるまではスクロールできるよう pan-y。持ち上がったら none。
              style={{ touchAction: dragging ? "none" : "pan-y" }}
              className={`flex items-center gap-2 rounded-lg px-1 py-1.5 text-[11px] text-muted select-none ${
                dragging
                  ? "cursor-grabbing bg-surface-muted"
                  : "cursor-grab hover:bg-surface-muted"
              }`}
            >
              <span className="text-sm leading-none">⠿</span>
              <span>{dragging ? "ドラッグ中…" : "長押しして並べ替え"}</span>

              <div className="ml-auto flex items-center gap-1">
                <button
                  type="button"
                  aria-label="上へ"
                  disabled={idx === 0}
                  onClick={() => nudge(key, -1)}
                  className="rounded border border-border px-1.5 leading-none text-muted hover:border-teal hover:text-teal-dark disabled:opacity-30"
                >
                  ▲
                </button>
                <button
                  type="button"
                  aria-label="下へ"
                  disabled={idx === order.length - 1}
                  onClick={() => nudge(key, 1)}
                  className="rounded border border-border px-1.5 leading-none text-muted hover:border-teal hover:text-teal-dark disabled:opacity-30"
                >
                  ▼
                </button>
                {!e.builtin && (
                  <span className="ml-1">
                    <SectionControls eventId={eventId} sectionKey={key} />
                  </span>
                )}
              </div>
            </div>

            {e.node}
          </div>
        );
      })}
    </div>
  );
}
