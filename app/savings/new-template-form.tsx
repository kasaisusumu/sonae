"use client";

import { useState } from "react";
import { createListTemplate } from "@/app/actions";

/**
 * 名前付きマニュアルの新規作成フォーム。
 * - 枠は「準備すること／持ち物」に加えて「その他（新しい枠）」を新設できる
 * - 内容は貼り付けでも、スマホのマイクキーでの音声入力でもよい（記入場所は同じ）
 * - 「作成する」＝入力そのまま／「AIで整えて作成」＝自由文を項目に整えてから作成
 */
export function NewTemplateForm() {
  const [mode, setMode] = useState<"task" | "belonging" | "custom">("task");

  return (
    <form action={createListTemplate} className="mt-2 space-y-2">
      <div className="flex flex-wrap items-center gap-3 text-xs">
        <span className="text-muted">どの枠：</span>
        {(
          [
            ["task", "準備すること"],
            ["belonging", "持ち物"],
            ["custom", "その他（新しい枠）"],
          ] as const
        ).map(([v, label]) => (
          <label key={v} className="flex items-center gap-1">
            <input
              type="radio"
              name="kind"
              value={v}
              checked={mode === v}
              onChange={() => setMode(v)}
              className="accent-[var(--foreground)]"
            />
            {label}
          </label>
        ))}
      </div>

      {mode === "custom" && (
        <input
          name="customKind"
          required
          maxLength={24}
          placeholder="枠の名前（例: 買うもの / 連絡すること）"
          className="w-full rounded-lg border bg-surface px-3 py-2 text-sm"
        />
      )}

      <input
        name="name"
        required
        maxLength={60}
        placeholder="リスト名（例: 日帰り出張の持ち物）"
        className="w-full rounded-lg border bg-surface px-3 py-2 text-sm"
      />
      <textarea
        name="bulkText"
        rows={4}
        placeholder={
          "項目を1行に1つ。スマホのマイクキーで話してもOK。\n（例）充電器 モバイルバッテリー 常備薬\n「AIで整えて作成」なら、話し言葉のままでも整えます。"
        }
        className="w-full rounded-lg border bg-surface px-3 py-2 text-sm"
      />
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="submit"
          className="rounded-lg bg-foreground px-4 py-2 text-sm font-medium text-surface hover:opacity-90"
        >
          作成する
        </button>
        <button
          type="submit"
          name="tidy"
          value="1"
          className="rounded-lg border border-foreground px-4 py-2 text-sm font-medium text-foreground hover:bg-surface-muted"
        >
          🎤 AIで整えて作成
        </button>
      </div>
    </form>
  );
}
