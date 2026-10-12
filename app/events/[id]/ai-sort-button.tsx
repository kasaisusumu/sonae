"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { recommendAllItemScopesAction } from "@/app/actions";
import { InfoHint } from "@/app/components/info-hint";
import { ScopeChip } from "@/app/components/scope-chip";

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
    const ok = window.confirm(
      "まだ決まっていない項目を、AIが「今回だけ」か「似た予定」かに自動で振り分けます（次回以降の出し方が変わります）。すでに選んだ項目は変更しません。実行しますか？",
    );
    if (!ok) return;
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
    // relative + 固定サイズの中身（ボタン＋ⓘ）だけで幅・高さを決め、結果メッセージは
    // absolute で下に重ねて表示する（通常のフローに含めない）。結果メッセージの文字数が
    // 変わっても、同じ行に並ぶ他のボタン（🔔リマインド・🎤話して作る）の折り返し位置や
    // 高さが変わらないようにするため。
    <span className="relative inline-flex shrink-0 items-center gap-1">
      <button
        type="button"
        onClick={run}
        disabled={pending}
        className="inline-flex items-center gap-1 rounded-lg border border-border bg-surface px-2.5 py-1.5 text-xs text-foreground hover:bg-surface-muted disabled:opacity-50"
      >
        {pending ? "分別中…" : "🤖AIで分別"}
      </button>
      <InfoHint id="ai-sort-all">
        <p className="mb-2 text-sm font-semibold text-foreground">🤖AIで分別とは</p>
        <p className="mb-2 text-[13px]">
          準備リストの項目（準備すること・持ち物・足した枠）全部について、まだ決まって
          いないものだけ、AI が次のどちらかにまとめて決めます。項目ごとに下のボタンを
          1つずつ押す代わりに、ここを1回押すだけで済みます。
        </p>
        <p className="mb-3 flex flex-wrap items-center gap-1.5">
          <ScopeChip scope="event_only" />
          <span className="text-[11px] text-muted">または</span>
          <ScopeChip scope="similar" />
        </p>
        <p className="mb-2 text-[13px]">
          例: 「新幹線のチケットを確認」という項目なら、AI は「バスや飛行機の移動でも
          出したい内容」と判断して <ScopeChip scope="similar" className="mx-1 align-middle" /> に、
          「玉姫殿に電話する」のような項目なら「この予定限定の内容」と判断して
          <ScopeChip scope="event_only" className="mx-1 align-middle" /> にします。
        </p>
        <p className="text-[13px] text-muted">
          すでに <ScopeChip scope="event_only" className="mx-0.5 align-middle" />
          のように選んだ・決まっている項目は変更しません。
        </p>
      </InfoHint>
      {note && (
        <span className="absolute left-0 top-full z-10 mt-1 whitespace-nowrap rounded-md bg-surface px-1.5 py-0.5 text-[11px] text-muted shadow-sm">
          {note}
        </span>
      )}
    </span>
  );
}
