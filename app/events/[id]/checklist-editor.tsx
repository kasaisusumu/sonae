"use client";

import { useMemo, useState, useTransition } from "react";
import { saveChecklist, toggleChecklistItemDone } from "@/app/actions";

interface Item {
  key: string;
  id: string | null;
  title: string;
  timingLabel: string;
  isDone: boolean;
  isUserAdded: boolean;
}

interface InitialItem {
  id: string | null;
  title: string;
  timingLabel: string | null;
  isDone: boolean;
  isUserAdded: boolean;
}

const TIMING_PRESETS = [
  "1週間前",
  "3日前",
  "前日",
  "前日夜",
  "当日朝",
  "当日",
  "30分前",
  "出発1時間前",
];

let counter = 0;
const nextKey = () => `it-${counter++}`;

export function ChecklistEditor({
  eventId,
  kind = "task",
  initialItems,
}: {
  eventId: string;
  kind?: "task" | "belonging";
  initialItems: InitialItem[];
}) {
  const isBelonging = kind === "belonging";
  const initial = useMemo<Item[]>(
    () =>
      initialItems.map((it) => ({
        key: nextKey(),
        id: it.id,
        title: it.title,
        timingLabel: it.timingLabel ?? "",
        isDone: it.isDone,
        isUserAdded: it.isUserAdded,
      })),
    [initialItems],
  );

  const [items, setItems] = useState<Item[]>(initial);
  const [removedTitles, setRemovedTitles] = useState<string[]>([]);
  const [pending, startTransition] = useTransition();
  const [saved, setSaved] = useState(false);

  const originalTitles = useMemo(
    () => new Set(initialItems.map((i) => i.title)),
    [initialItems],
  );

  // isDone は個別に自動保存するので dirty 判定から除外
  const dirty =
    JSON.stringify(items.map(strip)) !== JSON.stringify(initial.map(strip)) ||
    removedTitles.length > 0;

  function update(key: string, patch: Partial<Item>) {
    setItems((prev) =>
      prev.map((it) => (it.key === key ? { ...it, ...patch } : it)),
    );
    setSaved(false);
  }

  // チェックはその場で保存（「保存する」ボタン不要）
  function toggleDone(it: Item, next: boolean) {
    setItems((prev) =>
      prev.map((x) => (x.key === it.key ? { ...x, isDone: next } : x)),
    );
    if (it.id) void toggleChecklistItemDone(it.id, next);
  }

  function remove(key: string) {
    setItems((prev) => {
      const target = prev.find((it) => it.key === key);
      if (target && originalTitles.has(target.title)) {
        setRemovedTitles((r) =>
          r.includes(target.title) ? r : [...r, target.title],
        );
      }
      return prev.filter((it) => it.key !== key);
    });
    setSaved(false);
  }

  function add() {
    setItems((prev) => [
      ...prev,
      {
        key: nextKey(),
        id: null,
        title: "",
        timingLabel: "",
        isDone: false,
        isUserAdded: true,
      },
    ]);
    setSaved(false);
  }

  function save() {
    startTransition(async () => {
      await saveChecklist({
        eventId,
        kind,
        items: items
          .filter((it) => it.title.trim())
          .map((it) => ({
            title: it.title.trim(),
            timingLabel: it.timingLabel.trim() || null,
            isDone: it.isDone,
            isUserAdded: it.isUserAdded,
          })),
        removedTitles,
      });
      setRemovedTitles([]);
      setSaved(true);
    });
  }

  return (
    <div className="rounded-2xl bg-surface p-4">
      <ul className="divide-y divide-border">
        {items.map((it) => (
          <li key={it.key} className="flex items-start gap-3 py-3">
            <input
              type="checkbox"
              checked={it.isDone}
              onChange={(e) => toggleDone(it, e.target.checked)}
              className="mt-2 h-4 w-4 shrink-0 accent-[var(--teal)]"
              aria-label="完了"
            />
            <div className="flex-1 space-y-1">
              <input
                value={it.title}
                onChange={(e) => update(it.key, { title: e.target.value })}
                placeholder={isBelonging ? "持ち物を書く" : "準備することを書く"}
                className={`w-full rounded-md border border-transparent bg-transparent px-1 py-1 text-sm hover:border-border focus:border-border focus:bg-background ${
                  it.isDone ? "text-muted line-through" : ""
                }`}
              />
              <div className="flex items-center gap-2">
                <input
                  value={it.timingLabel}
                  onChange={(e) =>
                    update(it.key, { timingLabel: e.target.value })
                  }
                  list={`timing-presets-${kind}`}
                  placeholder={isBelonging ? "用意する目安" : "タイミング"}
                  className="w-32 rounded-md border border-transparent bg-transparent px-1 py-0.5 text-xs text-muted hover:border-border focus:border-border focus:bg-background"
                />
                {it.isUserAdded && (
                  <span className="rounded bg-accent-soft px-1.5 py-0.5 text-[10px] text-teal-dark">
                    追加
                  </span>
                )}
              </div>
            </div>
            <button
              type="button"
              onClick={() => remove(it.key)}
              className="mt-1 shrink-0 rounded px-1.5 py-0.5 text-xs text-muted hover:bg-warn-soft hover:text-warn"
              aria-label="削除"
            >
              削除
            </button>
          </li>
        ))}
      </ul>

      <datalist id={`timing-presets-${kind}`}>
        {TIMING_PRESETS.map((t) => (
          <option key={t} value={t} />
        ))}
      </datalist>

      <div className="mt-3 flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={add}
          className="rounded-lg border border-dashed border-border px-3 py-1.5 text-sm text-muted hover:border-teal hover:text-teal-dark"
        >
          ＋ 項目を追加
        </button>

        <div className="flex items-center gap-3">
          {saved && !dirty && (
            <span className="text-xs text-teal-dark">保存しました</span>
          )}
          <button
            type="button"
            onClick={save}
            disabled={pending || !dirty}
            className="rounded-lg bg-teal px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-teal-dark disabled:opacity-50"
          >
            {pending ? "保存中…" : "保存する"}
          </button>
        </div>
      </div>
      <p className="mt-2 text-[11px] text-muted">
        チェックは自動保存されます。文言・タイミングの変更は「保存する」で反映＆学習されます。
      </p>
    </div>
  );
}

function strip(it: Item) {
  return { title: it.title.trim(), timingLabel: it.timingLabel.trim() };
}
