"use client";

import { useState, useTransition } from "react";
import { setListReminders } from "@/app/actions";
import {
  LEAD_PRESETS,
  MAX_LIST_REMINDERS,
  formatLead,
  normalizeLeads,
} from "@/lib/lead-time";

const TIME_PRESETS = LEAD_PRESETS.filter(
  (p): p is { label: string; minutes: number } => p.minutes != null,
);

/**
 * 予定単位の「準備リストのリマインド」。最大5回まで。小さなボタン → ポップアップで編集。
 * ボタン表記: 1回=「🔔 リマインド：1日前」、2回以上=「🔔 リマインド（2）：1日前+」。
 */
export function ListReminderControl({
  eventId,
  current,
}: {
  eventId: string;
  current: number[];
}) {
  const [leads, setLeads] = useState<number[]>(() => normalizeLeads(current));
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();

  function save(next: number[]) {
    const norm = normalizeLeads(next);
    setLeads(norm);
    start(() => setListReminders(eventId, norm));
  }

  const label =
    leads.length === 0
      ? "なし"
      : leads.length === 1
        ? formatLead(leads[0])
        : `${formatLead(leads[0])}+`;
  const countBadge = leads.length >= 2 ? `（${leads.length}）` : "";

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1 rounded-lg border border-border bg-surface px-2.5 py-1.5 text-xs text-foreground hover:bg-surface-muted"
      >
        🔔 リマインド{countBadge}：{label}
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
              予定の前に「準備リストを確認しましょう」を通知します。最大 {MAX_LIST_REMINDERS} 回。
            </p>

            {leads.length === 0 ? (
              <p className="text-xs text-muted">リマインドはオフです。</p>
            ) : (
              <ul className="space-y-2">
                {leads.map((L, i) => (
                  <li key={`${L}-${i}`} className="flex items-center gap-2">
                    <select
                      value={String(L)}
                      disabled={pending}
                      onChange={(e) => {
                        const copy = [...leads];
                        copy[i] = Number(e.target.value);
                        save(copy);
                      }}
                      className="flex-1 rounded-lg border bg-background px-3 py-2 text-sm"
                      aria-label={`リマインド ${i + 1}`}
                    >
                      {TIME_PRESETS.map((p) => (
                        <option key={p.minutes} value={String(p.minutes)}>
                          {p.label}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() => {
                        if (
                          !window.confirm(
                            `${formatLead(L)}のリマインドを削除しますか？`,
                          )
                        )
                          return;
                        save(leads.filter((_, j) => j !== i));
                      }}
                      aria-label="このリマインドを削除"
                      className="shrink-0 rounded-md border border-border px-2 py-1 text-xs text-muted hover:border-warn hover:text-warn"
                    >
                      ✕
                    </button>
                  </li>
                ))}
              </ul>
            )}

            <div className="flex items-center justify-between gap-2">
              <button
                type="button"
                disabled={pending || leads.length >= MAX_LIST_REMINDERS}
                onClick={() => {
                  // 既定候補: まだ無いプリセットを1つ足す（1日前→3時間前→…）
                  const cand =
                    [1440, 180, 60, 10080, 2880, 30].find(
                      (m) => !leads.includes(m),
                    ) ?? 1440;
                  save([...leads, cand]);
                }}
                className="rounded-md border border-foreground bg-foreground px-3 py-1.5 text-xs font-medium text-surface hover:opacity-90 disabled:opacity-40"
              >
                ＋ リマインドを追加
              </button>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-lg px-3 py-1.5 text-sm text-muted hover:text-foreground"
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
