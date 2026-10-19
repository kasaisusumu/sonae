"use client";

import { useState, useTransition } from "react";
import { tidyCountermeasureDictation } from "@/app/actions";

/**
 * 「有効だった対策」の入力欄＋「🎤 AIで整える」ボタン。
 * スマホのマイクキーで話した内容をそのまま打ち込み、ボタンで短い一文に整える
 * （準備リストの「話して作る」と同じ考え方）。
 * 自己完結（内部で state を持つ）なので、サーバーコンポーネントのフォーム内でも
 * `name` を指定してそのまま置き換えるだけで使える。値の変化を親にも伝えたいときは
 * `onValue` を渡す（例: 自動保存のデバウンス対象に含めたいクライアント側フォーム）。
 */
export function CountermeasureField({
  name = "countermeasure",
  defaultValue,
  onValue,
  rows = 2,
  placeholder = "例: 前日にリマインダーを設定した",
  label,
  className = "w-full rounded-md border bg-background px-2 py-1 text-xs text-foreground",
}: {
  name?: string;
  defaultValue?: string | null;
  onValue?: (v: string) => void;
  rows?: number;
  placeholder?: string;
  label?: string;
  className?: string;
}) {
  const [value, setValueState] = useState(defaultValue ?? "");
  const [pending, start] = useTransition();

  function setValue(v: string) {
    setValueState(v);
    onValue?.(v);
  }

  function tidy() {
    const t = value.trim();
    if (!t || pending) return;
    start(async () => {
      const out = await tidyCountermeasureDictation(t);
      if (out) setValue(out);
    });
  }

  return (
    <div className="space-y-1">
      {label && <span className="block text-[11px] text-muted">{label}</span>}
      <textarea
        name={name}
        rows={rows}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={placeholder}
        className={className}
      />
      <button
        type="button"
        onClick={tidy}
        disabled={pending || !value.trim()}
        className="text-[11px] text-teal-dark underline hover:text-foreground disabled:opacity-50"
      >
        {pending ? "整えています…" : "🎤 話した内容をAIで整える"}
      </button>
    </div>
  );
}
