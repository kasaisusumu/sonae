"use client";

import { useState, useTransition } from "react";
import {
  createMessageForEventAction,
  removeMessageFromEventAction,
  updateFutureMessageAction,
} from "@/app/actions";
import { ConfirmButton } from "@/app/components/confirm-button";
import { SubmitButton } from "@/app/components/submit-button";
import { AutosaveIndicator } from "@/app/components/autosave-indicator";

export type EMRow = {
  id: string; // EventFutureMessage.id
  messageId: string;
  body: string;
  keywords: string[];
  genres: string[];
  scope: string;
  matchReason: string | null;
};

const SCOPE_LABEL: Record<string, string> = {
  keyword: "キーワード一致のみ",
  similar: "似た予定で提案",
  once: "今回だけ",
};

/** 1 行ぶんの編集フォーム（本文・キーワード・ジャンル・scope）＋この予定から外す。 */
function RowEditForm({ eventId, r }: { eventId: string; r: EMRow }) {
  const [body, setBody] = useState(r.body);
  const [keywords, setKeywords] = useState(r.keywords.join("、"));
  const [genres, setGenres] = useState(r.genres.join("、"));
  const [scope, setScope] = useState(r.scope);
  const [pending, start] = useTransition();

  function buildFd(): FormData {
    const fd = new FormData();
    fd.set("id", r.messageId);
    fd.set("eventId", eventId);
    fd.set("body", body);
    fd.set("keywords", keywords);
    fd.set("genres", genres);
    fd.set("scope", scope);
    return fd;
  }
  function flush() {
    if (pending) return;
    start(() => updateFutureMessageAction(buildFd()));
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
      <input
        value={keywords}
        onChange={(e) => setKeywords(e.target.value)}
        onBlur={flush}
        placeholder="キーワード（読点区切り。例: 田中、A社）"
        className="w-full rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground"
      />
      <input
        value={genres}
        onChange={(e) => setGenres(e.target.value)}
        onBlur={flush}
        placeholder="ジャンル（〇〇系。読点区切り）"
        className="w-full rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground"
      />
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
        <select
          value={scope}
          onChange={(e) => {
            setScope(e.target.value);
            start(() => updateFutureMessageAction(buildFd()));
          }}
          className="rounded-md border bg-background px-1.5 py-1 text-xs text-foreground"
          aria-label="一致条件"
        >
          <option value="keyword">キーワード一致のみ</option>
          <option value="similar">似た予定で提案</option>
          <option value="once">今回だけ</option>
        </select>
        <span className="text-[11px] text-muted">
          {pending ? "保存中…" : "変更は自動保存"}
        </span>
      </div>
      <form action={removeMessageFromEventAction}>
        <input type="hidden" name="eventId" value={eventId} />
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

export function FutureMessageEditor({
  eventId,
  initial,
}: {
  eventId: string;
  initial: EMRow[];
}) {
  const [openIds, setOpenIds] = useState<Set<string>>(() => new Set());
  const [adding, setAdding] = useState(false);
  const toggle = (id: string) =>
    setOpenIds((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div
      data-coach="future-message"
      className="rounded-2xl border border-teal/30 bg-teal-soft p-3"
    >
      <div className="mb-1.5 flex items-baseline gap-2">
        <h3 className="text-sm font-semibold text-teal-dark">💌 未来の自分へ</h3>
        <span className="text-xs text-teal-dark/70 tabular-nums">
          {initial.length}
        </span>
      </div>

      {initial.length > 0 && (
        <ul className="space-y-1">
          {initial.map((r) => {
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
                {r.matchReason && !open && (
                  <p className="ml-0.5 mt-0.5 text-[11px] text-muted">
                    {r.matchReason} ・ {SCOPE_LABEL[r.scope] ?? r.scope}
                  </p>
                )}
                {open && (
                  <div className="mt-1.5 space-y-1 rounded-lg bg-background/60 p-2">
                    {r.matchReason && (
                      <p className="text-[11px] text-muted">
                        なぜ出ているか: {r.matchReason}
                      </p>
                    )}
                    <RowEditForm eventId={eventId} r={r} />
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {adding && (
        <form
          action={createMessageForEventAction}
          className="mt-2 space-y-2 rounded-lg bg-background/60 p-2"
        >
          <input type="hidden" name="eventId" value={eventId} />
          <textarea
            name="body"
            required
            rows={2}
            placeholder="次に思い出したいこと（例: 前回のギブアンドテイクを忘れない）"
            className="w-full rounded-md border border-border bg-background px-2 py-1 text-sm"
          />
          <input
            name="keywords"
            placeholder="キーワード（読点区切り・任意）"
            className="w-full rounded-md border bg-background px-2 py-1 text-xs"
          />
          <input
            name="genres"
            placeholder="ジャンル（〇〇系。読点区切り・任意）"
            className="w-full rounded-md border bg-background px-2 py-1 text-xs"
          />
          <div className="flex flex-wrap items-center gap-2">
            <SubmitButton>追加する</SubmitButton>
            <button
              type="button"
              onClick={() => setAdding(false)}
              className="text-xs text-muted underline hover:text-foreground"
            >
              取消
            </button>
          </div>
        </form>
      )}

      <div className="mt-2">
        <button
          type="button"
          onClick={() => setAdding((v) => !v)}
          className="rounded-md border border-foreground bg-foreground px-3 py-1.5 text-xs font-medium text-surface hover:opacity-90"
        >
          ＋ 追加
        </button>
      </div>
      <p className="mt-1.5 text-[11px] text-muted">文言・追加・削除は自動保存</p>
    </div>
  );
}
