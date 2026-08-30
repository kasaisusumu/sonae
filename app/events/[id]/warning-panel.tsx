import {
  ackEventWarning,
  addPreventionItem,
  markPrevented,
  undoPrevented,
} from "@/app/actions";
import { formatYen } from "@/lib/format";
import { SubmitButton } from "@/app/components/submit-button";
import type { EventWarning } from "@/lib/failures";

const TIMING_PRESETS = ["1週間前", "3日前", "前日", "前日夜", "当日朝", "出発1時間前"];

export function WarningPanel({ warning }: { warning: EventWarning }) {
  const { event, logs } = warning;

  return (
    <section className="rounded-2xl border border-warn/30 bg-warn-soft p-5">
      <h2 className="text-sm font-semibold text-warn">
        このカテゴリ「{event.categoryName}」で過去に失敗の記録があります
      </h2>
      <p className="mt-1 text-xs text-warn/80">
        責めるための表示ではありません。今回先回りできるよう、参考にしてください。
      </p>

      <ul className="mt-4 space-y-4">
        {logs.map((log) => (
          <li key={log.id} className="rounded-xl bg-surface p-4">
            <p className="whitespace-pre-wrap text-sm">{log.description}</p>
            <p className="mt-1 text-xs text-muted">
              {log.occurredAt.toLocaleDateString("ja-JP")}
              {log.estimatedLossYen > 0
                ? ` ・ 推定損失 ${formatYen(log.estimatedLossYen)}`
                : ""}
            </p>

            {/* 準備リストに再発防止項目を追加 */}
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
                name="timingLabel"
                defaultValue="前日"
                className="rounded-md border bg-background px-2 py-1 text-sm"
              >
                {TIMING_PRESETS.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
              <SubmitButton variant="ghost">追加</SubmitButton>
            </form>

            {/* 防げた / 取り消し */}
            <div className="mt-3">
              {log.prevented ? (
                <form action={undoPrevented} className="flex items-center gap-3">
                  <input type="hidden" name="eventId" value={event.id} />
                  <input type="hidden" name="failureLogId" value={log.id} />
                  <span className="text-xs text-teal-dark">
                    ✓ 「防げた」として計上済み
                  </span>
                  <button
                    type="submit"
                    className="text-xs text-muted underline hover:text-foreground"
                  >
                    取り消す
                  </button>
                </form>
              ) : (
                <form action={markPrevented}>
                  <input type="hidden" name="eventId" value={event.id} />
                  <input type="hidden" name="failureLogId" value={log.id} />
                  <SubmitButton>
                    これは防げた
                    {log.estimatedLossYen > 0
                      ? `（${formatYen(log.estimatedLossYen)}を節約に計上）`
                      : "（節約に計上）"}
                  </SubmitButton>
                </form>
              )}
            </div>
          </li>
        ))}
      </ul>

      <form action={ackEventWarning} className="mt-4">
        <input type="hidden" name="eventId" value={event.id} />
        <button
          type="submit"
          className="text-xs text-warn/80 underline hover:text-warn"
        >
          確認した（この警告を畳む）
        </button>
      </form>
    </section>
  );
}
