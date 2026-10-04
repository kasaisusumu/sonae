"use client";

import { useState, useTransition } from "react";
import {
  removeMessageFromEventAction,
  updateFutureMessageAction,
} from "@/app/actions";
import { ConfirmButton } from "@/app/components/confirm-button";
import { AutosaveIndicator } from "@/app/components/autosave-indicator";
import { ReopenableReview } from "@/app/components/message-review-reopen";
import { ScopeChip, messageScopeToItemScope } from "@/app/components/scope-chip";

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

export type CategoryOption = { id: string; name: string };

/** 1 件ぶんの編集フォーム（本文・キーワード・ジャンル・カテゴリ・一致条件）＋この予定から外す。 */
function RowEditForm({
  r,
  categoryOptions,
}: {
  r: EMRow;
  categoryOptions: CategoryOption[];
}) {
  const [body, setBody] = useState(r.body);
  const [keywords, setKeywords] = useState(r.keywords.join("、"));
  const [genres, setGenres] = useState(r.genres.join("、"));
  const [scope, setScope] = useState(r.scope);
  const [categoryIds, setCategoryIds] = useState<Set<string>>(
    () => new Set(r.categoryIds),
  );
  const [pending, start] = useTransition();

  // 押した時点の値をそのまま送る（チェックボックスは次の state を渡して即保存する）
  function buildFd(next?: { scope?: string; categoryIds?: Set<string> }): FormData {
    const fd = new FormData();
    fd.set("id", r.messageId);
    fd.set("eventId", r.eventId);
    fd.set("body", body);
    fd.set("keywords", keywords);
    fd.set("genres", genres);
    fd.set("scope", next?.scope ?? scope);
    for (const c of next?.categoryIds ?? categoryIds) fd.append("categoryIds", c);
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
      {categoryOptions.length > 0 && (
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted">
          <span>カテゴリ指定</span>
          {categoryOptions.map((c) => (
            <label key={c.id} className="flex items-center gap-1">
              <input
                type="checkbox"
                checked={categoryIds.has(c.id)}
                onChange={(e) => {
                  const next = new Set(categoryIds);
                  if (e.target.checked) next.add(c.id);
                  else next.delete(c.id);
                  setCategoryIds(next);
                  start(() => updateFutureMessageAction(buildFd({ categoryIds: next })));
                }}
              />
              {c.name}
            </label>
          ))}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
        <select
          value={scope}
          onChange={(e) => {
            setScope(e.target.value);
            start(() => updateFutureMessageAction(buildFd({ scope: e.target.value })));
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
export function FutureMessageRows({
  rows,
  categoryOptions,
}: {
  rows: EMRow[];
  categoryOptions: CategoryOption[];
}) {
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
            {!open && (r.matchReason || r.status === "confirmed") && (
              <p className="ml-0.5 mt-0.5 text-[11px] text-muted">
                {r.status === "confirmed" && (
                  <span className="mr-1 rounded bg-surface-muted px-1 text-teal-dark">
                    確定済み
                  </span>
                )}
                {r.matchReason && `${r.matchReason} ・ `}
                <ScopeChip scope={messageScopeToItemScope(r.scope)} />
              </p>
            )}
            {r.eventEnded && (
              <div className="mt-1">
                <ReopenableReview
                  linkId={r.id}
                  eventTitle={r.eventTitle}
                  categoryOptions={categoryOptions}
                />
              </div>
            )}
            {open && (
              <div className="mt-1.5 space-y-1 rounded-lg bg-background/60 p-2">
                {r.matchReason && (
                  <p className="text-[11px] text-muted">なぜ出ているか: {r.matchReason}</p>
                )}
                <RowEditForm key={r.id} r={r} categoryOptions={categoryOptions} />
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
