"use client";

import { useState, useTransition } from "react";
import { deleteLearnedRule, setRuleLocked } from "@/app/actions";

export function RuleActions({
  ruleId,
  locked,
}: {
  ruleId: string;
  locked: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [gone, setGone] = useState(false);
  if (gone) return <span className="text-xs text-muted">削除しました</span>;

  return (
    <div className="flex shrink-0 gap-2">
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          startTransition(() => setRuleLocked(ruleId, !locked))
        }
        className="rounded px-2 py-1 text-xs text-muted hover:bg-surface-muted disabled:opacity-60"
      >
        {locked ? "固定を解除" : "固定する"}
      </button>
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          if (!window.confirm("この学習内容をリセットしますか？（元に戻せません）")) {
            return;
          }
          setGone(true);
          startTransition(() => deleteLearnedRule(ruleId));
        }}
        className="rounded px-2 py-1 text-xs text-muted hover:bg-warn-soft hover:text-warn disabled:opacity-60"
      >
        リセット
      </button>
    </div>
  );
}
