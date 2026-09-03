"use client";

import { useState, useTransition } from "react";
import { setFailureOutcome } from "@/app/actions";
import {
  FailureReviewRow,
  type FRRow,
  type OutcomeTarget,
} from "@/app/components/failure-review-row";

/**
 * 「過去の失敗予測の振り返り」形式の行を、マウント中は消さずに出し続けるリスト。
 * ホームの「防げたこと」ポップアップで使う。結果を変えても、その場では行が
 * 消えず（楽観的に状態だけ更新）、ポップアップを閉じる／ページを移ると片付く。
 * 失敗ログページの ReviewQueue と同じ体験。
 */
export function StickyReviewRows({
  rows,
  className = "space-y-2",
}: {
  rows: FRRow[];
  className?: string;
}) {
  // マウント時のスナップショット。以後 rows が減っても・並びが変わっても表示は保つ。
  const [snapshot] = useState(() => rows);
  const [overrides, setOverrides] = useState<Record<string, string | null>>({});
  const [, start] = useTransition();

  const CONFIRM: Record<OutcomeTarget, string> = {
    prevented: "「防げた」で記録しますか？（推定額が節約額に積み上がります）",
    not_prevented: "「防げなかった」に変更しますか？（節約額から外れます）",
    irrelevant: "「今回は関係ない」に変更しますか？（節約額から外れます）",
    unset: "この結果を取り消しますか？（節約額から外れます）",
  };

  function handleOutcome(id: string, t: OutcomeTarget) {
    if (!window.confirm(CONFIRM[t])) return;
    const next = t === "unset" ? null : t;
    setOverrides((o) => ({ ...o, [id]: next }));
    const fd = new FormData();
    fd.set("failureLogId", id);
    fd.set("outcome", t);
    start(() => setFailureOutcome(fd));
  }

  if (snapshot.length === 0) {
    return <p className="p-4 text-xs text-muted">内訳がありません。</p>;
  }

  return (
    <ul className={className}>
      {snapshot.map((r, i) => {
        const outcome =
          r.id in overrides ? overrides[r.id] : r.outcome;
        return (
          <FailureReviewRow
            key={r.id || `x${i}`}
            log={{ ...r, outcome }}
            onOutcome={(t) => handleOutcome(r.id, t)}
          />
        );
      })}
    </ul>
  );
}
