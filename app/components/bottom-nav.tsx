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
    <nav
      data-coach="bottom-nav"
      className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-surface sm:hidden"
    >
      <ul
        className="mx-auto flex max-w-3xl px-2 pt-1.5"
        style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 0.375rem)" }}
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
                aria-current={active ? "page" : undefined}
                className={`flex flex-col items-center justify-center gap-1 rounded-xl py-2 text-[11px] no-underline transition-colors ${
                  active
                    ? "bg-accent-soft font-semibold text-teal-dark"
                    : "text-muted hover:text-foreground"
                }`}
              >
                {tab.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
