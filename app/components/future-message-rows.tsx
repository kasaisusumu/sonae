"use client";

import { useState, useTransition } from "react";
import { X } from "lucide-react";
import {
  removeMessageFromEventAction,
  updateFutureMessageAction,
  toggleFutureMessageDoneAction,
  setMessagePriorityAction,
} from "@/app/actions";
import { ConfirmButton } from "@/app/components/confirm-button";
import { AutosaveIndicator } from "@/app/components/autosave-indicator";
import {
  ScopeQuickToggle,
  KeywordSentenceField,
  MESSAGE_QUICK_SCOPES,
  type QuickScope,
} from "@/app/components/scope-picker";
import { PriorityToggle, type QuickPriority } from "@/app/components/priority-toggle";

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
  /** 作られたきっかけの予定名（あれば）。「似た予定」のとき、何に似ているかの表示に使う。 */
  sourceEventTitle: string | null;
  confirmedCount: number;
  /** 予定が済んでいるか。 */
  eventEnded: boolean;
  /** 準備リストの項目と同じ「チェックで完了」。次回の提案・一致判定には影響しない。 */
  isDone: boolean;
  /** 「急ぎ」「そのうち」タグ。2026-10-23追加。 */
  priority: QuickPriority;
};

/** FutureMessage.scope は "keyword"|"similar"|"once" を取りうるが、この枠では
 * 「今回だけ」(once) は使わない（先の予定のための機能だから）ので keyword に畳む。 */
export function toQuickScope(scope: string): QuickScope {
  return scope === "similar" ? "similar" : "keyword";
}

/** 行を開く前の、次回の出し方の要約バッジ。「似た予定」のときは何に似ているか
 * （元の予定名）を書く。これが無いと、何に似ているのか分からず不安になる
 * （ユーザー指摘により2026-10-19）。学習済みマニュアルページのコンパクト表示
 * （savings/page.tsx の CompactMessageLine）からも使う。 */
export function ScopeSummaryBadge({ r }: { r: EMRow }) {
  if (toQuickScope(r.scope) === "similar") {
    return (
      <span className="text-[11px] text-muted">
        🔁「{r.sourceEventTitle ?? r.eventTitle}」に似た予定のとき
      </span>
    );
  }
  const kw = r.keywords.join("、");
  return kw ? (
    <span className="text-[11px] text-muted">🏷「{kw}」のとき</span>
  ) : (
    <span className="text-[11px] text-muted">キーワード未設定</span>
  );
}

const REMOVE_CONFIRM_MESSAGE =
  "この予定からだけ外します。次回以降は、キーワードが一致すればまた表示されます。よろしいですか？";

/** 準備リストの項目と同じ並び順にする: 未完了が上、完了が下（元の順序はそれぞれ維持）。 */
function sortByDone(rows: EMRow[]): EMRow[] {
  return [...rows].sort((a, b) => Number(a.isDone) - Number(b.isDone));
}

/**
 * 開いたときの編集フォーム（本文・次回の出し方・キーワード）。
 * 閉じている間は文言・バッジだけの軽い表示（元の表示方法のまま）にして、
 * ∨ を押したときだけ編集状態にする（ユーザー指摘により2026-10-19:
 * 閉じている間から常に編集欄になっているのは分かりにくい）。
 */
function RowEditForm({ r, showPriorityUi = false }: { r: EMRow; showPriorityUi?: boolean }) {
  const [body, setBody] = useState(r.body);
  const [scope, setScope] = useState<QuickScope>(toQuickScope(r.scope));
  const [keyword, setKeyword] = useState(r.keywords.join("、"));
  const [scopeHintOpen, setScopeHintOpen] = useState(false);
  const [priority, setPriority] = useState<QuickPriority>(r.priority);
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
  function choosePriority(next: QuickPriority) {
    const applied = priority === next ? null : next;
    setPriority(applied);
    start(() => setMessagePriorityAction(r.id, applied));
  }

  return (
    <div className="space-y-1.5">
      <AutosaveIndicator show={pending} />
      <textarea
        rows={2}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        onBlur={flushBody}
        className="w-full rounded-md border border-border bg-background px-2 py-1 text-sm text-foreground"
        aria-label="メッセージ本文"
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
      {showPriorityUi && <PriorityToggle value={priority} onChange={choosePriority} />}
    </div>
  );
}

/** 予定に結びついたメッセージの一覧。1 件ずつ開いて、いつでも編集できる。
 * `showPriorityUi`: 急ぎ/そのうちタグ（ver2.1）を出すか。既定false（安全側）。 */
export function FutureMessageRows({
  rows,
  showPriorityUi = false,
}: {
  rows: EMRow[];
  showPriorityUi?: boolean;
}) {
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
              <ScopeSummaryBadge r={r} />
              {r.confirmedCount > 0 && (
                <span className="text-[11px] text-muted">{r.confirmedCount}回更新</span>
              )}
            </div>
            {!open && r.matchReason && (
              <p className="ml-0.5 mt-0.5 text-[11px] text-muted">{r.matchReason}</p>
            )}
            {open && (
              <div className="mt-1.5 space-y-1 rounded-lg bg-background/60 p-2">
                {r.matchReason && (
                  <p className="text-[11px] text-muted">なぜ出ているか: {r.matchReason}</p>
                )}
                <RowEditForm key={r.id} r={r} showPriorityUi={showPriorityUi} />
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
