"use client";

import { logout } from "@/app/actions";

const MSG =
  "ログアウトします。データは保存され、同じ Google アカウントで入り直せば元に戻ります。よろしいですか？";

/** 確認ダイアログ付きのログアウトボタン（見た目は className で調整）。 */
export function LogoutButton({
  className,
  label = "ログアウト",
}: {
  className?: string;
  label?: string;
}) {
  return (
    <form action={logout}>
      <button
        type="submit"
        className={className}
        onClick={(e) => {
          if (!window.confirm(MSG)) e.preventDefault();
        }}
      >
        {label}
      </button>
    </form>
  );
}
