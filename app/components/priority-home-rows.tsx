"use client";

import { useState } from "react";
import Link from "next/link";
import {
  toggleChecklistItemDone,
  toggleFutureMessageDoneAction,
  trackFeatureUse,
} from "@/app/actions";
import { formatDateShort } from "@/lib/format";

export interface HomePriorityRowData {
  key: string;
  title: string;
  eventId: string;
  eventTitle: string;
  eventDate: string; // ISO
  isPast: boolean;
  isMessage: boolean;
  toggleId: string;
}

/**
 * ホームの「急ぎ」「そのうち」一覧。チェックすると予定詳細と同じ isDone に反映される
 * （準備リスト項目は toggleChecklistItemDone、未来の自分へは toggleFutureMessageDoneAction）。
 * チェックした瞬間に行を消さない（指の下で消える・並び替わるのを避ける。ユーザー指摘の
 * 既存ルールと同じ）。完了は次にこのページを開いたときに一覧から外れる。
 */
export function HomePriorityRows({ rows }: { rows: HomePriorityRowData[] }) {
  const [doneOverride, setDoneOverride] = useState<Record<string, boolean>>({});

  function toggle(r: HomePriorityRowData, next: boolean) {
    setDoneOverride((prev) => ({ ...prev, [r.key]: next }));
    void trackFeatureUse("feature:home-item-check");
    if (r.isMessage) {
      void toggleFutureMessageDoneAction(r.toggleId, next);
    } else {
      void toggleChecklistItemDone(r.toggleId, next);
    }
  }

  if (rows.length === 0) {
    return <p className="text-xs text-muted">今はありません。</p>;
  }

  return (
    <ul className="space-y-1">
      {rows.map((r) => {
        const done = doneOverride[r.key] ?? false;
        return (
          <li
            key={r.key}
            className="flex items-start gap-2 rounded-lg bg-surface px-2 py-1.5"
          >
            <input
              type="checkbox"
              checked={done}
              onChange={(e) => toggle(r, e.target.checked)}
              className="mt-1 h-5 w-5 shrink-0 accent-[var(--teal)]"
              aria-label="完了"
            />
            <Link
              href={`/events/${r.eventId}`}
              className="min-w-0 flex-1 py-0.5 no-underline"
            >
              <span
                className={`block text-sm ${done ? "text-muted line-through" : "text-foreground"}`}
              >
                {r.title}
              </span>
              <span className="block text-[11px] text-muted">
                {r.eventTitle} ・ {formatDateShort(r.eventDate)}
                {r.isPast ? "（過去）" : ""}
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
