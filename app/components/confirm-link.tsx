"use client";

import type { ReactNode } from "react";

/**
 * クリックすると確認ダイアログを出し、OK のときだけ遷移する <a>。
 * OAuth など、遷移してしまう操作の前に一呼吸置くために使う。
 */
export function ConfirmLink({
  href,
  message,
  className,
  children,
}: {
  href: string;
  message: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <a
      href={href}
      className={className}
      onClick={(e) => {
        if (!window.confirm(message)) e.preventDefault();
      }}
    >
      {children}
    </a>
  );
}
