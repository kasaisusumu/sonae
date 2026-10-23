"use client";

import { useState } from "react";
import Link from "next/link";
import { X } from "lucide-react";
import {
  toggleChecklistItemDone,
  toggleFutureMessageDoneAction,
  toggleStandalonePriorityItemAction,
  deleteStandalonePriorityItemAction,
  trackFeatureUse,
} from "@/app/actions";
import { formatDateShort } from "@/lib/format";

export interface HomePriorityRowData {
  key: string;
  title: string;
  eventId: string | null;
  eventTitle: string | null;
  eventDate: string | null; // ISO
  isPast: boolean;
  isMessage: boolean;
  isStandalone: boolean;
  toggleId: string;
}

/**
 * ホームの「急ぎ」「そのうち」一覧。チェックすると予定詳細と同じ isDone に反映される
 * （準備リスト項目は toggleChecklistItemDone、未来の自分へは toggleFutureMessageDoneAction、
 * 予定に紐づかない項目は toggleStandalonePriorityItemAction）。
 * チェックした瞬間にその場から消え、「完了した項目を見る」コーナー（`onComplete`経由で
 * 呼び出し元に伝える）へすぐ移る。以前は「画面が切り替わるまで消さない」方針だったが、
 * 「完了した項目を見る」コーナーができたことで、消えてもすぐ見返せる・チェックを
 * 外せば戻せるため、この一覧についてはその方針を外した（ユーザー指摘「完了した項目を
 * 見るコーナーができたから、完了した時にページを出るまでそのままにするやつ無くして
 * いいよ。すぐ完了コーナーに行っていいよ」、2026-10-24）。
 */
export function HomePriorityRows({
  rows,
  onComplete,
}: {
  rows: HomePriorityRowData[];
  onComplete: (row: HomePriorityRowData) => void;
}) {
  const [removed, setRemoved] = useState<Record<string, boolean>>({});

  function complete(r: HomePriorityRowData) {
    setRemoved((prev) => ({ ...prev, [r.key]: true }));
    onComplete(r);
    void trackFeatureUse("feature:home-item-check");
    if (r.isStandalone) {
      void toggleStandalonePriorityItemAction(r.toggleId, true);
    } else if (r.isMessage) {
      void toggleFutureMessageDoneAction(r.toggleId, true);
    } else {
      void toggleChecklistItemDone(r.toggleId, true);
    }
  }

  function remove(r: HomePriorityRowData) {
    if (!window.confirm(`「${r.title}」を削除します。元に戻せません。よろしいですか？`)) return;
    setRemoved((prev) => ({ ...prev, [r.key]: true }));
    void deleteStandalonePriorityItemAction(r.toggleId);
  }

  const visibleRows = rows.filter((r) => !removed[r.key]);

  if (visibleRows.length === 0) {
    return <p className="text-xs text-muted">今はありません。</p>;
  }

  return (
    <ul className="space-y-1">
      {visibleRows.map((r) => {
        const body = (
          <>
            <span className="block text-sm text-foreground">{r.title}</span>
            {r.isStandalone ? (
              <span className="block text-[11px] text-muted">手動で追加</span>
            ) : (
              <span className="block text-[11px] text-muted">
                {r.eventTitle} ・ {r.eventDate ? formatDateShort(r.eventDate) : ""}
                {r.isPast ? "（過去）" : ""}
              </span>
            )}
          </>
        );
        return (
          <li
            key={r.key}
            className="flex items-start gap-2 rounded-lg bg-surface px-2 py-1.5"
          >
            <input
              type="checkbox"
              checked={false}
              onChange={(e) => {
                if (e.target.checked) complete(r);
              }}
              className="mt-1 h-5 w-5 shrink-0 accent-[var(--teal)]"
              aria-label="完了"
            />
            {r.isStandalone ? (
              <span className="min-w-0 flex-1 py-0.5">{body}</span>
            ) : (
              <Link href={`/events/${r.eventId}`} className="min-w-0 flex-1 py-0.5 no-underline">
                {body}
              </Link>
            )}
            {r.isStandalone && (
              <button
                type="button"
                onClick={() => remove(r)}
                aria-label="削除"
                className="mt-0.5 shrink-0 rounded-full border border-border px-1.5 py-1 text-xs text-muted hover:border-warn hover:text-warn"
              >
                <X aria-hidden className="h-3.5 w-3.5" />
              </button>
            )}
          </li>
        );
      })}
    </ul>
  );
}
