"use client";

import { useState } from "react";
import { X } from "lucide-react";

export interface UsageGridRow {
  id: string;
  name: string | null;
  email: string;
  byDay: number[];
  costByDay: number[];
  detailByDay: { at: string; label: string; model: string; costYen: number }[][];
  totalMinutes: number;
  aiCostYen: number;
}

function formatMinutes(min: number): string {
  if (min <= 0) return "0分";
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h === 0) return `${m}分`;
  if (m === 0) return `${h}時間`;
  return `${h}時間${m}分`;
}

function formatYenApprox(n: number): string {
  const sign = n < 0 ? "-" : "";
  const rounded = Math.round(Math.abs(n) * 10_000) / 10_000;
  const formatted = rounded.toLocaleString("ja-JP", { maximumFractionDigits: 4 });
  return `${sign}¥${formatted}`;
}

/**
 * 利用者別・日付別の利用時間カレンダー。マスには利用時間に加えて、その日の
 * AI利用金額（概算）も出す。マスをタップすると、その日の操作別の内訳を見られる
 * （ユーザー指摘により2026-10-19: 「カレンダーのますに今の使用時間数に加えて
 * 金額を出して、それをタップしたら詳細が見られるようにして」）。
 */
export function UsageTimeGrid({
  days,
  todayKey,
  rows,
}: {
  days: { key: string; label: string }[];
  todayKey: string;
  rows: UsageGridRow[];
}) {
  const [open, setOpen] = useState<{ row: UsageGridRow; dayIndex: number } | null>(
    null,
  );

  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold">
        利用者別・日付別の利用時間（直近{days.length}日・AI利用金額つき）
      </h2>
      <div className="overflow-x-auto rounded-2xl border border-border bg-surface shadow-sm">
        <table className="w-full text-left text-[11px]">
          <thead className="border-b border-border bg-surface-muted text-muted">
            <tr>
              <th className="sticky left-0 whitespace-nowrap bg-surface-muted px-3 py-2 font-medium">
                利用者
              </th>
              {days.map((d) => (
                <th
                  key={d.key}
                  className={`whitespace-nowrap px-2 py-2 text-center font-medium ${
                    d.key === todayKey ? "text-teal-dark" : ""
                  }`}
                >
                  {d.label}
                </th>
              ))}
              <th className="whitespace-nowrap px-3 py-2 text-right font-medium">
                累計
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((r) => (
              <tr key={r.id}>
                <td className="sticky left-0 whitespace-nowrap bg-surface px-3 py-2 font-medium text-foreground">
                  {r.name || r.email}
                </td>
                {r.byDay.map((min, i) => {
                  const cost = r.costByDay[i] ?? 0;
                  const hasDetail = (r.detailByDay[i]?.length ?? 0) > 0;
                  return (
                    <td
                      key={days[i].key}
                      className="whitespace-nowrap px-1 py-1 text-center tabular-nums text-muted"
                    >
                      {hasDetail ? (
                        <button
                          type="button"
                          onClick={() => setOpen({ row: r, dayIndex: i })}
                          className="w-full rounded px-1 py-1 hover:bg-surface-muted"
                        >
                          <span className="block">
                            {min > 0 ? formatMinutes(min) : "・"}
                          </span>
                          <span className="block text-[10px] text-teal-dark underline">
                            {formatYenApprox(cost)}
                          </span>
                        </button>
                      ) : (
                        <span className="block px-1 py-1">
                          {min > 0 ? formatMinutes(min) : "・"}
                        </span>
                      )}
                    </td>
                  );
                })}
                <td className="whitespace-nowrap px-3 py-2 text-right font-medium tabular-nums">
                  {formatMinutes(r.totalMinutes)}
                  <span className="ml-1.5 font-normal text-teal-dark">
                    {formatYenApprox(r.aiCostYen)}
                  </span>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td
                  colSpan={days.length + 2}
                  className="px-3 py-6 text-center text-muted"
                >
                  まだユーザーがいません。
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {open && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4"
          onClick={() => setOpen(null)}
        >
          <div
            className="flex max-h-[85vh] w-full max-w-md flex-col overflow-hidden rounded-2xl bg-background text-foreground shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-3 border-b border-border bg-surface p-4">
              <p className="text-sm font-semibold text-foreground">
                {(open.row.name || open.row.email)} ・ {days[open.dayIndex].label}
              </p>
              <button
                type="button"
                aria-label="閉じる"
                onClick={() => setOpen(null)}
                className="rounded-lg px-2 py-1 text-muted hover:bg-surface-muted"
              >
                <X aria-hidden className="h-4 w-4" />
              </button>
            </div>
            <div className="overflow-y-auto p-3">
              <ul className="divide-y divide-border">
                {open.row.detailByDay[open.dayIndex].map((d, i) => (
                  <li
                    key={i}
                    className="flex items-center justify-between gap-2 px-1 py-2 text-sm"
                  >
                    <div className="min-w-0">
                      <p className="truncate font-medium text-foreground">
                        {d.label}
                      </p>
                      <p className="text-xs text-muted">
                        {d.at} ・ {d.model}
                      </p>
                    </div>
                    <span className="shrink-0 tabular-nums text-teal-dark">
                      {formatYenApprox(d.costYen)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
