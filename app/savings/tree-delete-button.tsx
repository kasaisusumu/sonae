"use client";

import { useState, useTransition } from "react";
import { deleteCategory, forgetLearnedEvent } from "@/app/actions";

/**
 * <details><summary> の中に置く削除ボタンの土台。
 * summary 内をクリックすると本来は details の開閉トグルが起きるので、
 * click の既定動作を止めて（トグルもフォーム送信も両方止まる）、代わりに
 * ここで直接 confirm → サーバーアクション呼び出しまで行う
 * （ConfirmButton の「送信ボタン＋confirm でキャンセル時だけ preventDefault」方式は
 * summary の中では使えない）。
 */
function DeleteButton({
  message,
  onConfirm,
}: {
  message: string;
  onConfirm: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [gone, setGone] = useState(false);
  if (gone) return null;

  return (
    <button
      type="button"
      disabled={pending}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        if (!window.confirm(message)) return;
        setGone(true);
        startTransition(onConfirm);
      }}
      className="shrink-0 rounded-md border border-border px-2 py-0.5 text-[11px] text-muted hover:border-warn hover:bg-warn-soft hover:text-warn disabled:opacity-60"
    >
      削除
    </button>
  );
}

/** カテゴリ削除。予定・失敗ログはカテゴリ無し（その他扱い）になるだけで消えない。 */
export function DeleteCategoryButton({
  categoryId,
  categoryName,
}: {
  categoryId: string;
  categoryName: string;
}) {
  return (
    <DeleteButton
      message={`カテゴリ「${categoryName}」を削除しますか？\nこのカテゴリの予定・失敗ログは消えず「その他」扱いになります。学習した内容（このカテゴリだけのルール）は削除されます。`}
      onConfirm={() => deleteCategory(categoryId)}
    />
  );
}

/**
 * 樹形図の「学習された予定」を削除（学習前の状態に戻す）。
 * 実際の予定・準備リストの中身は消えない。まとめられた同名グループも一緒に対象にする。
 */
export function DeleteLearnedEventButton({
  eventIds,
}: {
  eventIds: string[];
}) {
  return (
    <DeleteButton
      message={`この学習内容を削除しますか？\n一覧から消えますが、予定自体の準備リストの中身は消えません（未確認の状態に戻ります）。`}
      onConfirm={() => forgetLearnedEvent(eventIds)}
    />
  );
}
