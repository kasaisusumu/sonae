"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createFailureLogFromDictation } from "@/app/actions";

/**
 * スマホのキーボードのマイクキーで「何があった・どんな対策を考えたか」を
 * 思いつくまま話し、AI で「何が起きたか」「有効だった対策」に分けて記録する。
 * 準備リストの `DictationInput` と同じ考え方。
 */
export function FailureDictationInput({
  eventId = null,
}: {
  /** 予定に紐づけて記録したいとき（省略時はカテゴリ全体の記録）。 */
  eventId?: string | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function run() {
    const t = text.trim();
    if (!t || pending) return;
    setNote(null);
    setErr(null);
    startTransition(async () => {
      const res = await createFailureLogFromDictation({ eventId, text: t });
      if (res.ok) {
        setNote("記録しました。");
        setText("");
        router.refresh();
      } else {
        setErr(res.error ?? "うまくいきませんでした。");
      }
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1 rounded-lg border border-border bg-surface px-2.5 py-1.5 text-xs text-foreground hover:bg-surface-muted"
      >
        🎤 話して記録する
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => setOpen(false)}
        >
          <div
            className="w-full max-w-sm space-y-3 rounded-2xl bg-surface p-5 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-sm font-semibold text-foreground">
              🎤 話して記録する
            </h3>
            <p className="text-[11px] text-muted">
              スマホのキーボードの<strong>マイクキー</strong>で、何があったか、
              思いついた対策があればそれも合わせて話してください。
              「何が起きたか」と「有効だった対策」にAIで分けて記録します。
            </p>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={4}
              placeholder={
                "例: 集合時間に遅刻しちゃった。次からは前日にリマインダーを設定しておこうと思う。"
              }
              className="w-full rounded-lg border bg-background px-3 py-2 text-sm"
            />
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={run}
                disabled={pending || !text.trim()}
                className="rounded-lg bg-foreground px-4 py-2 text-sm font-medium text-surface shadow-sm transition-colors hover:opacity-90 disabled:opacity-50"
              >
                {pending ? "整えて記録中…" : "AIで整えて記録する"}
              </button>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="text-xs text-muted underline hover:text-foreground"
              >
                閉じる
              </button>
              {note && <span className="text-[11px] text-teal-dark">{note}</span>}
              {err && <span className="text-[11px] text-warn">{err}</span>}
            </div>
            <p className="text-[10px] text-muted">
              記録された内容は、いつも通りその場で直したり消したりできます。
            </p>
          </div>
        </div>
      )}
    </>
  );
}
