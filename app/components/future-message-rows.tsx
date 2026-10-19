"use client";

import { useState, useTransition } from "react";
import { Tag, X } from "lucide-react";
import {
  removeMessageFromEventAction,
  updateFutureMessageAction,
  toggleFutureMessageDoneAction,
} from "@/app/actions";
import { ConfirmButton } from "@/app/components/confirm-button";
import { AutosaveIndicator } from "@/app/components/autosave-indicator";
import { ReopenableReview } from "@/app/components/message-review-reopen";
import { KeywordSentenceField } from "@/app/components/scope-picker";

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
  /** 準備リストの項目と同じ「チェックで完了」。次回の提案・一致判定には影響しない。 */
  isDone: boolean;
};

/**
 * 開いたときの編集フォーム（本文・キーワード）＋この予定から外す。
 * メッセージはキーワードを決めること自体が条件なので、項目のような「今回だけ／似た予定／
 * この名前」の3択は持たない（2026-10 にやめた）。キーワードが決まっていればそれで一致、
 * 決まっていなければ自動では一致しない（この予定への手動の「＋追加」はキーワードと無関係）。
 */
function RowEditForm({ r }: { r: EMRow }) {
  const [body, setBody] = useState(r.body);
  const [keywords, setKeywords] = useState(r.keywords.join("、"));
  const [pending, start] = useTransition();

  function buildFd(next?: { keywords?: string }): FormData {
    const fd = new FormData();
    fd.set("id", r.messageId);
    fd.set("eventId", r.eventId);
    fd.set("body", body);
    fd.set("keywords", next?.keywords ?? keywords);
    fd.set("genres", "");
    fd.set("scope", "keyword");
    return fd;
  }
  function flush() {
    if (pending) return;
    start(() => updateFutureMessageAction(buildFd()));
  }
  function commitKeyword(kw: string) {
    setKeywords(kw);
    start(() => updateFutureMessageAction(buildFd({ keywords: kw })));
  }
  function clearKeyword() {
    setKeywords("");
    start(() => updateFutureMessageAction(buildFd({ keywords: "" })));
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
        initialKeyword={keywords}
        onCommit={commitKeyword}
        onClear={clearKeyword}
        pending={pending}
      />
      <p className="text-[11px] text-muted">
        {pending ? "保存中…" : "変更は自動保存"}
      </p>
    </div>
  );
}

const REMOVE_CONFIRM_MESSAGE =
  "この予定からだけ外します。次回以降は、キーワードが一致すればまた表示されます。よろしいですか？";

/**
 * 準備リストの項目と同じ並び順にする: 未完了が上、完了が下（元の順序はそれぞれ維持）。
 */
function sortByDone(rows: EMRow[]): EMRow[] {
  return [...rows].sort((a, b) => Number(a.isDone) - Number(b.isDone));
}

/** 予定に結びついたメッセージの一覧。1 件ずつ開いて、いつでも編集できる。 */
export function FutureMessageRows({ rows }: { rows: EMRow[] }) {
  const [openIds, setOpenIds] = useState<Set<string>>(() => new Set());
  const [doneOverride, setDoneOverride] = useState<Record<string, boolean>>({});
  const toggle = (id: string) =>
    setOpenIds((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  function toggleDone(r: EMRow, next: boolean) {
    setDoneOverride((prev) => ({ ...prev, [r.id]: next }));
    void toggleFutureMessageDoneAction(r.id, next);
  }

  if (rows.length === 0) return null;
  const sorted = sortByDone(
    rows.map((r) => ({ ...r, isDone: doneOverride[r.id] ?? r.isDone })),
  );
  return (
    <ul className="space-y-1">
      {sorted.map((r) => {
        const open = openIds.has(r.id);
        return (
          <li key={r.id} className="rounded-lg bg-surface px-2 py-1.5">
            <div className="flex items-start gap-2">
              <input
                type="checkbox"
                checked={r.isDone}
                onChange={(e) => toggleDone(r, e.target.checked)}
                className="mt-1 h-5 w-5 shrink-0 accent-[var(--teal)]"
                aria-label="完了"
              />
              <span
                className={`min-w-0 flex-1 whitespace-pre-wrap break-words py-0.5 text-sm ${
                  r.isDone ? "text-muted line-through" : ""
                }`}
              >
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
              <form action={removeMessageFromEventAction} className="contents">
                <input type="hidden" name="eventId" value={r.eventId} />
                <input type="hidden" name="messageId" value={r.messageId} />
                <ConfirmButton
                  message={REMOVE_CONFIRM_MESSAGE}
                  aria-label="この予定から外す"
                  className="mt-0.5 shrink-0 rounded-full border border-border px-2 py-1 text-xs text-muted hover:border-warn hover:text-warn"
                >
                  <X aria-hidden className="h-3 w-3" />
                </ConfirmButton>
              </form>
            </div>
            <div className="ml-0.5 mt-1 flex flex-wrap items-center gap-1.5">
              {r.keywords.length > 0 ? (
                <span className="inline-flex items-center gap-0.5 text-[11px] text-muted">
                  <Tag aria-hidden className="h-3 w-3" />「{r.keywords.join("、")}」のとき
                </span>
              ) : (
                <span className="text-[11px] text-muted">キーワード未設定</span>
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
