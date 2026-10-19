"use client";

import { useEffect, useState } from "react";
import { dismissScopeHint, trackFeatureUse } from "@/app/actions";
import { ScopeChip } from "@/app/components/scope-chip";

/**
 * 「次回の出し方」（準備リストの項目・未来の自分へのメッセージ、共通の3択）の説明を、
 * 予定詳細を開くたびに自動で出す（desc-link-hint.tsx と同じ方式）。
 * 「今後表示しない」にチェックを入れて OK を押すまでは、開くたびに毎回表示する。
 * 表示するかどうか（＝ まだ「今後表示しない」していないか）は
 * サーバー側（app/events/[id]/page.tsx）で判定し、show で渡す。
 * data-mm-scopehint: desc-link-hint.tsx と同じ理由で、他のポップアップ（PageCoach 等）に
 * 「開いている間は待って」と伝える目印（ユーザー指摘により2026-10-19追加）。
 */
export function ScopeHint({ show }: { show: boolean }) {
  const [open, setOpen] = useState(show);
  const [dontShowAgain, setDontShowAgain] = useState(false);

  useEffect(() => {
    if (show) void trackFeatureUse("popup:scope-hint:shown");
  }, [show]);

  if (!open) return null;

  function close() {
    if (dontShowAgain) {
      void dismissScopeHint();
    }
    setOpen(false);
  }

  return (
    <div
      data-mm-scopehint
      className="fixed inset-0 z-[58] flex items-center justify-center bg-black/45 p-4"
      onClick={close}
    >
      <div
        className="max-h-[85vh] w-full max-w-sm overflow-y-auto rounded-2xl bg-surface p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-base font-semibold text-foreground">
          「次回の出し方」の3つのボタン
        </h2>
        <div className="mt-3 space-y-1 text-sm leading-relaxed text-muted">
          <p>
            <ScopeChip scope="event_only" status="chosen" />
          </p>
          <p className="mb-2.5 text-[13px]">
            この予定の中だけ。次回以降の予定には影響しません。例えば「ホテルに電話する」
            のような、この予定限定の内容に向いています。
          </p>

          <p>
            <ScopeChip scope="similar" status="chosen" />
          </p>
          <p className="mb-2.5 text-[13px]">
            日時や長さではなく、用途が同じ種類の予定（例: バスも新幹線も「移動」）でも
            同じように出す／出さないようにします。種類はAIが自動で判断します。例えば
            「新幹線のチケットを確認」なら、バス移動・飛行機移動の予定にも同じように
            出るようにできます。
          </p>

          <p>
            <ScopeChip scope="keyword" status="chosen" />
          </p>
          <p className="mb-2.5 text-[13px]">
            この予定の名前から自動でキーワードを決めて、次にそのキーワードを含む予定が
            来たときだけ出す／出さないようにします。例えば「田中さんと商談」なら
            キーワード「田中さん」が決まり、次に「田中さん」を含む予定が来たときだけ
            出ます。
          </p>

          <p className="text-[13px]">
            タップするだけですぐ切り替わります。∨ を開くとキーワードを直せます。
          </p>
        </div>
        <label className="mt-4 flex items-center gap-2 text-xs text-muted">
          <input
            type="checkbox"
            checked={dontShowAgain}
            onChange={(e) => setDontShowAgain(e.target.checked)}
            className="accent-[var(--foreground)]"
          />
          今後表示しない
        </label>
        <div className="mt-3 flex justify-end">
          <button
            type="button"
            onClick={close}
            className="rounded-lg bg-foreground px-4 py-2 text-sm font-semibold text-white"
          >
            OK
          </button>
        </div>
      </div>
    </div>
  );
}
