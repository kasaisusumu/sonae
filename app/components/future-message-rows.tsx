"use client";

import { useState, useTransition } from "react";
import { X } from "lucide-react";
import {
  removeMessageFromEventAction,
  updateFutureMessageAction,
  toggleFutureMessageDoneAction,
} from "@/app/actions";
import { ConfirmButton } from "@/app/components/confirm-button";
import {
  ScopeQuickToggle,
  ScopeEmojiToggle,
  KeywordSentenceField,
  MESSAGE_QUICK_SCOPES,
  type QuickScope,
} from "@/app/components/scope-picker";

/**
 * 予定に結びついた「未来の自分へ」1 件ぶん。予定詳細・学習内容（マニュアル）の両方で
 * 同じ編集欄を使う。status は shown / confirmed / skipped（removed は出さない）。
 */
export type EMRow = {
  id: string; // EventFutureMessage.id
  eventId: string;
  messageId: string;
  body: string;
  keywords: string[];
  genres: string[];
  categoryIds: string[];
  scope: string;
  status: string;
  matchReason: string | null;
  eventTitle: string;
  /** 予定が済んでいるか。 */
  eventEnded: boolean;
  /** 準備リストの項目と同じ「チェックで完了」。次回の提案・一致判定には影響しない。 */
  isDone: boolean;
};

/** FutureMessage.scope は "keyword"|"similar"|"once" を取りうるが、この枠では
 * 「今回だけ」(once) は使わない（先の予定のための機能だから）ので keyword に畳む。 */
function toQuickScope(scope: string): QuickScope {
  return scope === "similar" ? "similar" : "keyword";
}

const REMOVE_CONFIRM_MESSAGE =
  "この予定からだけ外します。次回以降は、キーワードが一致すればまた表示されます。よろしいですか？";

/** 準備リストの項目と同じ並び順にする: 未完了が上、完了が下（元の順序はそれぞれ維持）。 */
function sortByDone(rows: EMRow[]): EMRow[] {
  return [...rows].sort((a, b) => Number(a.isDone) - Number(b.isDone));
}

/**
 * 1 件ぶんの行。準備リストの項目行（checklist-editor.tsx）と同じ見た目・操作にしている
 * （チェック・本文・✕・∨・次回の出し方の小さいボタン）。違いは三択ではなく二択
 * （「今回だけ」は無い）だけ（ユーザー指摘により2026-10-19）。
 */
function MessageRow({
  r,
  open,
  onToggleOpen,
  onToggleDone,
}: {
  r: EMRow;
  open: boolean;
  onToggleOpen: () => void;
  onToggleDone: (next: boolean) => void;
}) {
  const [body, setBody] = useState(r.body);
  const [scope, setScope] = useState<QuickScope>(toQuickScope(r.scope));
  const [keyword, setKeyword] = useState(r.keywords.join("、"));
  const [scopePopupOpen, setScopePopupOpen] = useState(false);
  const [scopeHintOpen, setScopeHintOpen] = useState(false);
  const [pending, start] = useTransition();

  function buildFd(next: { body?: string; scope?: QuickScope; keywords?: string }): FormData {
    const fd = new FormData();
    fd.set("id", r.messageId);
    fd.set("eventId", r.eventId);
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
        <input
          type="checkbox"
          checked={r.isDone}
          onChange={(e) => onToggleDone(e.target.checked)}
          className="mt-1 h-5 w-5 shrink-0 accent-[var(--teal)]"
          aria-label="完了"
        />
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onBlur={flushBody}
          rows={1}
          placeholder="次に思い出したいこと"
          className={`block min-w-0 flex-1 resize-none overflow-hidden rounded-md border border-transparent bg-transparent px-1 py-0.5 text-lg leading-snug [field-sizing:content] hover:border-border focus:border-border focus:bg-background ${
            r.isDone ? "text-muted line-through" : ""
          }`}
        />
        <span className="mt-0.5 flex shrink-0 flex-row-reverse flex-wrap items-center gap-0.5">
          <form action={removeMessageFromEventAction} className="contents">
            <input type="hidden" name="eventId" value={r.eventId} />
            <input type="hidden" name="messageId" value={r.messageId} />
            <ConfirmButton
              message={REMOVE_CONFIRM_MESSAGE}
              aria-label="この予定から外す"
              className="shrink-0 rounded-full border border-border px-1.5 py-1 text-xs text-muted hover:border-warn hover:text-warn"
            >
              <X aria-hidden className="h-3.5 w-3.5" />
            </ConfirmButton>
          </form>
          <button
            type="button"
            onClick={onToggleOpen}
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
        </div>
      )}

      {!open && r.matchReason && (
        <p className="ml-6 truncate text-[11px] text-muted">{r.matchReason}</p>
      )}
    </li>
  );
}

/** 予定に結びついたメッセージの一覧。1 件ずつ開いて、いつでも編集できる。 */
export function FutureMessageRows({ rows }: { rows: EMRow[] }) {
  const [openKeys, setOpenKeys] = useState<Set<string>>(() => new Set());
  const [doneOverride, setDoneOverride] = useState<Record<string, boolean>>({});
  const toggle = (id: string) =>
    setOpenKeys((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  if (rows.length === 0) return null;
  const sorted = sortByDone(
    rows.map((r) => ({ ...r, isDone: doneOverride[r.id] ?? r.isDone })),
  );
  return (
    <ul className="divide-y divide-border/70">
      {sorted.map((r) => (
        <MessageRow
          key={r.id}
          r={r}
          open={openKeys.has(r.id)}
          onToggleOpen={() => toggle(r.id)}
          onToggleDone={(next) => {
            setDoneOverride((prev) => ({ ...prev, [r.id]: next }));
            void toggleFutureMessageDoneAction(r.id, next);
          }}
        />
      ))}
    </ul>
  );
}
