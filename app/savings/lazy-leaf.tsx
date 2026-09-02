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
  tone = "surface",
}: {
  id: string;
  summary: ReactNode;
  children: ReactNode;
  /** 階層で白／グレーを交互にするための下地色。 */
  tone?: "surface" | "muted";
}) {
  const [opened, setOpened] = useState(false);
  return (
    <details
      id={id}
      className={`scroll-mt-24 rounded-lg border border-border p-2.5 shadow-sm transition-shadow ${
        tone === "muted" ? "bg-surface-muted" : "bg-surface"
      }`}
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
