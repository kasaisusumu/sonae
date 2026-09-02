"use client";

import { useState, useTransition, type ReactNode } from "react";
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
 * 並べ替えは ▲▼ ボタンのみ（ドラッグは誤操作が多いのでやめた）。
 * 変更したら Event.sectionOrder に保存し、カレンダーの説明欄にも反映する。
 */
export function SectionList({
  eventId,
  entries,
}: {
  eventId: string;
  entries: SectionEntry[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  // props（サーバの並び）が変わったらローカルも合わせる（レンダー中の同期）。
  const propOrder = entries.map((e) => e.key).join("");
  const [order, setOrder] = useState<string[]>(() => entries.map((e) => e.key));
  const [syncedProp, setSyncedProp] = useState(propOrder);
  if (propOrder !== syncedProp) {
    setSyncedProp(propOrder);
    setOrder(entries.map((e) => e.key));
  }

  const byKey = new Map(entries.map((e) => [e.key, e]));

  function nudge(key: string, dir: -1 | 1) {
    const cur = [...order];
    const i = cur.indexOf(key);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= cur.length) return;
    [cur[i], cur[j]] = [cur[j], cur[i]];
    setOrder(cur);
    startTransition(async () => {
      await reorderChecklistSections({ eventId, order: cur });
      router.refresh();
    });
  }

  return (
    <div className="space-y-3">
      {order.map((key, idx) => {
        const e = byKey.get(key);
        if (!e) return null;
        return (
          <div key={key} className="space-y-1.5">
            <div className="flex items-center gap-2 px-1 text-[11px] text-muted">
              <span>並び順</span>
              <div className="ml-auto flex items-center gap-1">
                <button
                  type="button"
                  aria-label="上へ"
                  disabled={idx === 0 || pending}
                  onClick={() => nudge(key, -1)}
                  className="rounded border border-border px-2 py-0.5 leading-none text-muted hover:border-foreground/40 hover:text-foreground disabled:opacity-30"
                >
                  ▲
                </button>
                <button
                  type="button"
                  aria-label="下へ"
                  disabled={idx === order.length - 1 || pending}
                  onClick={() => nudge(key, 1)}
                  className="rounded border border-border px-2 py-0.5 leading-none text-muted hover:border-foreground/40 hover:text-foreground disabled:opacity-30"
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
