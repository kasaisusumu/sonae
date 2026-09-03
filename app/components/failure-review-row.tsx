"use client";

import {
  deleteFailureLog,
  setFailureOutcome,
  updateFailureLog,
} from "@/app/actions";
import { formatDateOnly, formatYen, toDateInputValue } from "@/lib/format";
import { ConfirmButton } from "@/app/components/confirm-button";
import { SubmitButton } from "@/app/components/submit-button";

/** 「過去の失敗予測の振り返り」1 行ぶんの表示データ。 */
export type FRRow = {
  id: string;
  description: string;
  occurredAt: Date;
  estimatedLossYen: number;
  outcome: string | null;
  categoryName: string | null;
  eventTitle: string | null;
};

export type OutcomeTarget =
  | "prevented"
  | "not_prevented"
  | "irrelevant"
  | "unset";

function OutcomeButton({
  logId,
  target,
  active,
  label,
  onOutcome,
}: {
  logId: string;
  target: "prevented" | "not_prevented" | "irrelevant";
  active: boolean;
  label: string;
  onOutcome?: (t: OutcomeTarget) => void;
}) {
  const base =
    "rounded-full px-3.5 py-1.5 text-xs font-medium transition-colors";
  const cls = active
    ? "bg-foreground text-surface"
    : "border border-border bg-surface text-muted hover:border-foreground/40 hover:text-foreground";
  const next: OutcomeTarget = active ? "unset" : target;
  const text = active ? `✓ ${label}` : label;

  // onOutcome あり＝親が楽観的に状態を持つ（結果を変えても行が消えない）。
  if (onOutcome) {
    return (
      <button
        type="button"
        onClick={() => onOutcome(next)}
        className={`${base} ${cls}`}
      >
        {text}
      </button>
    );
  }
  return (
    <form action={setFailureOutcome}>
      <input type="hidden" name="failureLogId" value={logId} />
      <input type="hidden" name="outcome" value={next} />
      <button type="submit" className={`${base} ${cls}`}>
        {text}
      </button>
    </form>
  );
}

/**
 * 失敗ログページの「過去の失敗予測の振り返りを見る」の 1 行。
 * ホームの「防げたこと」ポップアップからも同じ形式で使う。
 * id が空（＝元の失敗ログが消えている）のときは、内容と日付だけの読み取り表示にする。
 * onOutcome を渡すと、結果ボタンはフォーム送信ではなくコールバックになる
 * （親が楽観的に状態を保持して、結果を変えても行を消さないため）。
 */
export function FailureReviewRow({
  log: l,
  reviewable = true,
  onOutcome,
}: {
  log: FRRow;
  reviewable?: boolean;
  onOutcome?: (t: OutcomeTarget) => void;
}) {
  const meta = (
    <p className="mt-1 text-xs text-muted">
      {formatDateOnly(l.occurredAt)}
      {l.categoryName ? ` ・ ${l.categoryName}` : " ・ カテゴリなし"}
      {l.eventTitle ? ` ・ 「${l.eventTitle}」` : ""}
      {l.estimatedLossYen > 0 ? ` ・ 推定 ${formatYen(l.estimatedLossYen)}` : ""}
    </p>
  );

  if (!l.id) {
    return (
      <li className="rounded-xl bg-surface p-4">
        <p className="whitespace-pre-wrap text-sm">{l.description}</p>
        {meta}
      </li>
    );
  }

  return (
    <li className="rounded-xl bg-surface p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="whitespace-pre-wrap text-sm">{l.description}</p>
          {meta}
        </div>
        <form action={deleteFailureLog}>
          <input type="hidden" name="id" value={l.id} />
          <ConfirmButton
            message="この失敗ログを削除しますか？"
            className="shrink-0 rounded px-2 py-1 text-xs text-muted hover:bg-warn-soft hover:text-warn"
          >
            削除
          </ConfirmButton>
        </form>
      </div>

      {reviewable ? (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <OutcomeButton
            logId={l.id}
            target="prevented"
            active={l.outcome === "prevented"}
            label="🛡️ 防げた"
            onOutcome={onOutcome}
          />
          <OutcomeButton
            logId={l.id}
            target="not_prevented"
            active={l.outcome === "not_prevented"}
            label="😓 防げなかった"
            onOutcome={onOutcome}
          />
          <OutcomeButton
            logId={l.id}
            target="irrelevant"
            active={l.outcome === "irrelevant"}
            label="今回は関係ない"
            onOutcome={onOutcome}
          />
        </div>
      ) : (
        <p className="mt-2 text-[11px] text-muted">
          この予定が終わってから振り返れます。
        </p>
      )}

      <details className="mt-2 [&_summary::-webkit-details-marker]:hidden">
        <summary className="cursor-pointer list-none text-[11px] text-teal-dark">
          ✏️ 内容・金額・日付を直す
        </summary>
        <form action={updateFailureLog} className="mt-2 space-y-2">
          <input type="hidden" name="id" value={l.id} />
          <textarea
            name="description"
            required
            rows={2}
            defaultValue={l.description}
            className="w-full rounded-lg border bg-background px-3 py-2 text-sm"
          />
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="block text-xs text-muted">
              金額（円）
              <input
                type="number"
                name="estimatedLossYen"
                min={0}
                step={100}
                defaultValue={l.estimatedLossYen || ""}
                placeholder="任意"
                className="mt-0.5 w-full rounded-md border bg-background px-3 py-2 text-sm"
              />
            </label>
            <label className="block text-xs text-muted">
              日付
              <input
                type="date"
                name="occurredAt"
                defaultValue={toDateInputValue(l.occurredAt)}
                className="mt-0.5 w-full rounded-md border bg-background px-3 py-2 text-sm"
              />
            </label>
          </div>
          <SubmitButton variant="ghost">更新</SubmitButton>
        </form>
      </details>
    </li>
  );
}
