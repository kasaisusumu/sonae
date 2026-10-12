"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { recommendAllItemScopesAction } from "@/app/actions";
import { InfoHint } from "@/app/components/info-hint";

/**
 * 予定詳細の「🤖AIで分別」ボタン。押すと、この予定の準備リストの中身**全部**
 * （項目ひとつずつではなく、予定単位で全項目）を一括で AI に「今回だけ」か
 * 「似た予定」かを判定してもらう。すでに選んだ・提案済みの項目は
 * lib/item-scope.ts の recommendScopesForAllItems 側で適切にスキップ／昇格する。
 */
export function AiSortButton({ eventId }: { eventId: string }) {
  const router = useRouter();
  const [note, setNote] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function run() {
    if (pending) return;
    setNote(null);
    startTransition(async () => {
      const res = await recommendAllItemScopesAction({ eventId });
      if (res.ok) {
        setNote(
          res.count > 0
            ? `${res.count}件を分別しました`
            : "分別する項目はありませんでした",
        );
        router.refresh();
      } else {
        setNote("うまくいきませんでした。");
      }
    });
  }

  return (
    <span className="inline-flex items-center gap-1.5">
      <button
        type="button"
        onClick={run}
        disabled={pending}
        className="inline-flex items-center gap-1 rounded-lg border border-border bg-surface px-2.5 py-1.5 text-xs text-foreground hover:bg-surface-muted disabled:opacity-50"
      >
        {pending ? "分別中…" : "🤖AIで分別"}
      </button>
      <InfoHint id="ai-sort-all">
        準備リストの項目（準備すること・持ち物・足した枠）全部について、「今回だけ」か
        「似た予定のとき」かを AI にまとめて決めてもらいます。項目ごとに3択ボタンを
        押す代わりに、ここを1回押すだけで済みます。すでに選んだ項目は変更しません。
      </InfoHint>
      {note && <span className="text-[11px] text-muted">{note}</span>}
    </span>
  );
}
