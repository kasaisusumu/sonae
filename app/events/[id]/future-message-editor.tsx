"use client";

import { useState } from "react";
import { createMessageForEventAction } from "@/app/actions";
import { SubmitButton } from "@/app/components/submit-button";
import { FutureMessageRows, type EMRow } from "@/app/components/future-message-rows";

export type { EMRow };

/** 予定詳細の「💌 未来の自分へ」枠。結びついたメッセージは確定後も含めて、いつでも編集できる。 */
export function FutureMessageEditor({
  eventId,
  initial,
}: {
  eventId: string;
  initial: EMRow[];
}) {
  const [adding, setAdding] = useState(false);

  return (
    <div
      data-coach="future-message"
      className="rounded-2xl border border-teal/30 bg-teal-soft p-3"
    >
      <div className="mb-1.5 flex items-baseline gap-2">
        <h3 className="text-sm font-semibold text-teal-dark">💌 未来の自分へ</h3>
        <span className="text-xs text-teal-dark/70 tabular-nums">
          {initial.length}
        </span>
      </div>

      <FutureMessageRows rows={initial} />

      {adding && (
        <form
          action={createMessageForEventAction}
          className="mt-2 space-y-2 rounded-lg bg-background/60 p-2"
        >
          <input type="hidden" name="eventId" value={eventId} />
          <textarea
            name="body"
            required
            rows={2}
            placeholder="次に思い出したいこと（例: 前回のギブアンドテイクを忘れない）"
            className="w-full rounded-md border border-border bg-background px-2 py-1 text-sm"
          />
          <input
            name="keywords"
            placeholder="キーワード（任意・読点区切り。例: 田中、A社）"
            className="w-full rounded-md border bg-background px-2 py-1 text-xs"
          />
          <div className="flex flex-wrap items-center gap-2">
            <SubmitButton>追加する</SubmitButton>
            <button
              type="button"
              onClick={() => setAdding(false)}
              className="text-xs text-muted underline hover:text-foreground"
            >
              取消
            </button>
          </div>
        </form>
      )}

      <div className="mt-2">
        <button
          type="button"
          onClick={() => setAdding((v) => !v)}
          className="rounded-md border border-foreground bg-foreground px-3 py-1.5 text-xs font-medium text-surface hover:opacity-90"
        >
          ＋ 追加
        </button>
      </div>
      <p className="mt-1.5 text-[11px] text-muted">文言・追加・削除は自動保存</p>
    </div>
  );
}
