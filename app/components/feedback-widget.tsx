"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import { submitFeedback } from "@/app/actions";

export function FeedbackWidget() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [done, setDone] = useState(false);

  if (done) {
    return (
      <span className="text-teal-dark">フィードバックありがとうございます。</span>
    );
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="underline hover:text-foreground"
      >
        このアプリ、月いくらなら払いたい？
      </button>
    );
  }

  return (
    <form
      action={async (fd) => {
        await submitFeedback(fd);
        setDone(true);
      }}
      className="flex flex-wrap items-center gap-2"
    >
      <input type="hidden" name="screen" value={pathname} />
      <span>月</span>
      <input
        name="wtpYen"
        type="number"
        min={0}
        step={100}
        placeholder="円"
        className="w-20 rounded-md border bg-background px-2 py-1 text-foreground"
      />
      <input
        name="comment"
        placeholder="ひとこと（任意）"
        className="w-40 rounded-md border bg-background px-2 py-1 text-foreground"
      />
      <button
        type="submit"
        className="rounded-md bg-foreground px-3 py-1 font-medium text-surface"
      >
        送信
      </button>
      <button
        type="button"
        onClick={() => setOpen(false)}
        className="text-muted hover:text-foreground"
      >
        閉じる
      </button>
    </form>
  );
}
