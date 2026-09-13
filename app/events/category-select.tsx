"use client";

import { useState, useTransition } from "react";
import { updateEventCategory } from "@/app/actions";

// select 内の特別な選択肢（実在のカテゴリ名と衝突しないマーカー値）。
const NEW_CATEGORY_VALUE = "__new_category__";

/**
 * カテゴリの選択・変更。既存の候補（既定＋この予定に付けたことがある名前）から選ぶほか、
 * 「＋ 新しいカテゴリを作る」でその場に無い名前も入力して作れる
 * （サーバー側の updateEventCategory は元々 getOrCreateCategory で新規名も自動作成する）。
 */
export function CategorySelect({
  eventId,
  current,
  options,
}: {
  eventId: string;
  current: string;
  options: string[];
}) {
  const [value, setValue] = useState(current);
  // 予定を切り替えた・サーバー側の値が変わったときは表示も追従させる
  // （レンダー中に state を調整する公式パターン。effect にしない）。
  const [syncedCurrent, setSyncedCurrent] = useState(current);
  if (current !== syncedCurrent) {
    setSyncedCurrent(current);
    setValue(current);
  }
  const [pending, startTransition] = useTransition();
  const opts = Array.from(new Set([current, ...options]));

  function apply(categoryName: string) {
    setValue(categoryName);
    startTransition(async () => {
      const fd = new FormData();
      fd.set("eventId", eventId);
      fd.set("categoryName", categoryName);
      await updateEventCategory(fd);
    });
  }

  return (
    <select
      aria-label="カテゴリ"
      value={value}
      disabled={pending}
      onChange={(e) => {
        const next = e.target.value;
        if (next === NEW_CATEGORY_VALUE) {
          const name = window
            .prompt("新しいカテゴリ名を入力してください")
            ?.trim()
            .slice(0, 40);
          if (name) {
            apply(name);
          } else {
            setValue(current); // キャンセル・空欄なら選択を元に戻す
          }
          return;
        }
        apply(next);
      }}
      className="shrink-0 rounded-lg border bg-background px-2 py-1 text-xs text-muted disabled:opacity-60"
    >
      {opts.map((n) => (
        <option key={n} value={n}>
          {n}
        </option>
      ))}
      <option value={NEW_CATEGORY_VALUE}>＋ 新しいカテゴリを作る</option>
    </select>
  );
}
