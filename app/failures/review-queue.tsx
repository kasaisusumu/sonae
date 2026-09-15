"use client";

import { useState, useTransition } from "react";
import { deleteFailureLog, setFailureOutcome } from "@/app/actions";
import { formatDateOnly } from "@/lib/format";
import { ConfirmButton } from "@/app/components/confirm-button";
import { InfoHint } from "@/app/components/info-hint";
import { CountermeasureField } from "@/app/components/countermeasure-field";
import { RetroOutcomeSelect } from "@/app/events/[id]/retro-outcome-select";

export type RQLog = {
  id: string;
  description: string;
  occurredAt: Date;
  countermeasure: string | null;
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
  const [countermeasure, setCountermeasure] = useState(log.countermeasure ?? "");
  const [pending, start] = useTransition();

  function submit(outcome: string, confirmMsg: string, withCountermeasure = false) {
    if (!window.confirm(confirmMsg)) return;
    const fd = new FormData();
    fd.set("failureLogId", log.id);
    fd.set("outcome", outcome);
    if (withCountermeasure) fd.set("countermeasure", countermeasure);
    start(() => setFailureOutcome(fd));
  }

  return (
    <div className="mt-3 space-y-2">
      <p className="text-xs text-muted">
        今回はどうでしたか？ どれか押すだけでOKです。
      </p>
      <CountermeasureField
        label="有効だった対策（あれば・任意）"
        defaultValue={countermeasure}
        onValue={setCountermeasure}
        rows={1}
        className="w-full rounded-md border bg-background px-2 py-1 text-xs text-foreground"
      />
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            submit("prevented", "「防げた」で記録しますか？（防げた件数に積み上がります）", true)
          }
          className="rounded-lg bg-foreground px-3.5 py-1.5 text-sm font-semibold text-surface hover:opacity-90 disabled:opacity-50"
        >
          今回は防げた 🎉
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            submit("not_prevented", "「防げなかった」で記録しますか？")
          }
          className="rounded-lg border border-warn/50 bg-surface px-3.5 py-1.5 text-sm font-medium text-warn hover:bg-warn-soft disabled:opacity-50"
        >
          今回もやってしまった 😢
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            submit("irrelevant", "「今回は関係ない」で記録しますか？")
          }
          className="rounded-lg border border-border px-3 py-1.5 text-sm text-muted hover:border-foreground/40 hover:text-foreground disabled:opacity-50"
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
 * 形式は予定詳細ページの振り返り（WarningPanel）と同じ。対策・結果は自動保存。
 */
// 「まだ結果が入力されていない」＝採用済み（linked）で結果が決まっていない。
const isPending = (l: RQLog) => l.outcome === "linked";
// 結果が決まった（＝片付いた）。
const isSettled = (l: RQLog) => !!l.outcome && l.outcome !== "linked";

export function ReviewQueue({ logs }: { logs: RQLog[] }) {
  const [pendingIds] = useState(
    () => new Set(logs.filter(isPending).map((l) => l.id)),
  );

  const byId = new Map(logs.map((l) => [l.id, l]));
  const rows = [...pendingIds]
    .map((id) => byId.get(id))
    .filter((l): l is RQLog => !!l);

  if (rows.length === 0) return null;
  const remaining = rows.filter(isPending).length;

  return (
    <section id="review" className="scroll-mt-4 space-y-3">
      <h2 className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
        🤔 結果を記録しよう（{remaining}件）
        <InfoHint id="failures-review-queue">
          終わった予定、どうでしたか？ 「防げた」にしたものだけが防げた件数に積み上がります。
          押しても、このページを離れるまでは消えません。
        </InfoHint>
      </h2>

      {rows.map((l) => {
        const settled = isSettled(l);
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
              </p>
              {l.countermeasure && (
                <p className="mt-1 text-xs text-teal-dark">
                  💡 対策候補: {l.countermeasure}
                </p>
              )}

              {settled ? (
                <div className="mt-3 space-y-1.5">
                  <p className="text-sm font-medium text-foreground">
                    ✓ 「{OUTCOME_LABEL[l.outcome!] ?? l.outcome}」で記録しました。
                  </p>
                  <RetroOutcomeSelect
                    logId={l.id}
                    current={l.outcome ?? "unset"}
                  />
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
