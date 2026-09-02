import Link from "next/link";
import type { ReactNode } from "react";

/** 法務ページ共通のガワ。運営者情報は運用時に差し替える前提のプレースホルダ。 */

export const LEGAL_UPDATED = "2026年9月2日";
export const OPERATOR = "（運営者名を記載）";
export const CONTACT = "（お問い合わせ先メールアドレスを記載）";

export function LegalPage({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="mx-auto max-w-2xl">
      <Link
        href="/"
        className="text-sm text-muted no-underline hover:text-teal-dark"
      >
        ← トップへ
      </Link>
      <h1 className="mt-3 text-2xl font-semibold tracking-tight">{title}</h1>
      <p className="mt-1 text-xs text-muted">最終改定日: {LEGAL_UPDATED}</p>
      <div className="mt-6 space-y-6 text-[13px] leading-relaxed text-foreground/90">
        {children}
      </div>
      <p className="mt-10 border-t border-border pt-4 text-xs text-muted">
        <Link href="/privacy" className="underline">
          プライバシーポリシー
        </Link>
        {" ・ "}
        <Link href="/terms" className="underline">
          利用規約
        </Link>
      </p>
    </div>
  );
}

export function Sec({
  n,
  title,
  children,
}: {
  n: number;
  title: string;
  children: ReactNode;
}) {
  return (
    <section>
      <h2 className="text-sm font-semibold text-foreground">
        {n}. {title}
      </h2>
      <div className="mt-1.5 space-y-1.5">{children}</div>
    </section>
  );
}
