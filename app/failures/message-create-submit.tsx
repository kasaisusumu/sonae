"use client";

import { SubmitButton } from "@/app/components/submit-button";

const WARN_MESSAGE =
  "キーワードが未設定です。このままだと、似た予定が来ても自動では思い出せません。このまま保存しますか？";

/**
 * 「未来の自分へ」の新規作成フォーム共通の送信ボタン。
 * keywords 欄が空のまま保存しようとしたら確認を出す。関数は Server Component から
 * Client Component へ直接渡せないため、この中に閉じて持つ（confirmIf は "use client" 側で定義）。
 */
export function MessageCreateSubmit({ children }: { children: React.ReactNode }) {
  return (
    <SubmitButton
      confirmIf={(form) => {
        const kw = (form.elements.namedItem("keywords") as HTMLInputElement | null)?.value ?? "";
        return kw.trim() ? null : WARN_MESSAGE;
      }}
    >
      {children}
    </SubmitButton>
  );
}
