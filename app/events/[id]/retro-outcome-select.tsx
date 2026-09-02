"use client";

import { useState, useTransition } from "react";
import { setFailureOutcome } from "@/app/actions";

const OPTS: { v: string; label: string }[] = [
  { v: "not_prevented", label: "😓 防げなかった" },
  { v: "prevented", label: "🛡 防げた" },
  { v: "irrelevant", label: "— 今回は関係ない" },
  { v: "unset", label: "・ まだ決めない" },
];

/**
 * 終わった予定の振り返り結果を、あとから選び直すためのセレクト。
 * 予定前の編集と同じく「選択肢から選ぶ」だけ（取り消し／削除はしない）。
 * 変えたらその場で保存し、節約計上も揃える（setFailureOutcome）。
 */
export function RetroOutcomeSelect({
  logId,
  current,
}: {
  logId: string;
  current: string;
}) {
  const [val, setVal] = useState(current);
  const [pending, start] = useTransition();

  return (
    <label className="flex flex-wrap items-center gap-2 text-xs text-muted">
      今回の結果
      <select
        value={val}
        disabled={pending}
        onChange={(e) => {
          const next = e.target.value;
          setVal(next);
          const fd = new FormData();
          fd.set("failureLogId", logId);
          fd.set("outcome", next);
          start(() => setFailureOutcome(fd));
        }}
        className="rounded-md border bg-background px-2 py-1 text-xs text-foreground"
      >
        {OPTS.map((o) => (
          <option key={o.v} value={o.v}>
            {o.label}
          </option>
        ))}
      </select>
      {pending && <span>保存中…</span>}
    </label>
  );
}
