"use client";

import { useState } from "react";
import { createMessageForEventAction } from "@/app/actions";
import { SubmitButton } from "@/app/components/submit-button";
import { InfoHint } from "@/app/components/info-hint";
import { FutureMessageRows, type EMRow } from "@/app/components/future-message-rows";

export type { EMRow };

/** 予定詳細の「💌 過去の自分よりメッセージ」枠。結びついたメッセージは確定後も含めて、いつでも編集できる。 */
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
        <h3 className="text-sm font-semibold text-teal-dark">💌 過去の自分よりメッセージ</h3>
        <span className="text-xs text-teal-dark/70 tabular-nums">
          {initial.length}
        </span>
        <InfoHint id="future-message-done-vs-remove">
          <p className="mb-3 text-sm font-semibold text-foreground">
            ✓・この予定から外す・削除の違い
          </p>

          <div className="mb-1 flex items-center gap-2">
            <input
              type="checkbox"
              checked
              readOnly
              className="h-5 w-5 shrink-0 accent-[var(--teal)]"
            />
            <span className="text-sm text-muted line-through">
              田中さんとの前回の件を忘れない
            </span>
          </div>
          <p className="mb-3 text-[13px]">
            この予定での完了の印だけ。チェックしても、次に「田中さん」が関わる
            別の予定が入れば、<strong className="text-foreground">そちらにもまた提案されます</strong>
            （もう提案しない、にはなりません）。カレンダーの説明欄のチェックにも反映されます。
          </p>

          <div className="mb-1">
            <span className="rounded px-0.5 text-[11px] text-muted underline">
              この予定から外す
            </span>
          </div>
          <p className="mb-3 text-[13px]">
            <strong className="text-foreground">この予定からだけ</strong>外れます。
            メッセージ自体は残るので、例えば「来月の田中さんとの打ち合わせ」には
            引き続き提案されます。
          </p>

          <div className="mb-1">
            <span className="text-[11px] text-warn underline">削除</span>
            <span className="ml-1 text-[11px] text-muted">
              （「未来の自分へ」ページの「これまでの記録」にあるボタン）
            </span>
          </div>
          <p className="text-[13px]">
            これだけが完全な削除です。これをすると、
            <strong className="text-foreground">以後どの予定にも二度と提案されなくなります</strong>。
          </p>
        </InfoHint>
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
            <SubmitButton
              confirmIf={(form) => {
                const kw = (form.elements.namedItem("keywords") as HTMLInputElement | null)?.value ?? "";
                return kw.trim()
                  ? null
                  : "キーワードが未設定です。このままだと、似た予定が来ても自動では思い出せません。このまま保存しますか？";
              }}
            >
              追加する
            </SubmitButton>
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
