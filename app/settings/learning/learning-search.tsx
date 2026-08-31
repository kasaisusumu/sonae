"use client";

import { useMemo, useState } from "react";

export interface SearchEntry {
  eventId: string;
  title: string;
  crumb: string;
}

export function LearningSearch({ entries }: { entries: SearchEntry[] }) {
  const [q, setQ] = useState("");

  const matches = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return [];
    return entries
      .filter((e) => e.title.toLowerCase().includes(s))
      .slice(0, 15);
  }, [q, entries]);

  function jump(id: string) {
    const el = document.getElementById(`ev-${id}`);
    if (!el) return;
    let node: HTMLElement | null = el;
    while (node) {
      if (node instanceof HTMLDetailsElement) node.open = true;
      node = node.parentElement;
    }
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    el.classList.add("ring-2", "ring-teal");
    window.setTimeout(() => el.classList.remove("ring-2", "ring-teal"), 2200);
    setQ("");
  }

  return (
    <div className="sticky top-0 z-20 -mx-1 rounded-xl bg-background/95 px-1 py-2 backdrop-blur">
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="予定名で検索 → その枝へ飛ぶ"
        className="w-full rounded-lg border bg-surface px-3 py-2 text-sm"
      />
      {matches.length > 0 && (
        <ul className="mt-1 max-h-72 overflow-auto rounded-lg border bg-surface text-sm shadow-lg">
          {matches.map((m) => (
            <li key={m.eventId} className="border-b border-border last:border-0">
              <button
                type="button"
                onClick={() => jump(m.eventId)}
                className="block w-full px-3 py-2 text-left hover:bg-surface-muted"
              >
                <span className="font-medium">{m.title}</span>
                <span className="block text-[11px] text-muted">{m.crumb}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {q.trim() && matches.length === 0 && (
        <p className="mt-1 px-1 text-[11px] text-muted">
          一致する予定がありません。
        </p>
      )}
    </div>
  );
}
