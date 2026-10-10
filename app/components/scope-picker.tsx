"use client";

import { useState } from "react";
import { ScopeChip } from "@/app/components/scope-chip";
import type { ItemScope } from "@/lib/item-scope";

/** トグルが表示・選択できる3値だけの型（item-scope の ItemScope のうち、この3つだけ使う）。 */
export type QuickScope = Extract<ItemScope, "event_only" | "similar" | "keyword">;

/**
 * 「次回の出し方」のクイック選択（3択）。項目（準備リスト）・未来の自分へ、共通で使う。
 * 詳細を開かなくても、ここをタップするだけで即切り替わる。
 * 「この名前の予定だけ」（keyword）をタップしたときの実際のキーワードは、呼び出し元が
 * 予定名から自動で決める（`pickKeyword`、`lib/text-norm.ts`）。呼び出し元の `onChange` が
 * それぞれの保存処理（キーワードの算出を含む）を行う。
 */
export const QUICK_SCOPES: QuickScope[] = ["event_only", "similar", "keyword"];

export function ScopeQuickToggle({
  value,
  onChange,
  disabled,
  className = "",
}: {
  /** 3択のどれかと一致すればハイライトする（keyword はカスタムの値でも3番目がハイライトする）。
   * それ以外の値（旧ジャンル・自動など）ならどれも非選択。 */
  value: string;
  onChange: (next: QuickScope) => void;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <div className={`flex flex-wrap gap-1 ${className}`}>
      {QUICK_SCOPES.map((sc) => {
        const selected = value === sc;
        return (
          <button
            key={sc}
            type="button"
            disabled={disabled}
            aria-pressed={selected}
            onClick={(e) => {
              e.stopPropagation();
              onChange(sc);
            }}
            className={`rounded-full ${selected ? "" : "opacity-55 hover:opacity-100"} disabled:opacity-40`}
          >
            <ScopeChip scope={sc} status="chosen" className="pointer-events-none" />
          </button>
        );
      })}
    </div>
  );
}

/**
 * キーワード条件を「文章」の形で設定する、任意のオプション欄（詳細を開いたときだけ出す）。
 * 「『＿＿』のとき」の空欄に書き込む形にして、生の項目名入力に見えないようにする。
 * 空にして確定すると、キーワード指定をやめる（呼び出し元の onClear）。
 */
export function KeywordSentenceField({
  initialKeyword,
  onCommit,
  onClear,
  pending,
  placeholder = "玉姫殿",
}: {
  initialKeyword: string;
  onCommit: (keyword: string) => void;
  onClear: () => void;
  pending?: boolean;
  placeholder?: string;
}) {
  const [value, setValue] = useState(initialKeyword);

  function commit() {
    const v = value.trim();
    if (!v) {
      if (initialKeyword) onClear();
      return;
    }
    if (v !== initialKeyword) onCommit(v);
  }

  return (
    <div className="flex flex-wrap items-center gap-1 text-sm text-foreground">
      <span className="text-muted">キーワードを直すなら「</span>
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            (e.target as HTMLInputElement).blur();
          }
        }}
        placeholder={placeholder}
        disabled={pending}
        className="min-w-0 flex-1 basis-24 rounded-md border border-border bg-background px-2 py-0.5 text-sm text-foreground"
        aria-label="キーワード"
      />
      <span className="text-muted">」のとき</span>
      {pending && <span className="text-[11px] text-muted">保存中…</span>}
    </div>
  );
}
