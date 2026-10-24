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
 *
 * 完了した行を消すのは、このコンポーネント自身ではなく呼び出し元（`onComplete`を
 * 受けた`PriorityHomeContainer`）が`rows`配列そのものから取り除く形にしている
 * （ローカルに`removed[key]=true`のような形で隠すと、同じ名前グループ・同じidの
 * 行が「完了した項目を見る」から復活して戻ってきたときに、その古い`removed`状態の
 * せいで再び隠れてしまうバグになる。name-group の `key` は完了前後で同じ文字列の
 * ため、特にこの問題が起きやすい。ユーザー指摘「完了した項目から完了を解除した時、
 * すぐにリストに戻るようにして」で発覚、2026-10-24修正）。✕削除だけは元に戻る経路が
 * 無いため、引き続きこのコンポーネント内のローカル`removed`で隠す。
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

  /** 追加直後、サーバーの応答（本物のidへの差し替え）をまだ待っている行か
   * （`PriorityHomeContainer.addItem` が一時idを `tmp:` で始まる文字列にしている）。
   * この間にチェック・削除すると、一時idに対する更新が実データに届かずDB上の行だけ
   * 作られて取り残される不具合になるため、応答が来るまで操作できないようにする
   * （2026-10-24のバグレビューで発覚・修正）。 */
  function isPending(r: HomePriorityRowData): boolean {
    return r.toggleId.startsWith("tmp:");
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
        const pending = isPending(r);
        return (
          <li
            key={r.key}
            className={`flex items-start gap-2 rounded-lg bg-surface px-2 py-1.5 ${pending ? "opacity-60" : ""}`}
          >
            <input
              type="checkbox"
              checked={false}
              disabled={pending}
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
                disabled={pending}
                aria-label="削除"
                className="mt-0.5 shrink-0 rounded-full border border-border px-1.5 py-1 text-xs text-muted hover:border-warn hover:text-warn disabled:pointer-events-none"
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
