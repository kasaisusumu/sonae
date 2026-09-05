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
  // マウント時に「どの行を・どの順で」出すかだけ固定する（結果を変えても行が
  // 消えない・並び替わらないため）。金額や結果などの中身は毎回 rows の最新を使う。
  // rows から消えた行だけ、最後に見えていた内容（スナップショット）で残す。
  const [snapshot] = useState(() => rows);
  const freshById = new Map(rows.map((r) => [r.id, r] as const));
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
      {snapshot.map((s, i) => {
        const r = freshById.get(s.id) ?? s; // 中身は最新優先、消えた行は当時のまま
        const outcome = s.id in overrides ? overrides[s.id] : r.outcome;
        return (
          <FailureReviewRow
            key={s.id || `x${i}`}
            log={{ ...r, outcome }}
            onOutcome={(t) => handleOutcome(s.id, t)}
          />
        );
      })}
    </ul>
  );
}
