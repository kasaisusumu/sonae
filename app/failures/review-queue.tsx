"use client";

import { useState, useTransition } from "react";
import { deleteFailureLog, setFailureOutcome } from "@/app/actions";
import { formatDateOnly, formatYen } from "@/lib/format";
import { ConfirmButton } from "@/app/components/confirm-button";
import { InfoHint } from "@/app/components/info-hint";

export type RQLog = {
  id: string;
  description: string;
  occurredAt: Date;
  estimatedLossYen: number;
  outcome: string | null;
  category: { name: string } | null;
  event: { title: string } | null;
};

const OPTS: { value: string; label: string; confirm: string }[] = [
  {
    value: "prevented",
    label: "🛡️ 防げた",
    confirm: "「防げた」で記録しますか？（推定額が節約額に積み上がります）",
  },
  {
    value: "not_prevented",
    label: "😓 防げなかった",
    confirm: "「防げなかった」で記録しますか？",
  },
  {
    value: "irrelevant",
    label: "今回は関係ない",
    confirm: "「今回は関係ない」で記録しますか？",
  },
];

const OUTCOME_LABEL: Record<string, string> = {
  prevented: "防げた",
  not_prevented: "防げなかった",
  irrelevant: "今回は関係ない",
};

/**
 * ふりかえり（結果記録待ち）。押しても「このページを離れるまで」行は消えない。
 * マウント時に「未確認だった id」を控え、以後はその行を出し続ける（結果は最新を表示）。
 * 他ページへ移動して戻る＝再マウントで、片付いたものは外れる。
 */
export function ReviewQueue({ logs }: { logs: RQLog[] }) {
  const [pendingIds] = useState(
    () => new Set(logs.filter((l) => !l.outcome).map((l) => l.id)),
  );
  const [, startTransition] = useTransition();

  const byId = new Map(logs.map((l) => [l.id, l]));
  const rows = [...pendingIds]
    .map((id) => byId.get(id))
    .filter((l): l is RQLog => !!l);

  if (rows.length === 0) return null;
  const remaining = rows.filter((r) => !r.outcome).length;

  function choose(id: string, value: string, confirmMsg: string) {
    if (!window.confirm(confirmMsg)) return;
    const fd = new FormData();
    fd.set("failureLogId", id);
    fd.set("outcome", value);
    startTransition(() => {
      void setFailureOutcome(fd);
    });
  }

  return (
    <section
      id="review"
      className="scroll-mt-4 space-y-2 rounded-2xl border border-foreground bg-surface p-4"
    >
      <h2 className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
        🤔 結果を記録しよう（{remaining}件）
        <InfoHint>
          終わった予定、どうでしたか？ 「防げた」にしたものだけが節約額に積み上がります。
          押しても、このページを離れるまでは消えません。
        </InfoHint>
      </h2>
      <ul className="space-y-2">
      {rows.map((l) => {
        const settled = !!l.outcome;
        return (
          <li key={l.id} className="rounded-xl bg-surface p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xs font-semibold text-foreground">
                  {l.event
                    ? `📅 ${l.event.title}`
                    : l.category
                      ? `${l.category.name}（予定に紐づかない記録）`
                      : "予定に紐づかない記録"}
                </p>
                <p className="mt-1 whitespace-pre-wrap break-words text-sm">
                  {l.description}
                </p>
                <p className="mt-1 text-xs text-muted">
                  {formatDateOnly(l.occurredAt)}
                  {l.category && l.event ? ` ・ ${l.category.name}` : ""}
                  {l.estimatedLossYen > 0
                    ? ` ・ 推定 ${formatYen(l.estimatedLossYen)}`
                    : ""}
                </p>
              </div>
              <form action={deleteFailureLog} className="shrink-0">
                <input type="hidden" name="id" value={l.id} />
                <ConfirmButton
                  message="この失敗ログを削除しますか？"
                  className="rounded px-2 py-1 text-xs text-muted hover:bg-warn-soft hover:text-warn"
                >
                  削除
                </ConfirmButton>
              </form>
            </div>

            <div className="mt-2 flex flex-wrap items-center gap-2">
              {OPTS.map((o) => {
                const active = l.outcome === o.value;
                return (
                  <button
                    key={o.value}
                    type="button"
                    onClick={() => choose(l.id, o.value, o.confirm)}
                    className={`rounded-full px-3.5 py-1.5 text-xs font-medium transition-colors ${
                      active
                        ? "bg-foreground text-surface"
                        : "border border-border bg-surface text-muted hover:border-foreground/40 hover:text-foreground"
                    }`}
                  >
                    {active ? `✓ ${o.label}` : o.label}
                  </button>
                );
              })}
            </div>

            {settled && (
              <p className="mt-1.5 text-[11px] text-muted">
                ✓ 「{OUTCOME_LABEL[l.outcome!] ?? l.outcome}」で記録しました。
                このページを離れると片付きます（気が変わったら選び直せます）。
              </p>
            )}
          </li>
        );
      })}
      </ul>
    </section>
  );
}
