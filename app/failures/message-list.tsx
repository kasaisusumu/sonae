"use client";

import { useState, useTransition } from "react";
import {
  archiveFutureMessageAction,
  deleteFutureMessageAction,
  updateFutureMessageAction,
} from "@/app/actions";
import { formatDateOnly } from "@/lib/format";
import { ConfirmButton } from "@/app/components/confirm-button";
import { AutosaveIndicator } from "@/app/components/autosave-indicator";
import {
  ScopeQuickToggle,
  KeywordSentenceField,
  MESSAGE_QUICK_SCOPES,
  type QuickScope,
} from "@/app/components/scope-picker";

/** FutureMessage.scope は "keyword"|"similar"|"once" を取りうるが、この枠では
 * 「今回だけ」(once) は使わない（先の予定のための機能だから）ので keyword に畳む。 */
function toQuickScope(scope: string): QuickScope {
  return scope === "similar" ? "similar" : "keyword";
}

export type MLMessage = {
  id: string;
  body: string;
  keywords: string[];
  genres: string[];
  categoryIds: string[];
  scope: string;
  archivedAt: Date | null;
  confirmedCount: number;
  upcomingEvents: { eventId: string; title: string; eventDatetime: Date }[];
  /** 作られたきっかけの予定名（あれば）。「この名前の予定だけ」クイック選択の自動キーワードに使う。 */
  sourceEventTitle: string | null;
};

/** 行を開く前の、次回の出し方の要約バッジ。「似た予定」のときは何に似ているか
 * （元の予定名）を書く（ユーザー指摘により2026-10-19）。 */
function ScopeSummaryBadge({ m }: { m: MLMessage }) {
  if (toQuickScope(m.scope) === "similar") {
    return (
      <span className="text-[11px] text-muted">
        🔁「{m.sourceEventTitle ?? "元の予定"}」に似た予定のとき
      </span>
    );
  }
  const kw = m.keywords.join("、");
  return kw ? (
    <span className="text-[11px] text-muted">🏷「{kw}」のとき</span>
  ) : (
    <span className="text-[11px] text-muted">キーワード未設定</span>
  );
}

/**
 * 閉じている間は文言・バッジだけの軽い表示（元の表示方法のまま）。「編集」を押したときだけ
 * 本文・次回の出し方の編集欄になる（ユーザー指摘により2026-10-19: 閉じている間から
 * 常に編集欄になっているのは分かりにくい）。
 */
function EditableRow({ m }: { m: MLMessage }) {
  const [open, setOpen] = useState(false);
  const [body, setBody] = useState(m.body);
  const [scope, setScope] = useState<QuickScope>(toQuickScope(m.scope));
  const [keyword, setKeyword] = useState(m.keywords.join("、"));
  const [scopeHintOpen, setScopeHintOpen] = useState(false);
  const [pending, start] = useTransition();

  function buildFd(next: { body?: string; scope?: QuickScope; keywords?: string }): FormData {
    const fd = new FormData();
    fd.set("id", m.id);
    fd.set("body", next.body ?? body);
    fd.set("keywords", next.keywords ?? keyword);
    fd.set("genres", "");
    fd.set("scope", next.scope ?? scope);
    return fd;
  }
  function flushBody() {
    if (pending) return;
    start(() => updateFutureMessageAction(buildFd({})));
  }
  function chooseScope(sc: QuickScope) {
    setScope(sc);
    start(() => updateFutureMessageAction(buildFd({ scope: sc })));
  }
  function commitKeyword(kw: string) {
    setKeyword(kw);
    start(() => updateFutureMessageAction(buildFd({ keywords: kw })));
  }
  function clearKeyword() {
    setKeyword("");
    start(() => updateFutureMessageAction(buildFd({ keywords: "" })));
  }

  return (
    <li className="rounded-xl bg-surface p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1 space-y-1.5">
          <p className="whitespace-pre-wrap break-words text-sm">{m.body}</p>
          <div className="flex flex-wrap items-center gap-1.5">
            <ScopeSummaryBadge m={m} />
            {m.confirmedCount > 0 && (
              <span className="text-[11px] text-muted">{m.confirmedCount}回更新</span>
            )}
          </div>
        </div>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="shrink-0 rounded-md border border-border px-2 py-1 text-xs text-muted hover:text-foreground"
        >
          {open ? "閉じる" : "編集"}
        </button>
      </div>

      {open && (
        <div className="mt-3 space-y-2 rounded-lg bg-background/60 p-3">
          <AutosaveIndicator show={pending} />
          <textarea
            rows={2}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            onBlur={flushBody}
            className="w-full rounded-md border bg-background px-2 py-1 text-sm"
          />
          <ScopeQuickToggle
            value={scope}
            onChange={chooseScope}
            hintOpen={scopeHintOpen}
            onHintOpenChange={setScopeHintOpen}
            scopes={MESSAGE_QUICK_SCOPES}
          />
          {scope === "keyword" && (
            <KeywordSentenceField
              compact
              initialKeyword={keyword}
              onCommit={commitKeyword}
              onClear={clearKeyword}
              pending={pending}
            />
          )}
          <div className="flex flex-wrap items-center gap-3 pt-1">
            <form action={archiveFutureMessageAction}>
              <input type="hidden" name="id" value={m.id} />
              <input type="hidden" name="archived" value="1" />
              <ConfirmButton
                message="このメッセージを過去に移しますか？（一覧から退避するだけで、あとで復活できます）"
                className="text-xs text-muted underline hover:text-foreground"
              >
                過去に移す
              </ConfirmButton>
            </form>
            <form action={deleteFutureMessageAction}>
              <input type="hidden" name="id" value={m.id} />
              <ConfirmButton
                message="このメッセージを完全に削除しますか？"
                className="text-xs text-muted underline hover:text-warn"
              >
                削除
              </ConfirmButton>
            </form>
          </div>
        </div>
      )}
    </li>
  );
}

