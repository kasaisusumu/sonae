import {
  ackEventWarning,
  addPreventionItem,
  logRepeatedFailure,
  markPrevented,
  updateFailureAmount,
} from "@/app/actions";
import { formatDateOnly, formatYen } from "@/lib/format";
import { LEAD_PRESETS } from "@/lib/lead-time";
import { SubmitButton } from "@/app/components/submit-button";
import { RetroOutcomeSelect } from "./retro-outcome-select";
import type { EventWarning } from "@/lib/failures";

export function WarningPanel({ warning }: { warning: EventWarning }) {
  const { event, logs, isPast, weak } = warning;

  return (
    <section
      className={`rounded-2xl border p-5 ${
        isPast
          ? "border-border bg-surface"
          : "border-warn/30 bg-warn-soft"
      }`}
    >
      {isPast ? (
        <>
          <h2 className="text-sm font-semibold text-foreground">
            {event.title}、おつかれさまでした 🍵
          </h2>
          <p className="mt-1 text-xs text-muted">
            前に「{event.categoryName}」であった失敗です。今回はどうだったか、ワンタップで教えてください。
          </p>
        </>
      ) : (
        <>
          <h2 className="text-sm font-semibold text-warn">
            このカテゴリ「{event.categoryName}」で過去に失敗の記録があります
          </h2>
          <p className="mt-1 text-xs text-warn/80">
            {weak
              ? "この予定と直接は結びついていませんが、同じカテゴリの記録です。参考にしてください。"
              : "責めるための表示ではありません。今回先回りできるよう、参考にしてください。前回防げていても、次回以降も表示します。"}
          </p>
        </>
      )}

      <ul className="mt-4 space-y-4">
        {logs.map((log) => (
          <li key={log.id} className="rounded-xl bg-surface p-4">
            <div className="flex items-start justify-between gap-2">
              <p className="whitespace-pre-wrap text-sm">{log.description}</p>
              {log.occurredCount > 1 && (
                <span className="shrink-0 rounded-full bg-warn-soft px-2 py-0.5 text-[11px] font-medium text-warn">
                  {log.occurredCount}回
                </span>
              )}
            </div>
            <p className="mt-1 text-xs text-muted">
              直近 {formatDateOnly(log.lastOccurredAt)}
              {log.fromEventTitle ? ` ・ 「${log.fromEventTitle}」のとき` : ""}
              {log.estimatedLossYen > 0
                ? ` ・ 推定損失 ${formatYen(log.estimatedLossYen)}`
                : ""}
              {log.preventedCount > 0
                ? ` ・ これまで ${log.preventedCount}回は防げた`
                : ""}
            </p>

            {/* これからの予定: 対策を準備リストに追加できる */}
            {!isPast && (
              <form
                action={addPreventionItem}
                className="mt-3 flex flex-wrap items-end gap-2"
              >
                <input type="hidden" name="eventId" value={event.id} />
                <label className="text-xs text-muted">
                  対策をリストに追加
                  <input
                    name="label"
                    defaultValue={log.description.slice(0, 40)}
                    className="mt-1 block w-56 rounded-md border bg-background px-2 py-1 text-sm text-foreground"
                  />
                </label>
                <select
                  name="notifyLeadMinutes"
                  defaultValue="1440"
                  className="rounded-md border bg-background px-2 py-1 text-sm"
                  aria-label="通知"
                >
                  {LEAD_PRESETS.filter((p) => p.minutes != null).map((p) => (
                    <option key={p.label} value={String(p.minutes)}>
                      {p.label}
                    </option>
                  ))}
                </select>
                <SubmitButton variant="ghost">追加</SubmitButton>
              </form>
            )}

            {/* 振り返り：防げた？ */}
            <div className="mt-3 space-y-2">
              {log.prevented ? (
                <div className="space-y-1.5">
                  <p className="text-sm font-medium text-teal-dark">
                    ✓ 「防げた」で記録しました
                    {log.estimatedLossYen > 0
                      ? `（${formatYen(log.estimatedLossYen)}を節約に計上）`
                      : ""}
                  </p>
                  {log.thisEventLogId && (
                    <RetroOutcomeSelect
                      logId={log.thisEventLogId}
                      current="prevented"
                    />
                  )}
                  <form
                    action={updateFailureAmount}
                    className="flex items-center gap-1"
                  >
                    <input
                      type="hidden"
                      name="failureLogId"
                      value={log.thisEventLogId ?? log.id}
                    />
                    <span className="text-[11px] text-muted">金額</span>
                    <input
                      type="number"
                      name="estimatedLossYen"
                      min={0}
                      step={100}
                      defaultValue={log.estimatedLossYen || ""}
                      placeholder="円"
                      className="w-24 rounded-md border bg-background px-2 py-1 text-xs text-foreground"
                    />
                    <button
                      type="submit"
                      className="rounded-md border border-border px-2 py-1 text-[11px] text-teal-dark hover:border-teal"
                    >
                      更新
                    </button>
                  </form>
                </div>
              ) : log.loggedThisEventCount > 0 ? (
                <div className="space-y-1.5">
                  <p className="text-sm font-medium text-warn">
                    ✓ 「今回もやってしまった」で記録しました。次の似た予定で先回りします。
                  </p>
                  {log.thisEventLogId && (
                    <RetroOutcomeSelect
                      logId={log.thisEventLogId}
                      current="not_prevented"
                    />
                  )}
                </div>
              ) : (
                <>
                  {isPast && (
                    <p className="text-xs text-muted">
                      今回はどうでしたか？ どちらか押すだけでOKです。
                    </p>
                  )}
                  <form action={markPrevented} className="space-y-1.5">
                    <input type="hidden" name="eventId" value={event.id} />
                    <input type="hidden" name="failureLogId" value={log.id} />
                    <label className="flex items-center gap-1.5 text-[11px] text-muted">
                      防げた場合の金額（任意・あとで直せます）
                      <input
                        type="number"
                        name="estimatedLossYen"
                        min={0}
                        step={100}
                        defaultValue={log.estimatedLossYen || ""}
                        placeholder="円"
                        className="w-24 rounded-md border bg-background px-2 py-1 text-xs text-foreground"
                      />
                    </label>
                    <SubmitButton>
                      {isPast ? "今回は防げた 🎉" : "これは防げた 🎉"}
                    </SubmitButton>
                  </form>
                  {isPast && (
                    <form action={logRepeatedFailure}>
                      <input type="hidden" name="eventId" value={event.id} />
                      <input type="hidden" name="failureLogId" value={log.id} />
                      <input
                        type="hidden"
                        name="outcome"
                        value="not_prevented"
                      />
                      <button
                        type="submit"
                        className="block w-full rounded-lg border border-warn/50 bg-surface px-3 py-2.5 text-sm font-medium text-warn hover:bg-warn-soft sm:w-auto sm:px-4"
                      >
                        今回もやってしまった 😢
                      </button>
                    </form>
                  )}
                </>
              )}
            </div>
          </li>
        ))}
      </ul>

      {!isPast && (
        <form action={ackEventWarning} className="mt-4">
          <input type="hidden" name="eventId" value={event.id} />
          <button
            type="submit"
            className="text-xs text-warn/80 underline hover:text-warn"
          >
            確認した（この警告を畳む）
          </button>
        </form>
      )}
    </section>
  );
}
