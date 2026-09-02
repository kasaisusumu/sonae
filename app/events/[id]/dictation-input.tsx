"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { buildListFromDictation } from "@/app/actions";

/**
 * スマホのキーボードのマイクキーで「準備すること・持ち物」を思いつくまま話し、
 * AI で 準備すること / 持ち物 / 必要な枠 に振り分けて追加する。
 */
export function DictationInput({ eventId }: { eventId: string }) {
  const router = useRouter();
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
    <details className="rounded-2xl bg-surface p-3 [&_summary::-webkit-details-marker]:hidden">
      <summary className="cursor-pointer list-none text-sm font-semibold text-teal-dark">
        🎤 話して作る（音声入力から自動で振り分け）
      </summary>

      <p className="mt-2 text-[11px] text-muted">
        スマホのキーボードの<strong>マイクキー</strong>を押して、準備することや持ち物を思いつくまま話してください。
        「AIで振り分け」を押すと、<strong>準備すること・持ち物・その他の枠</strong>に分けて追加します。
      </p>

      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={5}
        placeholder={
          "例: 明日の出張、着替えと充電器とお茶を持っていく。宿の予約を確認する。経費精算のことを忘れずメモ。あと駅で弁当を買う。"
        }
        className="mt-2 w-full rounded-lg border bg-background px-3 py-2 text-sm"
      />

      <div className="mt-2 flex items-center gap-3">
        <button
          type="button"
          onClick={run}
          disabled={pending || !text.trim()}
          className="rounded-lg bg-teal px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-teal-dark disabled:opacity-50"
        >
          {pending ? "振り分け中…" : "AIで振り分けて追加"}
        </button>
        {note && <span className="text-[11px] text-teal-dark">{note}</span>}
        {err && <span className="text-[11px] text-warn">{err}</span>}
      </div>

      <p className="mt-2 text-[10px] text-muted">
        追加された項目は、いつも通りその場で直したり消したりできます。学習にも反映されます。
      </p>
    </details>
  );
}
