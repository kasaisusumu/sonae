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
import { ScopeChip, messageScopeToItemScope } from "@/app/components/scope-chip";

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
};


function EditableRow({
  m,
  categoryOptions,
}: {
  m: MLMessage;
  categoryOptions: { id: string; name: string }[];
}) {
  const [open, setOpen] = useState(false);
  const [body, setBody] = useState(m.body);
  const [keywords, setKeywords] = useState(m.keywords.join("、"));
  const [genres, setGenres] = useState(m.genres.join("、"));
  const [categoryIds, setCategoryIds] = useState<Set<string>>(
    () => new Set(m.categoryIds),
  );
  const [scope, setScope] = useState(m.scope);
  const [pending, start] = useTransition();

  function buildFd(): FormData {
    const fd = new FormData();
    fd.set("id", m.id);
    fd.set("body", body);
    fd.set("keywords", keywords);
    fd.set("genres", genres);
    fd.set("scope", scope);
    for (const c of categoryIds) fd.append("categoryIds", c);
    return fd;
  }
  function flush() {
    if (pending) return;
    start(() => updateFutureMessageAction(buildFd()));
  }

  return (
    <li className="rounded-xl bg-surface p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="whitespace-pre-wrap break-words text-sm">{m.body}</p>
          <p className="mt-1 text-xs text-muted">
            <ScopeChip scope={messageScopeToItemScope(m.scope)} className="mr-1" />
            {m.confirmedCount > 0 ? ` ・ ${m.confirmedCount}回更新` : ""}
          </p>
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
            onBlur={flush}
            className="w-full rounded-md border bg-background px-2 py-1 text-sm"
          />
          <input
            value={keywords}
            onChange={(e) => setKeywords(e.target.value)}
            onBlur={flush}
            placeholder="キーワード（読点区切り）"
            className="w-full rounded-md border bg-background px-2 py-1 text-xs"
          />
          <input
            value={genres}
            onChange={(e) => setGenres(e.target.value)}
            onBlur={flush}
            placeholder="ジャンル（〇〇系。読点区切り）"
            className="w-full rounded-md border bg-background px-2 py-1 text-xs"
          />
          {categoryOptions.length > 0 && (
            <div className="flex flex-wrap gap-x-3 gap-y-1">
              {categoryOptions.map((c) => (
                <label key={c.id} className="flex items-center gap-1 text-xs">
                  <input
                    type="checkbox"
                    checked={categoryIds.has(c.id)}
                    onChange={(e) => {
                      setCategoryIds((prev) => {
                        const next = new Set(prev);
                        if (e.target.checked) next.add(c.id);
                        else next.delete(c.id);
                        return next;
                      });
                      queueMicrotask(flush);
                    }}
                  />
                  {c.name}
                </label>
              ))}
            </div>
          )}
          <select
            value={scope}
            onChange={(e) => {
              setScope(e.target.value);
              start(() => updateFutureMessageAction(buildFd()));
            }}
            className="rounded-md border bg-background px-1.5 py-1 text-xs"
          >
            <option value="keyword">キーワード一致のみ</option>
            <option value="similar">似た予定で提案</option>
            <option value="once">今回だけ</option>
          </select>
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

export function MessageList({
  messages,
  categoryOptions,
}: {
  messages: MLMessage[];
  categoryOptions: { id: string; name: string }[];
}) {
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
          ▸ 登録したメッセージを見る（{active.length}件）
        </summary>
        <ul className="mt-2 space-y-2">
          {active.map((m) => (
            <EditableRow key={m.id} m={m} categoryOptions={categoryOptions} />
          ))}
        </ul>
      </details>

      {upcoming.length > 0 && (
        <details className="rounded-xl border border-border bg-surface p-3 [&_summary::-webkit-details-marker]:hidden">
          <summary className="cursor-pointer list-none text-xs font-semibold text-muted">
            ▸ これからの予定に出るメッセージを見る（{upcoming.length}件）
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
            ▸ 過去のメッセージを見る（{archived.length}件）
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
