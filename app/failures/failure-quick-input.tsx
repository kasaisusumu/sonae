"use client";

import { useState } from "react";

/**
 * 失敗ログの「何があった？」入力。よくあるうっかりはボタンで一発、
 * あとは自由に足せる。name="description" のまま送るので既存フォームと互換。
 */
const CHIPS = [
  "遅刻した",
  "寝坊した",
  "忘れ物をした",
  "予約を忘れた",
  "電車を逃した",
  "道に迷った",
  "返信を忘れた",
  "持ち物を間違えた",
];

export function FailureQuickInput() {
  const [text, setText] = useState("");

  const add = (c: string) =>
    setText((t) => {
      const base = t.replace(/\s+$/, "");
      return base ? `${base}、${c}` : c;
    });

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {CHIPS.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => add(c)}
            className="rounded-full border border-border bg-surface px-3 py-1 text-xs text-foreground hover:bg-surface-muted"
          >
            ＋ {c}
          </button>
        ))}
      </div>
      <textarea
        name="description"
        required
        rows={2}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="何があった？（上のボタンからでも、自由入力でもOK。例: 集合時間に遅刻した）"
        className="w-full rounded-xl border bg-background px-3 py-2.5 text-sm"
      />
    </div>
  );
}
