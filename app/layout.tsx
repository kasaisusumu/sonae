import type { Metadata, Viewport } from "next";
import { Geist } from "next/font/google";
import Link from "next/link";
import "./globals.css";
import { getSessionUserId } from "@/lib/session";
import { logout } from "@/app/actions";
import { FeedbackWidget } from "@/app/components/feedback-widget";
import { SwRegister } from "@/app/components/sw-register";
import { BottomNav } from "@/app/components/bottom-nav";
import { LiveSync } from "@/app/components/live-sync";
import { Tutorial } from "@/app/components/tutorial";
import { PageCoach } from "@/app/components/page-coach";
import { MenuButton } from "@/app/components/menu-button";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "私のマネージャー — 予定の準備リスト",
  description:
    "予定を入れるだけで準備リストを自動生成。編集を学習して自分専用マニュアルに育てます。",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "私のマネージャー",
  },
  icons: {
    icon: "/icons/icon-192.png",
    apple: "/icons/apple-touch-icon.png",
  },
};

export const viewport: Viewport = {
  themeColor: "#028090",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // レイアウトはログイン有無だけ判定（DB アクセスなし＝毎回のページ遷移を軽く）
  const isLoggedIn = (await getSessionUserId()) !== null;

  return (
    <html lang="ja" className={`${geistSans.variable} h-full`}>
      <body className="min-h-full flex flex-col bg-background text-foreground">
        <SwRegister />
        {isLoggedIn ? <LiveSync /> : null}
        {isLoggedIn ? <Tutorial /> : null}
        {isLoggedIn ? <PageCoach /> : null}

        <header className="sticky top-0 z-30 border-b border-border bg-surface">
          <div className="mx-auto flex max-w-3xl items-center justify-between gap-3 px-4 py-2.5 sm:px-5 sm:py-3">
            <div className="flex min-w-0 items-center gap-2">
              {isLoggedIn ? <MenuButton /> : null}
              <Link href="/" className="flex items-baseline gap-2 no-underline">
                <span className="truncate text-[15px] font-semibold tracking-tight text-foreground">
                  私のマネージャー
                </span>
                <span className="hidden text-xs text-muted sm:inline">
                  予定の準備、わすれない
                </span>
              </Link>
            </div>
            {isLoggedIn ? (
              <nav className="hidden items-center gap-1 text-sm sm:flex">
                {[
                  ["/events", "予定"],
                  ["/failures", "失敗ログ"],
                  ["/savings", "学習"],
                  ["/settings", "設定"],
                ].map(([href, label]) => (
                  <Link
                    key={href}
                    href={href}
                    className="rounded-lg px-2.5 py-1.5 text-muted no-underline transition-colors hover:bg-surface-muted hover:text-foreground"
                  >
                    {label}
                  </Link>
                ))}
                <form action={logout} className="ml-1">
                  <button
                    className="rounded-lg px-2.5 py-1.5 text-muted transition-colors hover:bg-surface-muted hover:text-foreground"
                    type="submit"
                  >
                    ログアウト
                  </button>
                </form>
              </nav>
            ) : null}
          </div>
        </header>

        <main className="mx-auto w-full max-w-3xl flex-1 px-5 py-8 pb-28 sm:pb-10">
          {children}
        </main>

        <footer className="border-t bg-surface">
          <div className="mx-auto flex max-w-3xl flex-wrap items-center justify-between gap-3 px-5 py-4 text-xs text-muted">
            <span>私のマネージャー（検証版）— 表示される金額はすべて推定値です。</span>
            {isLoggedIn ? <FeedbackWidget /> : null}
          </div>
        </footer>

        {isLoggedIn ? <BottomNav /> : null}
      </body>
    </html>
  );
}
