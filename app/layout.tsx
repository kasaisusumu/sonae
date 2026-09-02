import type { Metadata, Viewport } from "next";
import { Geist } from "next/font/google";
import Link from "next/link";
import "./globals.css";
import { getSessionUserId } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { FeedbackWidget } from "@/app/components/feedback-widget";
import { LogoutButton } from "@/app/components/logout-button";
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
  title: "勝手に準備分解くん — 予定の準備リスト",
  description:
    "予定を入れるだけで準備リストを自動生成。編集を学習して自分専用マニュアルに育てます。",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "勝手に準備分解くん",
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
  const uid = await getSessionUserId();
  const isLoggedIn = uid !== null;

  // 「結果記録待ち」の失敗ログ数（ナビにドットを出す）。1 件の軽い count。
  let pendingReview = 0;
  if (uid) {
    pendingReview = await prisma.failureLog.count({
      where: {
        userId: uid,
        outcome: null,
        OR: [
          { eventId: null },
          { event: { eventDatetime: { lte: new Date() } } },
        ],
      },
    });
  }

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
                  勝手に準備分解くん
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
                    className="relative rounded-lg px-2.5 py-1.5 text-muted no-underline transition-colors hover:bg-surface-muted hover:text-foreground"
                  >
                    {label}
                    {href === "/failures" && pendingReview > 0 && (
                      <span className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-warn" />
                    )}
                  </Link>
                ))}
                <span className="ml-1">
                  <LogoutButton className="rounded-lg px-2.5 py-1.5 text-muted transition-colors hover:bg-surface-muted hover:text-foreground" />
                </span>
              </nav>
            ) : null}
          </div>
        </header>

        <main className="mx-auto w-full max-w-3xl flex-1 px-5 py-8 pb-28 sm:pb-10">
          {children}
        </main>

        <footer className="border-t bg-surface">
          <div className="mx-auto flex max-w-3xl flex-wrap items-center justify-between gap-x-4 gap-y-2 px-5 py-4 text-xs text-muted">
            <span>勝手に準備分解くん（検証版）— 表示される金額はすべて推定値です。</span>
            <span className="flex items-center gap-3">
              <Link
                href="/privacy"
                className="text-muted no-underline hover:text-foreground"
              >
                プライバシーポリシー
              </Link>
              <Link
                href="/terms"
                className="text-muted no-underline hover:text-foreground"
              >
                利用規約
              </Link>
            </span>
            {isLoggedIn ? <FeedbackWidget /> : null}
          </div>
        </footer>

        {isLoggedIn ? <BottomNav pendingReview={pendingReview} /> : null}
      </body>
    </html>
  );
}
