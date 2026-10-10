"use client";

import { useState, useTransition } from "react";
import {
  confirmMessageReviewAction,
  skipMessageReviewAction,
} from "@/app/actions";
import { ScopeQuickToggle, KeywordSentenceField } from "@/app/components/scope-picker";
import { pickKeyword } from "@/lib/text-norm";

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
  proposal,
  allowSkip = true,
  onClose,
}: {
  linkId: string;
  eventTitle: string;
  proposal: ReviewProposal;
  /** 予定後の確定待ち（一覧）では「今回は更新しない」を出す。済んだ予定からの振り返りでは出さない。 */
  allowSkip?: boolean;
  /** 指定すると「閉じる」を出す（振り返りを開いた場所から畳めるように）。 */
  onClose?: () => void;
}) {
  const [body, setBody] = useState(proposal.body);
  const [keywords, setKeywords] = useState(proposal.keywords.join("、"));
  const [scope, setScope] = useState(proposal.scope);
  const [acceptedNew, setAcceptedNew] = useState<Set<number>>(() => new Set());
  const [pending, startTransition] = useTransition();
  const [done, setDone] = useState<"confirmed" | "skipped" | null>(null);

  function finalFields() {
    return {
      body: body.trim(),
      keywords: scope === "keyword" ? splitCsv(keywords) : [],
      genres: [],
      categoryIds: [],
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

      <div className="space-y-1.5">
        <p className="text-xs text-muted">次回の出し方</p>
        <ScopeQuickToggle
          value={scope === "once" ? "event_only" : scope === "similar" ? "similar" : "keyword"}
          onChange={(sc) => {
            if (sc === "keyword") {
              setKeywords(pickKeyword(eventTitle));
              setScope("keyword");
            } else {
              setScope(sc === "event_only" ? "once" : "similar");
            }
          }}
        />
        <KeywordSentenceField
          initialKeyword={scope === "keyword" ? keywords : ""}
          onCommit={(kw) => {
            setKeywords(kw);
            setScope("keyword");
          }}
          onClear={() => {
            setKeywords("");
            setScope("once");
          }}
        />
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
