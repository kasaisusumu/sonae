"use client";

import { useState, useTransition } from "react";
import {
  confirmMessageReviewAction,
  skipMessageReviewAction,
} from "@/app/actions";

export interface ReviewProposal {
  body: string;
  keywords: string[];
  genres: string[];
  categoryIds: string[];
  scope: string;
  reasons: Partial<
    Record<"body" | "keywords" | "genres" | "categoryIds" | "scope", string>
  >;
  newMessageSuggestions: { body: string; keywords: string[] }[];
}

const splitCsv = (s: string): string[] =>
  s
    .split(/[、,，]/)
    .map((x) => x.trim())
    .filter(Boolean);

/**
 * 予定後の「未来の自分へのメッセージ」確定カード。§2.6:
 * 全項目があらかじめ埋まった提案を見せ、直すところだけ直して確定するだけにする。
 */
export function MessageReviewCard({
  linkId,
  eventTitle,
  categoryOptions,
  proposal,
  allowSkip = true,
  onClose,
}: {
  linkId: string;
  eventTitle: string;
  categoryOptions: { id: string; name: string }[];
  proposal: ReviewProposal;
  /** 予定後の確定待ち（一覧）では「今回は更新しない」を出す。済んだ予定からの振り返りでは出さない。 */
  allowSkip?: boolean;
  /** 指定すると「閉じる」を出す（振り返りを開いた場所から畳めるように）。 */
  onClose?: () => void;
}) {
  const [body, setBody] = useState(proposal.body);
  const [keywords, setKeywords] = useState(proposal.keywords.join("、"));
  const [genres, setGenres] = useState(proposal.genres.join("、"));
  const [categoryIds, setCategoryIds] = useState<Set<string>>(
    () => new Set(proposal.categoryIds),
  );
  const [scope, setScope] = useState(proposal.scope);
  const [acceptedNew, setAcceptedNew] = useState<Set<number>>(() => new Set());
  const [pending, startTransition] = useTransition();
  const [done, setDone] = useState<"confirmed" | "skipped" | null>(null);

  function finalFields() {
    return {
      body: body.trim(),
      keywords: splitCsv(keywords),
      genres: splitCsv(genres),
      categoryIds: [...categoryIds],
      scope,
    };
  }

  function confirm() {
    if (pending) return;
    const final = finalFields();
    startTransition(async () => {
      await confirmMessageReviewAction({
        linkId,
        proposed: proposal,
        final,
        acceptedNewMessages: proposal.newMessageSuggestions.filter((_, i) =>
          acceptedNew.has(i),
        ),
      });
      setDone("confirmed");
    });
  }

  function skip() {
    if (pending) return;
    startTransition(async () => {
      const fd = new FormData();
      fd.set("linkId", linkId);
      await skipMessageReviewAction(fd);
      setDone("skipped");
    });
  }

  if (done) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-border bg-surface p-4 text-sm text-muted">
        <span>
          {done === "confirmed"
            ? `「${eventTitle}」のメッセージを更新しました。`
            : `「${eventTitle}」は今回は更新しませんでした。`}
        </span>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-border bg-surface px-3 py-1.5 text-xs text-muted hover:border-foreground/40 hover:text-foreground"
          >
            閉じる
          </button>
        )}
      </div>
    );
  }

  return (
    <section className="space-y-3 rounded-2xl border border-border bg-surface p-5">
      <div>
        <h2 className="text-sm font-semibold text-foreground">
          {eventTitle}、おつかれさまでした 🍵
        </h2>
        <p className="mt-1 text-xs text-muted">
          次回への引き継ぎ内容を提案しました。直すところだけ直して確定してください。
        </p>
      </div>

      <div className="space-y-1">
        <label className="block text-xs text-muted">
          本文
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={2}
            className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1 text-sm text-foreground"
          />
        </label>
        {proposal.reasons.body && (
          <p className="text-[11px] text-teal-dark">根拠: {proposal.reasons.body}</p>
        )}
      </div>

      <div className="space-y-1">
        <label className="block text-xs text-muted">
          キーワード（読点区切り）
          <input
            value={keywords}
            onChange={(e) => setKeywords(e.target.value)}
            className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1 text-sm text-foreground"
          />
        </label>
        {proposal.reasons.keywords && (
          <p className="text-[11px] text-teal-dark">根拠: {proposal.reasons.keywords}</p>
        )}
      </div>

      <div className="space-y-1">
        <label className="block text-xs text-muted">
          ジャンル（〇〇系。読点区切り）
          <input
            value={genres}
            onChange={(e) => setGenres(e.target.value)}
            className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1 text-sm text-foreground"
          />
        </label>
        {proposal.reasons.genres && (
          <p className="text-[11px] text-teal-dark">根拠: {proposal.reasons.genres}</p>
        )}
      </div>

      {categoryOptions.length > 0 && (
        <div className="space-y-1">
          <p className="text-xs text-muted">カテゴリ指定</p>
          <div className="flex flex-wrap gap-x-3 gap-y-1">
            {categoryOptions.map((c) => (
              <label key={c.id} className="flex items-center gap-1 text-xs">
                <input
                  type="checkbox"
                  checked={categoryIds.has(c.id)}
                  onChange={(e) =>
                    setCategoryIds((prev) => {
                      const next = new Set(prev);
                      if (e.target.checked) next.add(c.id);
                      else next.delete(c.id);
                      return next;
                    })
                  }
                />
                {c.name}
              </label>
            ))}
          </div>
          {proposal.reasons.categoryIds && (
            <p className="text-[11px] text-teal-dark">
              根拠: {proposal.reasons.categoryIds}
            </p>
          )}
        </div>
      )}

      <div className="space-y-1">
        <label className="block text-xs text-muted">
          一致条件
          <select
            value={scope}
            onChange={(e) => setScope(e.target.value)}
            className="mt-1 rounded-md border border-border bg-background px-2 py-1 text-sm text-foreground"
          >
            <option value="keyword">キーワード一致のみ</option>
            <option value="similar">似た予定で提案</option>
            <option value="once">今回だけ（次回からは表示しない）</option>
          </select>
        </label>
        {proposal.reasons.scope && (
          <p className="text-[11px] text-teal-dark">根拠: {proposal.reasons.scope}</p>
        )}
      </div>

      {proposal.newMessageSuggestions.length > 0 && (
        <div className="space-y-1.5 rounded-lg bg-surface-muted p-3">
          <p className="text-xs font-medium text-foreground">
            新しく残す価値のあるメッセージ
          </p>
          {proposal.newMessageSuggestions.map((s, i) => (
            <label key={i} className="flex items-start gap-2 text-xs">
              <input
                type="checkbox"
                checked={acceptedNew.has(i)}
                onChange={(e) =>
                  setAcceptedNew((prev) => {
                    const next = new Set(prev);
                    if (e.target.checked) next.add(i);
                    else next.delete(i);
                    return next;
                  })
                }
              />
              <span>{s.body}</span>
            </label>
          ))}
        </div>
      )}

      <div className="flex flex-wrap gap-2 pt-1">
        <button
          type="button"
          onClick={confirm}
          disabled={pending}
          className="rounded-lg bg-foreground px-4 py-2 text-sm font-semibold text-surface shadow-sm hover:opacity-90 disabled:opacity-50"
        >
          この内容で確定
        </button>
        {allowSkip && (
          <button
            type="button"
            onClick={skip}
            disabled={pending}
            className="rounded-lg border border-border bg-surface px-3.5 py-2 text-sm text-muted hover:border-foreground/40 hover:text-foreground disabled:opacity-50"
          >
            今回は更新しない
          </button>
        )}
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            disabled={pending}
            className="rounded-lg border border-border bg-surface px-3.5 py-2 text-sm text-muted hover:border-foreground/40 hover:text-foreground disabled:opacity-50"
          >
            閉じる
          </button>
        )}
      </div>
    </section>
  );
}
