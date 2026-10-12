"use client";

import { useFormStatus } from "react-dom";

export function SubmitButton({
  children,
  variant = "primary",
  confirm,
  confirmIf,
}: {
  children: React.ReactNode;
  variant?: "primary" | "ghost";
  /**
   * 送信前に、そのフォームの状態を見て条件つきで確認ダイアログを出したいとき用。
   * 文字列を返せばその内容で確認し、null/undefined ならそのまま送信する。
   * confirm と両方指定した場合はこちらを優先する。
   */
  confirmIf?: (form: HTMLFormElement) => string | null | undefined;
  /** 指定すると、送信前に確認ダイアログを出す（キャンセルで送信中止）。 */
  confirm?: string;
}) {
  const { pending } = useFormStatus();
  const base =
    "inline-flex items-center justify-center rounded-xl px-4 py-2 text-sm font-medium transition-all active:translate-y-px disabled:opacity-50 disabled:active:translate-y-0";
  // 白黒ベースのユニバーサルデザイン。primary = 前景色ベタ、ghost = 枠線のみ。
  const styles =
    variant === "primary"
      ? "bg-foreground text-surface shadow-sm hover:opacity-90"
      : "border border-border bg-surface text-foreground hover:bg-surface-muted";
  return (
    <button
      type="submit"
      disabled={pending}
      onClick={
        confirmIf
          ? (e) => {
              const form = e.currentTarget.form;
              const msg = form ? confirmIf(form) : null;
              if (msg && !window.confirm(msg)) e.preventDefault();
            }
          : confirm
            ? (e) => {
                if (!window.confirm(confirm)) e.preventDefault();
              }
            : undefined
      }
      className={`${base} ${styles}`}
    >
      {pending ? "処理中…" : children}
    </button>
  );
}
