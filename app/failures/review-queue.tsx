"use client";

import { useState, useTransition } from "react";
import { deleteFailureLog, setFailureOutcome } from "@/app/actions";
import { formatDateOnly, formatYen } from "@/lib/format";
import { ConfirmButton } from "@/app/components/confirm-button";
import { InfoHint } from "@/app/components/info-hint";
import { RetroAmountInput } from "@/app/components/retro-amount-input";
import { RetroOutcomeSelect } from "@/app/events/[id]/retro-outcome-select";

export type RQLog = {
  id: string;
  description: string;
  occurredAt: Date;
  estimatedLossYen: number;
  outcome: string | null;
  category: { name: string } | null;
  event: { title: string } | null;
};

const OUTCOME_LABEL: Record<string, string> = {
  prevented: "防げた",
  not_prevented: "防げなかった",
  irrelevant: "今回は関係ない",
};

/** まだ結果が決まっていない失敗の「今回どうでした？」。予定詳細ページの振り返りと同じ形式。 */
function PendingChoice({ log }: { log: RQLog }) {
  const [amount, setAmount] = useState(
    log.estimatedLossYen ? String(log.estimatedLossYen) : "",
  );
  const [, start] = useTransition();

  function submit(outcome: string, confirmMsg: string, withAmount = false) {
    if (!window.confirm(confirmMsg)) return;
    const fd = new FormData();
    fd.set("failureLogId", log.id);
    fd.set("outcome", outcome);
    if (withAmount) fd.set("estimatedLossYen", amount);
    start(() => setFailureOutcome(fd));
  }

  return (
    <div className="mt-3 space-y-2">
      <p className="text-xs text-muted">
        今回はどうでしたか？ どれか押すだけでOKです。
      </p>
      <label className="flex items-center gap-1.5 text-[11px] text-muted">
        防げた場合の金額（任意・あとで直せます）
        <input
          type="number"
          min={0}
          step={100}
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="円"
          className="w-24 rounded-md border bg-background px-2 py-1 text-xs text-foreground"
        />
      </label>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() =>
            submit(
              "prevented",
              "「防げた」で記録しますか？（推定額が節約額に積み上がります）",
              true,
            )
          }
          className="rounded-lg bg-foreground px-3.5 py-1.5 text-sm font-semibold text-surface hover:opacity-90"
        >
          今回は防げた 🎉
        </button>
        <button
          type="button"
          onClick={() =>
            submit("not_prevented", "「防げなかった」で記録しますか？")
          }
          className="rounded-lg border border-warn/50 bg-surface px-3.5 py-1.5 text-sm font-medium text-warn hover:bg-warn-soft"
        >
          今回もやってしまった 😢
        </button>
        <button
          type="button"
          onClick={() =>
            submit("irrelevant", "「今回は関係ない」で記録しますか？")
          }
          className="rounded-lg border border-border px-3 py-1.5 text-sm text-muted hover:border-foreground/40 hover:text-foreground"
        >
          今回は関係ない
        </button>
      </div>
    </div>
  );
}

/**
 * ふりかえり（結果記録待ち）。押しても「このページを離れるまで」カードは消えない。
 * マウント時に「未確認だった id」を控え、以後はそのカードを出し続ける（結果は最新を表示）。
 * 他ページへ移動して戻る＝再マウントで、片付いたものは外れる。
 * 形式は予定詳細ページの振り返り（WarningPanel）と同じ。金額・結果は自動保存。
 */
export function ReviewQueue({ logs }: { logs: RQLog[] }) {
  const [pendingIds] = useState(
    () => new Set(logs.filter((l) => !l.outcome).map((l) => l.id)),
  );

  const byId = new Map(logs.map((l) => [l.id, l]));
  const rows = [...pendingIds]
    .map((id) => byId.get(id))
    .filter((l): l is RQLog => !!l);

  if (rows.length === 0) return null;
  const remaining = rows.filter((r) => !r.outcome).length;

  return (
    <section id="review" className="scroll-mt-4 space-y-3">
      <h2 className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
        🤔 結果を記録しよう（{remaining}件）
        <InfoHint>
          終わった予定、どうでしたか？ 「防げた」にしたものだけが節約額に積み上がります。
          押しても、このページを離れるまでは消えません。
        </InfoHint>
      </h2>

      {rows.map((l) => {
        const settled = !!l.outcome;
        return (
          <div
            key={l.id}
            className="rounded-2xl border border-border bg-surface p-4"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 className="text-sm font-semibold text-foreground">
                  {l.event
                    ? `${l.event.title}、おつかれさまでした 🍵`
                    : "この失敗、どうでしたか？"}
                </h3>
                {l.category && (
                  <p className="mt-0.5 text-xs text-muted">
                    前に「{l.category.name}」であった失敗です。今回はどうだったか、
                    ワンタップで教えてください。
                  </p>
                )}
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

            <div className="mt-3 rounded-xl bg-surface p-3">
              <p className="whitespace-pre-wrap break-words text-sm">
                {l.description}
              </p>
              <p className="mt-1 text-xs text-muted">
                直近 {formatDateOnly(l.occurredAt)}
                {l.event ? ` ・ 「${l.event.title}」のとき` : ""}
                {l.estimatedLossYen > 0
                  ? ` ・ 推定損失 ${formatYen(l.estimatedLossYen)}`
                  : ""}
              </p>

              {settled ? (
                <div className="mt-3 space-y-1.5">
                  <p className="text-sm font-medium text-foreground">
                    ✓ 「{OUTCOME_LABEL[l.outcome!] ?? l.outcome}」で記録しました。
                  </p>
                  <RetroOutcomeSelect
                    logId={l.id}
                    current={l.outcome ?? "unset"}
                  />
                  {l.outcome === "prevented" && (
                    <RetroAmountInput
                      failureLogId={l.id}
                      initial={l.estimatedLossYen}
                    />
                  )}
                  <p className="text-[11px] text-muted">
                    このページを離れると片付きます（気が変わったら選び直せます）。
                  </p>
                </div>
              ) : (
                <PendingChoice log={l} />
              )}
            </div>
          </div>
        );
      })}
    </section>
  );
}
