"use client";

import { BellOff } from "lucide-react";
import { useState } from "react";
import { NotifyEnableButton } from "./push-controls";

/**
 * 通知がオフ（サーバー側に有効な購読が無い）のとき、ホーム画面に常時表示する警告。
 * NotifyNag（ポップアップ・standalone限定・セッション中1回）とは別物で、こちらは
 * モーダルではなく、オンにするまでページ内に残り続ける（ユーザー指定: 「ポップアップ
 * じゃなくて良い」。はじめかたカードが消えたあとも、通知だけオフに戻った人に気づかせる）。
 */
export function NotifyOffBanner({ publicKey }: { publicKey: string | null }) {
  const [enabled, setEnabled] = useState(false);
  if (enabled) return null;
  return (
    <section
      data-coach="notify-off-banner"
      className="rounded-2xl border border-warn/30 bg-warn-soft p-4"
    >
      <p className="flex items-center gap-1 text-sm font-medium text-warn">
        <BellOff aria-hidden className="h-4 w-4" />
        通知がオフになっています
      </p>
      <p className="mt-1 text-xs text-warn/80">
        新しい予定の通知や、準備・未来の自分へのメッセージの先回りリマインドが届きません。
      </p>
      <div className="mt-3">
        <NotifyEnableButton publicKey={publicKey} onEnabled={() => setEnabled(true)} />
      </div>
    </section>
  );
}
