"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { saveTemplateItems } from "@/app/actions";
import { LEAD_PRESETS, isLeadPreset } from "@/lib/lead-time";
import { parseBulkTitles } from "@/lib/bulk";
import { AutosaveIndicator } from "@/app/components/autosave-indicator";

type Row = {
  key: string;
  title: string;
  notifyLeadMinutes: number | null;
};

let seq = 0;
const nextKey = () => `tt-${seq++}`;

export function TemplateEditor({
  templateId,
  initialItems,
}: {
  templateId: string;
  initialItems: { title: string; notifyLeadMinutes: number | null }[];
}) {
  const [rows, setRows] = useState<Row[]>(
    initialItems.map((it) => ({ key: nextKey(), ...it })),
  );
  const [bulk, setBulk] = useState("");
  const [pending, start] = useTransition();
  const dirty = useRef(false);

  function save(next: Row[]) {
    start(async () => {
      await saveTemplateItems(
        templateId,
        next
          .filter((r) => r.title.trim())
          .map((r) => ({
            title: r.title.trim(),
            notifyLeadMinutes: r.notifyLeadMinutes,
          })),
      );
    });
  }

  // 文言・通知タイミングの変更は、手が止まってから自動保存。
  useEffect(() => {
    if (!dirty.current) return;
    const t = window.setTimeout(() => {
      dirty.current = false;
      save(rows);
    }, 800);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows]);

  function patch(key: string, p: Partial<Row>) {
    dirty.current = true;
    setRows((r) => r.map((x) => (x.key === key ? { ...x, ...p } : x)));
  }
  function remove(key: string) {
    if (!window.confirm("削除しますか？")) return;
    setRows((r) => {
      const next = r.filter((x) => x.key !== key);
      save(next); // 削除は即時保存
      return next;
    });
  }
  function addRow() {
    setRows((r) => [
      ...r,
      { key: nextKey(), title: "", notifyLeadMinutes: null },
    ]);
  }
  function addBulk() {
    const titles = parseBulkTitles(bulk);
    if (titles.length === 0) return;
    const have = new Set(
      rows.map((r) => r.title.toLowerCase().replace(/\s+/g, "")),
    );
    const fresh = titles.filter(
      (t) => !have.has(t.toLowerCase().replace(/\s+/g, "")),
    );
    setRows((r) => {
      const next = [
        ...r,
        ...fresh.map((title) => ({
          key: nextKey(),
          title,
          notifyLeadMinutes: null,
        })),
      ];
      save(next);
      return next;
    });
    setBulk("");
  }

  return (
    <div className="mt-2 space-y-2">
      <AutosaveIndicator show={pending} />
      <ul className="divide-y divide-border">
        {rows.map((r) => {
          const sel =
            r.notifyLeadMinutes == null
              ? "none"
              : isLeadPreset(r.notifyLeadMinutes)
                ? String(r.notifyLeadMinutes)
                : "custom";
          return (
            <li key={r.key} className="flex flex-wrap items-center gap-2 py-1.5">
              <input
                value={r.title}
                onChange={(e) => patch(r.key, { title: e.target.value })}
                placeholder="項目名"
                className="min-w-0 flex-1 rounded-md border border-transparent bg-transparent px-1 py-1 text-sm hover:border-border focus:border-border focus:bg-background"
              />
              <select
                value={sel}
                onChange={(e) => {
                  const v = e.target.value;
                  patch(r.key, {
                    notifyLeadMinutes: v === "none" ? null : Number(v),
                  });
                }}
                className="rounded-md border bg-background px-1.5 py-0.5 text-xs text-muted"
                aria-label="通知タイミング"
              >
                {LEAD_PRESETS.map((p) => (
                  <option
                    key={p.label}
                    value={p.minutes == null ? "none" : String(p.minutes)}
                  >
                    🔔 {p.label}
                  </option>
                ))}
                {sel === "custom" && (
                  <option value="custom">🔔 {r.notifyLeadMinutes}分前</option>
                )}
              </select>
              <button
                type="button"
                onClick={() => remove(r.key)}
                className="rounded px-1.5 py-0.5 text-xs text-muted hover:bg-warn-soft hover:text-warn"
              >
                削除
              </button>
            </li>
          );
        })}
        {rows.length === 0 && (
          <li className="py-1.5 text-xs text-muted">（項目がありません）</li>
        )}
      </ul>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={addRow}
          className="rounded-lg border border-dashed border-border px-3 py-1 text-xs text-muted hover:border-teal hover:text-teal-dark"
        >
          ＋ 行を追加
        </button>
        <span className="text-[11px] text-muted">
          {pending ? "保存中…" : "変更は自動保存"}
        </span>
      </div>

      <div className="rounded-lg border border-border bg-background p-2">
        <textarea
          value={bulk}
          onChange={(e) => setBulk(e.target.value)}
          rows={3}
          placeholder={"メモから一括追加（1行に1つ）\n充電器\nモバイルバッテリー"}
          className="w-full rounded-md border bg-surface px-2 py-1.5 text-sm"
        />
        <div className="mt-1 flex items-center gap-2">
          <button
            type="button"
            onClick={addBulk}
            disabled={!bulk.trim()}
            className="rounded-md bg-foreground px-3 py-1 text-xs font-medium text-surface hover:opacity-90 disabled:opacity-50"
          >
            一括で行に追加
          </button>
          <span className="text-[11px] text-muted">追加すると自動保存されます。</span>
        </div>
      </div>
    </div>
  );
}
