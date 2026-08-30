"use client";

import { useTransition } from "react";
import { updateEventCategory } from "@/app/actions";

export function CategorySelect({
  eventId,
  current,
  options,
}: {
  eventId: string;
  current: string;
  options: string[];
}) {
  const [pending, startTransition] = useTransition();
  const opts = Array.from(new Set([current, ...options]));

  return (
    <select
      aria-label="カテゴリ"
      defaultValue={current}
      disabled={pending}
      onChange={(e) => {
        const categoryName = e.target.value;
        startTransition(async () => {
          const fd = new FormData();
          fd.set("eventId", eventId);
          fd.set("categoryName", categoryName);
          await updateEventCategory(fd);
        });
      }}
      className="shrink-0 rounded-lg border bg-background px-2 py-1 text-xs text-muted disabled:opacity-60"
    >
      {opts.map((n) => (
        <option key={n} value={n}>
          {n}
        </option>
      ))}
    </select>
  );
}
