"use client";

import { useState, useTransition } from "react";
import { setListReminder } from "@/app/actions";
import { LEAD_PRESETS, isLeadPreset } from "@/lib/lead-time";

/**
 * 予定単位の「準備リストのリマインド」。この時間に1回「準備リストを確認しましょう」を通知。
 * 既定は1日前。選ぶと即保存。
 */
export function ListReminderControl({
  eventId,
  current,
}: {
  eventId: string;
  current: number | null;
}) {
  const [value, setValue] = useState<number | null>(current ?? null);
  const [pending, start] = useTransition();

  const sel =
    value == null ? "none" : isLeadPreset(value) ? String(value) : "1440";

  function onChange(v: string) {
    const next = v === "none" ? null : Number(v);
    setValue(next);
    start(() => setListReminder(eventId, next));
  }

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-xl bg-surface px-3 py-2 text-xs">
      <span className="font-medium text-foreground">🔔 準備リストのリマインド</span>
      <select
        value={sel}
        onChange={(e) => onChange(e.target.value)}
        disabled={pending}
        className="rounded-md border bg-background px-2 py-1 text-xs"
        aria-label="準備リストのリマインド"
      >
        {LEAD_PRESETS.map((p) => (
          <option
            key={p.label}
            value={p.minutes == null ? "none" : String(p.minutes)}
          >
            {p.label}
          </option>
        ))}
      </select>
      <span className="text-[10px] text-muted">
        準備すること・持ち物をまとめて1回通知
      </span>
    </div>
  );
}
