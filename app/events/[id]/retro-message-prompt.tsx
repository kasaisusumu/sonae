"use client";

import { useState, useTransition } from "react";
import { createMessageForEventAction } from "@/app/actions";

/**
 * 終わった予定で、一致する未来メッセージが無いときの「振り返り」枠。
 * 一致が無くても、ここから直接「次回への一言」を新規メッセージとして書ける
 * （未来の自分へのメッセージと完全に同じ仕組み・同じ回数カウントになる。
 * ユーザー指摘により2026-10-19追加: 「予定振り返りでもメッセージ機能、
 * 未来へのメッセージと実は同じで、回数もそれと同期にしよう」）。
 */
export function RetroMessagePrompt({
  eventId,
  eventTitle,
}: {
  eventId: string;
  eventTitle: string;
}) {
  const [body, setBody] = useState("");
  const [keywords, setKeywords] = useState("");
  const [pending, startTransition] = useTransition();
  const [done, setDone] = useState(false);

  if (done) {
    return (
      <div className="rounded-2xl border border-border bg-surface p-4 text-sm text-muted">
        「{eventTitle}」に次回への一言を残しました
        {keywords.trim()
          ? "。似た予定が入ったときに知らせます。"
          : "（キーワード未設定のため、自動では思い出せません。「過去の自分よりメッセージ」の枠からいつでも追加できます）。"}
      </div>
    );
  }

  function submit() {
    const text = body.trim();
    if (!text || pending) return;
    if (
      !keywords.trim() &&
      !window.confirm(
        "キーワードが未設定です。このままだと、似た予定が来ても自動では思い出せません。このまま保存しますか？",
      )
    ) {
      return;
    }
    startTransition(async () => {
      const fd = new FormData();
      fd.set("eventId", eventId);
      fd.set("body", text);
      fd.set("keywords", keywords);
      await createMessageForEventAction(fd);
      setDone(true);
    });
  }

  return (
    <section className="space-y-2 rounded-2xl border border-border bg-surface p-5">
      <h2 className="text-sm font-semibold text-foreground">
        {eventTitle}、おつかれさまでした 🍵
      </h2>
      <p className="text-xs text-muted">
        次回の似た予定に残しておきたいことがあれば、一言書いておけます（任意）。
      </p>
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={2}
        placeholder="例: 受付の場所がわかりにくいので早めに着く"
        className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground"
      />
      <input
        value={keywords}
        onChange={(e) => setKeywords(e.target.value)}
        placeholder="キーワード（任意・読点区切り。例: 田中、A社）"
        className="w-full rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground"
      />
      <button
        type="button"
        onClick={submit}
        disabled={pending || !body.trim()}
        className="rounded-lg bg-foreground px-4 py-2 text-sm font-semibold text-surface shadow-sm hover:opacity-90 disabled:opacity-50"
      >
        書いておく
      </button>
    </section>
  );
}
