"use client";

import { useState, useTransition } from "react";
import { loadMessageProposalAction } from "@/app/actions";
import { MessageReviewCard, type ReviewProposal } from "@/app/components/message-review-card";

/**
 * 済んだ予定・学習内容から開く振り返り。ボタンを押したときだけ AI の提案を取りに行く
 * （一覧を描くたびに AI を呼ばないため）。閉じると提案は捨てる（次に開くとき最新の値を読む）。
 */
export function ReopenableReview({
  linkId,
  eventTitle,
}: {
  linkId: string;
  eventTitle: string;
}) {
  const [open, setOpen] = useState(false);
  const [proposal, setProposal] = useState<ReviewProposal | null>(null);
  const [failed, setFailed] = useState(false);
  const [loading, start] = useTransition();

  function openIt() {
    setOpen(true);
    setFailed(false);
    start(async () => {
      const p = await loadMessageProposalAction(linkId);
      if (p) setProposal(p);
      else setFailed(true);
    });
  }

  function close() {
    setOpen(false);
    setProposal(null);
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={openIt}
        className="rounded-md border border-border px-2 py-1 text-[11px] text-muted hover:border-teal hover:text-teal-dark"
      >
        📝 振り返り
      </button>
    );
  }
  if (failed) {
    return (
      <div className="flex items-center justify-between gap-2 text-xs text-muted">
        <span>振り返りを開けませんでした。もう一度押してください。</span>
        <button type="button" onClick={close} className="underline">
          閉じる
        </button>
      </div>
    );
  }
  if (loading || !proposal) {
    return (
      <div className="flex items-center justify-between gap-2 text-xs text-muted">
        <span>提案を準備しています…</span>
        <button type="button" onClick={close} className="underline">
          閉じる
        </button>
      </div>
    );
  }
  return (
    <MessageReviewCard
      linkId={linkId}
      eventTitle={eventTitle}
      proposal={proposal}
      allowSkip={false}
      onClose={close}
    />
  );
}
