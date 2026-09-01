"use client";

import Link from "next/link";
import { useLinkStatus } from "next/link";

/**
 * カード全体をタップ領域にするための、絶対配置の透明リンク。
 * タップした瞬間に「開いています…」を重ねて、遷移までの待ちを可視化する
 * （dynamic route ＋ loading.js でも、prefetch 前だと数百 ms 待たされるため）。
 */
function Pending({ label }: { label: string }) {
  const { pending } = useLinkStatus();
  if (!pending) return null;
  return (
    <span className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center rounded-xl bg-surface-muted">
      <span className="rounded-full bg-teal px-3 py-1 text-xs font-medium text-white shadow">
        {label}
      </span>
    </span>
  );
}

export function CardLink({
  href,
  ariaLabel,
  pendingLabel = "開いています…",
  className = "",
}: {
  href: string;
  ariaLabel?: string;
  pendingLabel?: string;
  className?: string;
}) {
  return (
    <>
      <Link
        href={href}
        aria-label={ariaLabel}
        className={`absolute inset-0 z-0 rounded-xl ${className}`}
      >
        <Pending label={pendingLabel} />
      </Link>
    </>
  );
}
