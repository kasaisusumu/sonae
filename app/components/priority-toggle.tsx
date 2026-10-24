"use client";

/** 項目・未来の自分へメッセージの「急ぎ」「そのうち」タグ（2026-10-23追加）。
 * どちらも選んでいない状態（null）も正式な状態。選んだものをもう一度押すと外れる。 */
export type QuickPriority = "urgent" | "later" | null;

const PRIORITY_META: Record<
  "urgent" | "later",
  { label: string; icon: string; selected: string }
> = {
  urgent: {
    label: "急ぎ",
    icon: "🔥",
    selected: "border-warn bg-warn-soft text-warn",
  },
  later: {
    label: "そのうち",
    icon: "🕒",
    selected: "border-teal bg-teal-soft text-teal-dark",
  },
};

/**
 * 「急ぎ」「そのうち」の2択トグル。タップで選ぶ、選んでいるものをもう一度タップすると外れる
 * （どちらも選んでいない状態に戻る）。軽い操作なので確認ポップアップは出さない。
 */
export function PriorityToggle({
  value,
  onChange,
  disabled,
  className = "",
}: {
  value: QuickPriority;
  onChange: (next: QuickPriority) => void;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <div className={`flex flex-nowrap items-center gap-1 ${className}`}>
      {(["urgent", "later"] as const).map((p) => {
        const meta = PRIORITY_META[p];
        const selected = value === p;
        return (
          <button
            key={p}
            type="button"
            disabled={disabled}
            aria-pressed={selected}
            onClick={(e) => {
              e.stopPropagation();
              onChange(p);
            }}
            className={`shrink-0 rounded-full border px-2 py-px text-[11px] leading-tight transition-colors disabled:opacity-40 ${
              selected
                ? `${meta.selected} font-semibold`
                : "border-border bg-surface text-muted hover:border-foreground/30"
            }`}
          >
            <span aria-hidden>{meta.icon}</span>{" "}
            <span className="truncate">{meta.label}</span>
          </button>
        );
      })}
    </div>
  );
}
