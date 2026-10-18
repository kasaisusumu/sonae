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
  const [pending, startTransition] = useTransition();
  const [done, setDone] = useState(false);

  if (done) {
    return (
      <div className="rounded-2xl border border-border bg-surface p-4 text-sm text-muted">
        「{eventTitle}」に次回への一言を残しました。似た予定が入ったときに知らせます。
      </div>
    );
  }

  function submit() {
    const text = body.trim();
    if (!text || pending) return;
    startTransition(async () => {
      const fd = new FormData();
      fd.set("eventId", eventId);
      fd.set("body", text);
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
