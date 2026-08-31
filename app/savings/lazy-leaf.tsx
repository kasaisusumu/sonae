"use client";

import { useState, type ReactNode } from "react";

/**
 * 予定名の葉。開いたときに初めて中身（編集フォーム）をマウントする。
 * 検索から `details.open = true` された場合も toggle イベントで開く。
 */
export function LazyLeaf({
  id,
  summary,
  children,
}: {
  id: string;
  summary: ReactNode;
  children: ReactNode;
}) {
  const [opened, setOpened] = useState(false);
  return (
    <details
      id={id}
      className="scroll-mt-24 rounded-lg bg-surface p-2 transition-shadow"
      onToggle={(e) => {
        if ((e.currentTarget as HTMLDetailsElement).open) setOpened(true);
      }}
    >
      <summary className="cursor-pointer text-xs font-medium">{summary}</summary>
      {opened && (
        <div className="mt-2 border-l border-border pl-3">{children}</div>
      )}
    </details>
  );
}
