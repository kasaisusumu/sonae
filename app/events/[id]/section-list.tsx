"use client";

import { useRef, useState, useTransition, type ReactNode } from "react";
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
 * ドラッグ&ドロップ（PC）と ▲▼ ボタン（スマホでも確実）に対応。
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
  const dragKey = useRef<string | null>(null);
  const [overKey, setOverKey] = useState<string | null>(null);

  // props（サーバの並び）が変わったらローカルも合わせる（レンダー中の同期）。
  const propOrder = entries.map((e) => e.key).join("");
  const [order, setOrder] = useState<string[]>(() => entries.map((e) => e.key));
  const [syncedProp, setSyncedProp] = useState(propOrder);
  if (propOrder !== syncedProp) {
    setSyncedProp(propOrder);
    setOrder(entries.map((e) => e.key));
  }

  const byKey = new Map(entries.map((e) => [e.key, e]));

  function commit(next: string[]) {
    setOrder(next);
    startTransition(async () => {
      await reorderChecklistSections({ eventId, order: next });
      router.refresh();
    });
  }

  function moveTo(from: string, to: string) {
    if (from === to) return;
    const cur = [...order];
    const fi = cur.indexOf(from);
    const ti = cur.indexOf(to);
    if (fi < 0 || ti < 0) return;
    cur.splice(fi, 1);
    cur.splice(ti, 0, from);
    commit(cur);
  }

  function nudge(key: string, dir: -1 | 1) {
    const cur = [...order];
    const i = cur.indexOf(key);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= cur.length) return;
    [cur[i], cur[j]] = [cur[j], cur[i]];
    commit(cur);
  }

  return (
    <div className="space-y-3">
      {order.map((key, idx) => {
        const e = byKey.get(key);
        if (!e) return null;
        return (
          <div
            key={key}
            onDragOver={(ev) => {
              ev.preventDefault();
              if (overKey !== key) setOverKey(key);
            }}
            onDragLeave={() => setOverKey((k) => (k === key ? null : k))}
            onDrop={(ev) => {
              ev.preventDefault();
              const from = dragKey.current;
              setOverKey(null);
              dragKey.current = null;
              if (from) moveTo(from, key);
            }}
            className={`space-y-1.5 rounded-xl ${
              overKey === key ? "outline outline-2 outline-teal/50" : ""
            }`}
          >
            <div className="flex items-center gap-2 text-[11px] text-muted">
              <span
                draggable
                onDragStart={(ev) => {
                  dragKey.current = key;
                  ev.dataTransfer.effectAllowed = "move";
                }}
                onDragEnd={() => {
                  dragKey.current = null;
                  setOverKey(null);
                }}
                title={`「${e.label}」をドラッグで並べ替え`}
                className="cursor-grab select-none rounded px-1 text-sm leading-none text-muted hover:bg-surface-muted hover:text-foreground active:cursor-grabbing"
              >
                ⠿
              </span>

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
