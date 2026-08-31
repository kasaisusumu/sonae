"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/", label: "ホーム" },
  { href: "/events", label: "予定" },
  { href: "/failures", label: "失敗ログ" },
  { href: "/savings", label: "学習" },
  { href: "/settings", label: "設定" },
];

export function BottomNav() {
  const pathname = usePathname();

  return (
    <nav className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-surface sm:hidden">
      <ul
        className="mx-auto flex max-w-3xl"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        {TABS.map((tab) => {
          const active =
            tab.href === "/"
              ? pathname === "/"
              : pathname.startsWith(tab.href);
          return (
            <li key={tab.href} className="flex-1">
              <Link
                href={tab.href}
                className={`flex flex-col items-center justify-center gap-0.5 py-2.5 text-[11px] no-underline ${
                  active ? "font-semibold text-teal-dark" : "text-muted"
                }`}
              >
                <span
                  className={`h-1 w-1 rounded-full ${
                    active ? "bg-teal" : "bg-transparent"
                  }`}
                />
                {tab.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
