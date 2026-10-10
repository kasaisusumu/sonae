"use client";

import { useState, useTransition } from "react";
import {
  removeMessageFromEventAction,
  updateFutureMessageAction,
} from "@/app/actions";
import { ConfirmButton } from "@/app/components/confirm-button";
import { AutosaveIndicator } from "@/app/components/autosave-indicator";
import { ReopenableReview } from "@/app/components/message-review-reopen";
import { ScopeQuickToggle, KeywordSentenceField } from "@/app/components/scope-picker";

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
  /** 予定が済んでいるか。済んでいれば振り返り（AI 提案つき）をいつでも開ける。 */
  eventEnded: boolean;
};

/** 行に常時表示する、次回の出し方の2択（詳細を開かなくてもすぐ切り替えられる）。 */
function MessageQuickToggle({ r }: { r: EMRow }) {
  const [pending, start] = useTransition();
  function choose(sc: "event_only" | "similar") {
    const next = sc === "event_only" ? "once" : "similar";
    const fd = new FormData();
    fd.set("id", r.messageId);
    fd.set("eventId", r.eventId);
    fd.set("body", r.body);
    fd.set("keywords", r.keywords.join("、"));
    fd.set("genres", "");
    fd.set("scope", next);
    start(() => updateFutureMessageAction(fd));
  }
  return (
    <ScopeQuickToggle
      value={r.scope === "once" ? "event_only" : r.scope === "similar" ? "similar" : "keyword"}
      onChange={choose}
      disabled={pending}
    />
  );
}

/** 開いたときの編集フォーム（本文・任意でキーワードを文章形式で）＋この予定から外す。 */
function RowEditForm({ r }: { r: EMRow }) {
  const [body, setBody] = useState(r.body);
  const [keywords, setKeywords] = useState(r.keywords.join("、"));
  const [scope, setScope] = useState(r.scope);
  const [pending, start] = useTransition();

  function buildFd(next?: { scope?: string; keywords?: string }): FormData {
    const fd = new FormData();
    fd.set("id", r.messageId);
    fd.set("eventId", r.eventId);
    fd.set("body", body);
    fd.set("keywords", next?.keywords ?? keywords);
    fd.set("genres", "");
    fd.set("scope", next?.scope ?? scope);
    return fd;
  }
  function flush() {
    if (pending) return;
    start(() => updateFutureMessageAction(buildFd()));
  }
  function commitKeyword(kw: string) {
    setKeywords(kw);
    setScope("keyword");
    start(() => updateFutureMessageAction(buildFd({ scope: "keyword", keywords: kw })));
  }
  function clearKeyword() {
    setKeywords("");
    setScope("once");
    start(() => updateFutureMessageAction(buildFd({ scope: "once", keywords: "" })));
  }

  return (
    <div className="space-y-1.5">
      <AutosaveIndicator show={pending} />
      <textarea
        rows={2}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        onBlur={flush}
        className="w-full rounded-md border border-border bg-background px-2 py-1 text-sm text-foreground"
        aria-label="メッセージ本文"
      />
      <KeywordSentenceField
        initialKeyword={scope === "keyword" ? keywords : ""}
        onCommit={commitKeyword}
        onClear={clearKeyword}
        pending={pending}
      />
      <p className="text-[11px] text-muted">
        {pending ? "保存中…" : "変更は自動保存"}
      </p>
      <form action={removeMessageFromEventAction}>
        <input type="hidden" name="eventId" value={r.eventId} />
        <input type="hidden" name="messageId" value={r.messageId} />
        <ConfirmButton
          message="この予定からだけ外します。次回以降は、設定（キーワード等）に一致すればまた表示されます。よろしいですか？"
          className="text-[11px] text-muted underline hover:text-warn"
        >
          この予定から外す
        </ConfirmButton>
      </form>
    </div>
  );
}

/** 予定に結びついたメッセージの一覧。1 件ずつ開いて、いつでも編集できる。 */
export function FutureMessageRows({ rows }: { rows: EMRow[] }) {
  const [openIds, setOpenIds] = useState<Set<string>>(() => new Set());
  const toggle = (id: string) =>
    setOpenIds((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  if (rows.length === 0) return null;
  return (
    <ul className="space-y-1">
      {rows.map((r) => {
        const open = openIds.has(r.id);
        return (
          <li key={r.id} className="rounded-lg bg-surface px-2 py-1.5">
            <div className="flex items-start gap-2">
              <span className="min-w-0 flex-1 whitespace-pre-wrap break-words py-0.5 text-sm">
                {r.body}
              </span>
              <button
                type="button"
                onClick={() => toggle(r.id)}
                aria-label={open ? "閉じる" : "編集"}
                className={`mt-0.5 shrink-0 rounded-md border px-2 py-1 text-sm leading-none ${
                  open
                    ? "border-teal bg-teal-soft text-teal-dark"
                    : "border-border text-muted hover:border-teal hover:text-teal-dark"
                }`}
              >
                {open ? "∧" : "∨"}
              </button>
            </div>
            <div className="ml-0.5 mt-1 flex flex-wrap items-center gap-1.5">
              <MessageQuickToggle r={r} />
              {r.scope === "keyword" && r.keywords.length > 0 && (
                <span className="text-[11px] text-muted">
                  🏷「{r.keywords.join("、")}」のとき
                </span>
              )}
              {r.status === "confirmed" && (
                <span className="rounded bg-surface-muted px-1 text-[11px] text-teal-dark">
                  確定済み
                </span>
              )}
            </div>
            {!open && r.matchReason && (
              <p className="ml-0.5 mt-0.5 text-[11px] text-muted">{r.matchReason}</p>
            )}
            {r.eventEnded && (
              <div className="mt-1">
                <ReopenableReview linkId={r.id} eventTitle={r.eventTitle} />
              </div>
            )}
            {open && (
              <div className="mt-1.5 space-y-1 rounded-lg bg-background/60 p-2">
                {r.matchReason && (
                  <p className="text-[11px] text-muted">なぜ出ているか: {r.matchReason}</p>
                )}
                <RowEditForm key={r.id} r={r} />
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
