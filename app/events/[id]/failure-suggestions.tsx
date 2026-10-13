import { attachFailureToEvent } from "@/app/actions";
import { suggestFailureLogsForEvent } from "@/lib/failures";
import { SubmitButton } from "@/app/components/submit-button";

/**
 * 予定ページの一番上に出す「こんな失敗もあり得ます」提案。
 * 似た予定・同カテゴリからの候補を、準備リストの提案と同じノリで多めに出す。
 * 各カードで内容・金額を直し、結果（まだ／防げた／防げなかった／今回は関係ない）を選んで記録。
 */
export async function FailureSuggestions({ eventId }: { eventId: string }) {
  const suggestions = await suggestFailureLogsForEvent(eventId, 6);
  if (suggestions.length === 0) return null;

  return (
    <details
      data-coach="failure-suggest"
      className="rounded-2xl border border-warn/30 bg-warn-soft p-4 [&_summary::-webkit-details-marker]:hidden"
    >
      <summary className="cursor-pointer list-none text-sm font-semibold text-warn">
        ⚠ 似た予定でよくある失敗（{suggestions.length}）
      </summary>
      <p className="mt-1 text-xs text-warn/80">
        当てはまりそうなら「紐付け」や結果を選んで記録、関係なければ「今回は関係ない」で消せます。
      </p>

      <div className="mt-3 space-y-2">
        {suggestions.map((s) => (
          <form
            key={s.sourceId}
            action={attachFailureToEvent}
            className="space-y-2 rounded-xl bg-surface p-3"
          >
            <input type="hidden" name="eventId" value={eventId} />
            <div className="flex flex-wrap items-center gap-1">
              {s.reasons.map((r) => (
                <span
                  key={r}
                  className="rounded bg-surface-muted px-1.5 py-0.5 text-[10px] text-muted"
                >
                  {r}
                </span>
              ))}
              {s.fromEventTitle && (
                <span className="text-[10px] text-muted">
                  「{s.fromEventTitle}」の記録
                </span>
              )}
            </div>

            <textarea
              name="description"
              required
              rows={2}
              defaultValue={s.description}
              className="w-full rounded-lg border bg-background px-3 py-2 text-sm"
            />

            <label className="block text-xs text-muted">
              金額（円・任意）
              <input
                type="number"
                name="estimatedLossYen"
                min={0}
                step={100}
                defaultValue={s.estimatedLossYen || ""}
                placeholder="なくてもOK"
                className="ml-1 w-28 rounded-md border bg-background px-2 py-1 text-sm"
              />
            </label>

            {/* 追加時は結果を選ばせない。初期値は「まだ」。あとは下の一覧から編集。 */}
            <div className="flex flex-wrap items-center gap-3">
              <SubmitButton variant="ghost">この予定に追加</SubmitButton>
              <button
                type="submit"
                name="outcome"
                value="dismiss"
                formNoValidate
                className="text-[11px] text-muted underline hover:text-foreground"
              >
                今回は関係ない（消す）
              </button>
            </div>
          </form>
        ))}
      </div>
    </details>
  );
}
