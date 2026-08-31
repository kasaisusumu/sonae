"use client";

import { useFormStatus } from "react-dom";

export function SubmitButton({
  children,
  variant = "primary",
  confirm,
}: {
  children: React.ReactNode;
  variant?: "primary" | "ghost";
  /** 指定すると、送信前に確認ダイアログを出す（キャンセルで送信中止）。 */
  confirm?: string;
}) {
  const { pending } = useFormStatus();
  const base =
    "inline-flex items-center justify-center rounded-lg px-4 py-2 text-sm font-medium transition-colors disabled:opacity-60";
  const styles =
    variant === "primary"
      ? "bg-teal text-white hover:bg-teal-dark"
      : "bg-surface-muted text-foreground hover:bg-border";
  return (
    <button
      type="submit"
      disabled={pending}
      onClick={
        confirm
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
