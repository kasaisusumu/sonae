"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { buildListFromDictation } from "@/app/actions";

/**
 * スマホのキーボードのマイクキーで「準備すること・持ち物」を思いつくまま話し、
 * AI で 準備すること / 持ち物 / 必要な枠 に振り分けて追加する。
 * 小さなボタン → ポップアップで入力。
 */
export function DictationInput({ eventId }: { eventId: string }) {
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
      const res = await buildListFromDictation({ eventId, text: t });
      if (res.ok) {
        setNote(res.summary ?? "追加しました。");
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
        🎤 話して作る
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
              🎤 話して作る（音声入力から自動で振り分け）
            </h3>
            <p className="text-[11px] text-muted">
              スマホのキーボードの<strong>マイクキー</strong>で、準備することや持ち物、
              心配なうっかりを思いつくまま話してください。「AIで振り分け」で
              <strong>準備すること・持ち物・その他の枠・考えられる失敗</strong>
              に分けて追加します。
            </p>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={5}
              placeholder={
                "例: 明日の出張、着替えと充電器とお茶を持っていく。宿の予約を確認する。経費精算のことを忘れずメモ。あと駅で弁当を買う。前回は保険証を忘れた。"
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
                {pending ? "振り分け中…" : "AIで振り分けて追加"}
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
              追加された項目は、いつも通りその場で直したり消したりできます。学習にも反映されます。
            </p>
          </div>
        </div>
      )}
    </>
  );
}
