"use client";

import { useState, useTransition } from "react";
import {
  archiveFutureMessageAction,
  deleteFutureMessageAction,
  updateFutureMessageAction,
} from "@/app/actions";
import { formatDateOnly } from "@/lib/format";
import { ConfirmButton } from "@/app/components/confirm-button";
import {
  ScopeQuickToggle,
  ScopeEmojiToggle,
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

/**
 * 準備リストの項目行（checklist-editor.tsx）と同じ見た目・操作（本文・∨・次回の出し方の
 * 小さいボタン）。違いは三択ではなく二択（「今回だけ」は無い）だけ
 * （ユーザー指摘により2026-10-19）。
 */
function EditableRow({ m }: { m: MLMessage }) {
  const [open, setOpen] = useState(false);
  const [body, setBody] = useState(m.body);
  const [scope, setScope] = useState<QuickScope>(toQuickScope(m.scope));
  const [keyword, setKeyword] = useState(m.keywords.join("、"));
  const [scopePopupOpen, setScopePopupOpen] = useState(false);
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
    <li className="py-1.5">
      <div className="flex items-start gap-2">
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onBlur={flushBody}
          rows={1}
          className="block min-w-0 flex-1 resize-none overflow-hidden rounded-md border border-transparent bg-transparent px-1 py-0.5 text-lg leading-snug [field-sizing:content] hover:border-border focus:border-border focus:bg-background"
        />
        {m.confirmedCount > 0 && (
          <span className="mt-1.5 shrink-0 text-[11px] text-muted">{m.confirmedCount}回更新</span>
        )}
        <span className="mt-0.5 flex shrink-0 flex-row-reverse flex-wrap items-center gap-0.5">
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            aria-label={open ? "詳細を閉じる" : "詳細を開く"}
            className={`shrink-0 rounded-md border px-1.5 py-1 text-sm leading-none transition-colors ${
              open
                ? "border-teal bg-teal-soft text-teal-dark"
                : "border-border text-muted hover:border-teal hover:text-teal-dark"
            }`}
          >
            {open ? "∧" : "∨"}
          </button>
          <ScopeEmojiToggle
            value={scope}
            onChange={chooseScope}
            open={scopePopupOpen}
            onOpenChange={setScopePopupOpen}
            hintOpen={scopeHintOpen}
            onHintOpenChange={setScopeHintOpen}
            className="mt-0"
            scopes={MESSAGE_QUICK_SCOPES}
          />
        </span>
      </div>

      {open && (
        <div className="ml-6 mt-1.5 space-y-2 rounded-lg bg-background/60 p-2">
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
        <ul className="mt-2 divide-y divide-border/70">
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
