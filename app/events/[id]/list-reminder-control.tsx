"use client";

import { useState, useTransition } from "react";
import { setListReminder } from "@/app/actions";
import { LEAD_PRESETS, isLeadPreset } from "@/lib/lead-time";

/**
 * 予定単位の「準備リストのリマインド」。この時間に1回「準備リストを確認しましょう」を通知。
 * 既定は1日前。小さなボタン → ポップアップで選ぶ。選ぶと即保存。
 */
export function ListReminderControl({
  eventId,
  current,
}: {
  eventId: string;
  current: number | null;
}) {
  const [value, setValue] = useState<number | null>(current ?? null);
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();

  const sel =
    value == null ? "none" : isLeadPreset(value) ? String(value) : "1440";
  const currentLabel =
    LEAD_PRESETS.find(
      (p) => (p.minutes == null ? "none" : String(p.minutes)) === sel,
    )?.label ?? "1日前";

  function onChange(v: string) {
    const next = v === "none" ? null : Number(v);
    setValue(next);
    start(() => setListReminder(eventId, next));
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1 rounded-lg border border-border bg-surface px-2.5 py-1.5 text-xs text-foreground hover:bg-surface-muted"
      >
        🔔 リマインド：{value == null ? "なし" : currentLabel}
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => setOpen(false)}
        >
          <div
            className="w-full max-w-sm space-y-3 rounded-2xl bg-surface p-5 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-sm font-semibold text-foreground">
              🔔 準備リストのリマインド
            </h3>
            <p className="text-xs text-muted">
              この時間に1回、「準備すること・持ち物」をまとめて確認する通知を送ります。
            </p>
            <select
              value={sel}
              onChange={(e) => onChange(e.target.value)}
              disabled={pending}
              className="w-full rounded-lg border bg-background px-3 py-2 text-sm"
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
            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-lg bg-foreground px-4 py-1.5 text-sm font-medium text-surface hover:opacity-90"
              >
                閉じる
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
