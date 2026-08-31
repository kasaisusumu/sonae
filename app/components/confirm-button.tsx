"use client";

/**
 * <form action={serverAction}> の中に置く送信ボタン。
 * 押すと確認ダイアログを出し、OK のときだけ送信する（キャンセルで送信中止）。
 * リストの項目そのものの削除には使わない（それは確認なしで即時）。
 */
export function ConfirmButton({
  children,
  message,
  className,
  disabled,
}: {
  children: React.ReactNode;
  message: string;
  className?: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="submit"
      disabled={disabled}
      className={className}
      onClick={(e) => {
        if (!window.confirm(message)) e.preventDefault();
      }}
    >
      {children}
    </button>
  );
}
