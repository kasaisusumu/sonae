"use client";

import { useFormStatus } from "react-dom";

export function SubmitButton({
  children,
  variant = "primary",
}: {
  children: React.ReactNode;
  variant?: "primary" | "ghost";
}) {
  const { pending } = useFormStatus();
  const base =
    "inline-flex items-center justify-center rounded-lg px-4 py-2 text-sm font-medium transition-colors disabled:opacity-60";
  const styles =
    variant === "primary"
      ? "bg-teal text-white hover:bg-teal-dark"
      : "bg-surface-muted text-foreground hover:bg-border";
  return (
    <button type="submit" disabled={pending} className={`${base} ${styles}`}>
      {pending ? "処理中…" : children}
    </button>
  );
}
