"use client";

import { useState, useTransition } from "react";
import {
  issueShortcutTokenAction,
  revokeShortcutTokenAction,
  type ShortcutTokenRow,
} from "@/app/actions";
import { formatDateTime } from "@/lib/format";
import { InfoHint } from "@/app/components/info-hint";

/**
 * /settings の「ショートカット用トークン」欄。発行直後だけ生のトークンを表示する
 * （以後は二度と表示しない。保存はハッシュだけ・lib/shortcut-token.ts）。
 */
export function ShortcutTokenPanel({ initial }: { initial: ShortcutTokenRow[] }) {
  const [tokens, setTokens] = useState(initial);
  const [justIssued, setJustIssued] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [pending, startTransition] = useTransition();

  async function copyToken() {
    if (!justIssued) return;
    try {
      await navigator.clipboard.writeText(justIssued);
      setCopied(true);
    } catch {
      /* クリップボード権限が無い環境もある。コピー自体は失敗しても致命的ではない */
    }
  }

  function issue() {
    startTransition(async () => {
      const res = await issueShortcutTokenAction();
      setJustIssued(res.token);
      setTokens((prev) => [
        {
          id: res.id,
          label: null,
          createdAt: new Date(),
          lastUsedAt: null,
          revokedAt: null,
        },
        ...prev,
      ]);
    });
  }

  function revoke(id: string) {
    setTokens((prev) =>
      prev.map((t) => (t.id === id ? { ...t, revokedAt: new Date() } : t)),
    );
    startTransition(() => revokeShortcutTokenAction(id));
  }

  const active = tokens.filter((t) => !t.revokedAt);

  return (
    <div className="space-y-3">
      <h2 className="flex items-center gap-1.5 text-sm font-semibold text-muted">
        ショートカット用トークン
        <InfoHint id="settings-shortcut-token">
          <p className="mb-2 text-sm">
            iPhoneの「ショートカット」アプリから、次の予定と準備リスト・「急ぎ」
            「そのうち」をテキストで取得できるAPIのトークンです。
          </p>
          <p className="text-[13px] text-muted">
            発行した直後だけ画面に表示します（以後は二度と表示できません。
            無くした場合は新しく発行し直してください）。
          </p>
        </InfoHint>
      </h2>

      {justIssued && (
        <div className="rounded-lg border border-teal/40 bg-teal-soft p-3">
          <p className="text-xs font-semibold text-teal-dark">
            発行しました。今だけ表示します（この画面を閉じると二度と見られません）。
          </p>
          <code className="mt-1.5 block break-all rounded bg-background px-2 py-1.5 text-xs">
            {justIssued}
          </code>
          <div className="mt-1.5 flex items-center gap-3">
            <button
              type="button"
              onClick={copyToken}
              className="rounded-md border border-border px-2 py-1 text-[11px] text-foreground hover:border-teal hover:text-teal-dark"
            >
              {copied ? "コピーしました" : "コピー"}
            </button>
            <button
              type="button"
              onClick={() => {
                setJustIssued(null);
                setCopied(false);
              }}
              className="text-[11px] text-muted underline hover:text-foreground"
            >
              閉じる
            </button>
          </div>
        </div>
      )}

      {active.length > 0 && (
        <ul className="space-y-1.5 text-sm">
          {active.map((t) => (
            <li
              key={t.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-surface-muted px-3 py-2"
            >
              <span className="text-xs text-muted">
                発行: {formatDateTime(t.createdAt)}
                {t.lastUsedAt ? ` ／ 最終利用: ${formatDateTime(t.lastUsedAt)}` : " ／ 未使用"}
              </span>
              <button
                type="button"
                onClick={() => {
                  if (
                    window.confirm(
                      "このトークンを無効化します。以後このトークンでは取得できなくなります。よろしいですか？",
                    )
                  ) {
                    revoke(t.id);
                  }
                }}
                className="rounded-md border border-border px-2 py-1 text-xs text-muted hover:border-warn hover:text-warn"
              >
                無効化
              </button>
            </li>
          ))}
        </ul>
      )}

      <button
        type="button"
        onClick={issue}
        disabled={pending}
        className="rounded-lg bg-surface-muted px-4 py-2 text-sm font-medium hover:bg-border disabled:opacity-50"
      >
        {active.length > 0 ? "新しく発行する（再発行）" : "発行する"}
      </button>
    </div>
  );
}
