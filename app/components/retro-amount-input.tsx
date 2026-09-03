"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { updateFailureAmount } from "@/app/actions";
import { AutosaveIndicator } from "@/app/components/autosave-indicator";

/**
 * 振り返りの「金額」入力。更新ボタンはなく、打ち終わって少ししたら自動保存する
 * （「防げた」に計上済みなら節約額の方も揃う）。予定詳細ページと失敗ログページの
 * どちらの振り返りでも使う。
 */
export function RetroAmountInput({
  failureLogId,
  initial,
}: {
  failureLogId: string;
  initial: number;
}) {
  const [val, setVal] = useState(initial ? String(initial) : "");
  const [pending, start] = useTransition();
  const first = useRef(true);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const t = window.setTimeout(() => {
      const fd = new FormData();
      fd.set("failureLogId", failureLogId);
      fd.set("estimatedLossYen", val);
      start(() => updateFailureAmount(fd));
    }, 800);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [val]);

  return (
    <label className="flex items-center gap-1.5 text-[11px] text-muted">
      金額
      <input
        type="number"
        min={0}
        step={100}
        value={val}
        onChange={(e) => setVal(e.target.value)}
        placeholder="円"
        className="w-24 rounded-md border bg-background px-2 py-1 text-xs text-foreground"
      />
      <span className="text-[11px] text-muted">自動保存</span>
      <AutosaveIndicator show={pending} />
    </label>
  );
}
