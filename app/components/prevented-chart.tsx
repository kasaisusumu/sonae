"use client";

import { useEffect, useRef, useState } from "react";
import type { SavingsSeries } from "@/lib/savings";
import { formatYen } from "@/lib/format";

type Grain = "month" | "week" | "day";
const KEY = "mm_savings_grain_v1";
const GRAINS: { id: Grain; label: string }[] = [
  { id: "month", label: "月" },
  { id: "week", label: "週" },
  { id: "day", label: "日" },
];

const H = 128; // グラフの高さ(px)

/**
 * 防げた失敗の「金額」と「件数」を、月/週/日で切り替えて見る二軸棒グラフ。
 * 選んだ粒度は localStorage に保持する。データが無くても枠は常に表示する。
 */
export function PreventedChart({ series }: { series: SavingsSeries }) {
  const [grain, setGrain] = useState<Grain>("month");
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // 「今日を含む区間」は配列の末尾＝一番右。狭い画面でも見えるよう右端に寄せる。
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollLeft = el.scrollWidth;
  }, [grain]);

  useEffect(() => {
    let saved: Grain = "month";
    try {
      const v = localStorage.getItem(KEY);
      if (v === "month" || v === "week" || v === "day") saved = v;
    } catch {
      /* ignore */
    }
    queueMicrotask(() => setGrain(saved));
  }, []);

  const pick = (g: Grain) => {
    setGrain(g);
    try {
      localStorage.setItem(KEY, g);
    } catch {
      /* ignore */
    }
  };

  const data = series[grain];
  const maxAmount = Math.max(1, ...data.map((d) => d.amountYen));
  const maxCount = Math.max(1, ...data.map((d) => d.count));
  const hasData = data.some((d) => d.amountYen > 0 || d.count > 0);
  const totalAmount = data.reduce((a, d) => a + d.amountYen, 0);
  const totalCount = data.reduce((a, d) => a + d.count, 0);

  return (
    <div className="rounded-2xl bg-surface p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-foreground">防げた失敗</h3>
        <div className="inline-flex rounded-lg bg-surface-muted p-0.5">
          {GRAINS.map((g) => (
            <button
              key={g.id}
              type="button"
              onClick={() => pick(g.id)}
              className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                grain === g.id
                  ? "bg-surface text-foreground shadow-sm"
                  : "text-muted hover:text-foreground"
              }`}
            >
              {g.label}
            </button>
          ))}
        </div>
      </div>

      {/* 凡例＋合計 */}
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted">
        <span className="inline-flex items-center gap-1">
          <span className="inline-block h-2 w-2 rounded-sm bg-teal" />
          金額 {formatYen(totalAmount)}
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="inline-block h-2 w-2 rounded-sm bg-warn" />
          件数 {totalCount}件
        </span>
      </div>

      {/* 二軸: 左=金額 / 右=件数 */}
      <div className="mt-3 flex items-stretch gap-2">
        <div
          className="flex w-9 shrink-0 flex-col justify-between py-1 text-right text-[9px] leading-none text-teal-dark"
          style={{ height: H }}
        >
          <span>{formatYen(maxAmount)}</span>
          <span>0</span>
        </div>

        <div ref={scrollRef} className="min-w-0 flex-1 overflow-x-auto">
          <div
            className="flex items-end gap-1.5"
            style={{ height: H, minWidth: data.length * 24 }}
          >
            {data.map((d, i) => {
              const isNow = i === data.length - 1;
              return (
              <div
                key={d.key}
                className="flex flex-1 flex-col items-center justify-end gap-1"
                title={`${d.label}${isNow ? "（今）" : ""}: ${formatYen(
                  d.amountYen,
                )} / ${d.count}件`}
              >
                <div className="flex w-full items-end justify-center gap-0.5">
                  <span
                    className="w-1/2 max-w-[10px] rounded-t bg-teal"
                    style={{
                      height: Math.max(
                        d.amountYen > 0 ? 3 : 0,
                        Math.round((d.amountYen / maxAmount) * (H - 16)),
                      ),
                    }}
                  />
                  <span
                    className="w-1/2 max-w-[10px] rounded-t bg-warn"
                    style={{
                      height: Math.max(
                        d.count > 0 ? 3 : 0,
                        Math.round((d.count / maxCount) * (H - 16)),
                      ),
                    }}
                  />
                </div>
                <span
                  className={`whitespace-nowrap text-[9px] ${
                    isNow ? "font-semibold text-foreground" : "text-muted"
                  }`}
                >
                  {d.label}
                  {isNow ? " ▾" : ""}
                </span>
              </div>
              );
            })}
          </div>
        </div>

        <div
          className="flex w-6 shrink-0 flex-col justify-between py-1 text-left text-[9px] leading-none text-warn"
          style={{ height: H }}
        >
          <span>{maxCount}</span>
          <span>0</span>
        </div>
      </div>

      {!hasData && (
        <p className="mt-2 text-[11px] text-muted">
          まだ「防げた」がありません。失敗ログで「防げた」を選ぶと、ここに金額と件数が積み上がります。
        </p>
      )}
    </div>
  );
}
