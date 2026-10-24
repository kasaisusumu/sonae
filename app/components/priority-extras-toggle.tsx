"use client";

import { useState, useTransition } from "react";
import { setPriorityExtrasEnabledAction } from "@/app/actions";
import { InfoHint } from "@/app/components/info-hint";

/**
 * ver2.1（急ぎ/そのうちタグ・ホーム一覧・ショートカット連携一式）のON/OFF
 * （2026-10-24追加）。ver1/ver2の`FeatureModeToggle`とは独立した別スイッチで、
 * どちらのモードでもON/OFFを選べる（ユーザー指定: 「ver2は、今までの本番環境の
 * ver2の機能と同じで」＝ver2自体には手を加えず、これらの機能はver2.1という
 * 別の追加ボタンにする）。ver1/ver2のような変換処理は無い単純な真偽値。
 */
export function PriorityExtrasToggle({ current }: { current: boolean }) {
  const [enabled, setEnabled] = useState(current);
  const [pending, startTransition] = useTransition();

  function toggle() {
    if (pending) return;
    const next = !enabled;
    startTransition(async () => {
      await setPriorityExtrasEnabledAction(next);
      setEnabled(next);
    });
  }

  return (
    <div className="mt-2 flex flex-wrap items-center gap-2">
      <button
        type="button"
        disabled={pending}
        onClick={toggle}
        aria-pressed={enabled}
        className={`rounded-lg border px-4 py-2 text-sm font-medium transition-colors disabled:opacity-50 ${
          enabled
            ? "border-teal bg-teal-soft text-teal-dark"
            : "border-border bg-surface text-muted hover:border-teal/50"
        }`}
      >
        ver2.1{enabled ? "（ON）" : "（OFF）"}
      </button>
      {pending && <span className="text-xs text-muted">切替中…</span>}
      <InfoHint id="priority-extras-toggle">
        <p className="mb-2 text-sm font-semibold text-foreground">ver2.1とは</p>
        <ul className="space-y-1.5 text-[13px]">
          <li>ver1・ver2のどちらでもON/OFFを選べる、追加の機能一式です</li>
          <li>
            🔥急ぎ／🕒そのうちタグ、ホーム画面の一覧、予定に紐づかない項目の追加、
            完了した項目コーナー、iPhoneショートカット連携（概要API・ロック画面壁紙）
          </li>
          <li>OFFにしても、すでに付けたタグ・追加した項目は消えません（表示されないだけ）</li>
        </ul>
      </InfoHint>
    </div>
  );
}
