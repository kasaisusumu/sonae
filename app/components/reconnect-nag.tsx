"use client";

import { useState } from "react";

/**
 * Google カレンダーとの連携が切れている間、アプリを開くたびに必ず出す
 * 大きな全画面ポップアップ（ユーザー指摘により2026-10-23:「再接続のお知らせは
 * アプリを開いた瞬間に画面にデカデカとポップアップを作って、再接続画面に即誘導する
 * ようにして。再接続されてないアカウントには常にそれをするようにして」）。
 *
 * - `NotifyNag`（通知オフの案内）とは異なり、**セッション中は出さない的な抑制を
 *   一切持たない**。再接続されるまで、ページを開く・移動するたびに出す。
 * - 「あとで」ボタンは今回の表示だけ閉じる（何も保存しない）。次にこのページを
 *   開いたとき・別のページに移動したときは、`syncError` が残っている限り再び出る。
 * - 連携解除（ログアウト等と違い、そもそも連携していない）のときは出さない
 *   （`hasAccount` で判定。再接続ボタンの行き先は連携時と同じ `/api/auth/google`）。
 */
export function ReconnectNag({
  syncError,
  hasAccount,
}: {
  syncError: string | null;
  hasAccount: boolean;
}) {
  const [dismissed, setDismissed] = useState(false);

  if (!hasAccount || !syncError || dismissed) return null;

  return (
    <div
      data-mm-reconnect-nag
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4"
    >
      <div className="w-full max-w-sm rounded-2xl bg-surface p-6 text-center shadow-2xl">
        <p aria-hidden className="text-4xl">
          ⚠️
        </p>
        <h2 className="mt-2 text-lg font-bold text-foreground">
          Google カレンダーとの連携が切れています
        </h2>
        <p className="mt-2 text-sm text-muted">
          新しい予定が取り込めなくなっています。再接続すると元どおり使えます。
        </p>

        <a
          href="/api/auth/google"
          className="mt-5 block w-full rounded-xl bg-foreground px-4 py-3 text-base font-semibold text-white no-underline shadow-sm"
        >
          今すぐ再接続する
        </a>

        <button
          type="button"
          onClick={() => setDismissed(true)}
          className="mt-3 text-xs text-muted hover:text-foreground"
        >
          あとで（次に開くとまた表示されます）
        </button>
      </div>
    </div>
  );
}