export function MessageList({ messages }: { messages: MLMessage[] }) {
  const active = messages.filter((m) => !m.archivedAt);
  const archived = messages.filter((m) => m.archivedAt);
  const upcoming = active.filter((m) => m.upcomingEvents.length > 0);

  if (messages.length === 0) {
    return (
      <p className="rounded-2xl bg-surface px-4 py-10 text-center text-sm text-muted">
        まだメッセージはありません。上の「メッセージを書く」からどうぞ。
      </p>
    );
  }

  return (
    <>
      <details className="rounded-xl border border-border bg-surface p-3 [&_summary::-webkit-details-marker]:hidden">
        <summary className="cursor-pointer list-none text-xs font-semibold text-muted">
          ▸ 登録したメッセージを見る({active.length}件)
        </summary>
        <ul className="mt-2 space-y-2">
          {active.map((m) => (
            <EditableRow key={m.id} m={m} />
          ))}
        </ul>
      </details>

      {upcoming.length > 0 && (
        <details className="rounded-xl border border-border bg-surface p-3 [&_summary::-webkit-details-marker]:hidden">
          <summary className="cursor-pointer list-none text-xs font-semibold text-muted">
            ▸ これからの予定に出るメッセージを見る({upcoming.length}件)
          </summary>
          <ul className="mt-2 space-y-2">
            {upcoming.map((m) => (
              <li key={m.id} className="rounded-xl bg-surface p-4">
                <p className="whitespace-pre-wrap break-words text-sm">{m.body}</p>
                <ul className="mt-1.5 space-y-0.5 text-xs text-muted">
                  {m.upcomingEvents.map((e) => (
                    <li key={e.eventId}>
                      {formatDateOnly(e.eventDatetime)} ・「{e.title}」
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </details>
      )}

      {archived.length > 0 && (
        <details className="rounded-xl border border-border bg-surface p-3 [&_summary::-webkit-details-marker]:hidden">
          <summary className="cursor-pointer list-none text-xs font-semibold text-muted">
            ▸ 過去のメッセージを見る({archived.length}件)
          </summary>
          <ul className="mt-2 space-y-2">
            {archived.map((m) => (
              <li key={m.id} className="rounded-xl bg-surface p-4">
                <p className="whitespace-pre-wrap break-words text-sm text-muted">
                  {m.body}
                </p>
                <form action={archiveFutureMessageAction} className="mt-1.5">
                  <input type="hidden" name="id" value={m.id} />
                  <input type="hidden" name="archived" value="" />
                  <button
                    type="submit"
                    className="text-xs text-teal-dark underline hover:text-foreground"
                  >
                    復活する
                  </button>
                </form>
              </li>
            ))}
          </ul>
        </details>
      )}
    </>
  );
}
