import { prisma } from "@/lib/prisma";
import {
  createFailureLog,
  deleteFailureLog,
  logRepeatedFailure,
  markNoFailure,
  updateFailureLog,
} from "@/app/actions";
import { formatDateOnly, jstToday, toDateInputValue } from "@/lib/format";
import { SubmitButton } from "@/app/components/submit-button";
import { ConfirmButton } from "@/app/components/confirm-button";

/** 失敗ログの「結果・状態」の見た目（アイコン＋短いラベル）。 */
function failureStateMeta(o: string | null): { icon: string; label: string } {
  switch (o) {
    case "prevented":
      return { icon: "🛡", label: "防げた" };
    case "not_prevented":
      return { icon: "😓", label: "防げなかった" };
    case "irrelevant":
      return { icon: "—", label: "今回は関係ない" };
    case "linked":
      return { icon: "🔗", label: "紐付け" };
    default:
      return { icon: "・", label: "未確認" };
  }
}

/**
 * 予定詳細ページの失敗ログ（提案は別コンポーネント <FailureSuggestions> がページ上部に出す）。
 * - この予定に紐づく失敗ログの一覧（その場で編集／削除）
 * - 新しく記録する
 * - その他の失敗ログから選んで紐づける
 */
export async function EventFailureLog({
  eventId,
  userId,
}: {
  eventId: string;
  userId: string;
}) {
  const [linked, others, ev] = await Promise.all([
    prisma.failureLog.findMany({
      where: { userId, eventId },
      orderBy: { occurredAt: "desc" },
    }),
    prisma.failureLog.findMany({
      where: { userId, eventId: { not: eventId } },
      orderBy: { occurredAt: "desc" },
      take: 80,
      include: { event: { select: { title: true } } },
    }),
    prisma.event.findFirst({
      where: { id: eventId, userId },
      select: { eventDatetime: true, endDatetime: true, noFailureAt: true },
    }),
  ]);

  const linkedDesc = new Set(linked.map((l) => l.description.trim()));
  const otherCandidates = others.filter(
    (o) => !linkedDesc.has(o.description.trim()),
  );

  const isPast = !!ev && (ev.endDatetime ?? ev.eventDatetime) <= new Date();
  // 終了後で、まだ何も記録していない予定は「あった？なかった？」を出す。
  const askOutcome = isPast && linked.length === 0;

  return (
    <details
      id="failure-check"
      className="group scroll-mt-4 rounded-2xl bg-surface p-3 [&_summary::-webkit-details-marker]:hidden"
      open={askOutcome && !ev?.noFailureAt}
    >
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-1">
        <span className="text-sm font-semibold text-foreground">
          📓 この予定の失敗ログ（{linked.length}）
        </span>
        <span className="shrink-0 rounded-md border border-border px-2 py-0.5 text-xs text-muted group-open:hidden">
          ＋ 追加・ひらく
        </span>
        <span className="hidden shrink-0 rounded-md border border-border px-2 py-0.5 text-xs text-muted group-open:inline">
          閉じる
        </span>
      </summary>
      <p className="mt-2 px-1 text-xs text-muted">
        似た予定が発生した時に私が思い出させます。内容・金額・日付・結果は、ここからいつでも直せます。
      </p>

      {askOutcome &&
        (ev?.noFailureAt ? (
          <div className="mt-3 flex flex-wrap items-center gap-2 rounded-xl bg-surface-muted p-3 text-xs text-muted">
            <span>この予定は「失敗はなかった」で記録済みです。</span>
            <form action={markNoFailure}>
              <input type="hidden" name="eventId" value={eventId} />
              <input type="hidden" name="undo" value="1" />
              <button type="submit" className="underline hover:text-foreground">
                取り消す
              </button>
            </form>
          </div>
        ) : (
          <div className="mt-3 rounded-xl border border-border bg-surface-muted p-3">
            <p className="text-xs font-medium text-foreground">
              この予定、うっかりはありましたか？
            </p>
            <p className="mt-0.5 text-[11px] text-muted">
              あったら下の欄に一言。なければワンタップでどうぞ。
            </p>
            <form action={markNoFailure} className="mt-2">
              <input type="hidden" name="eventId" value={eventId} />
              <SubmitButton variant="ghost">なかった 🙆</SubmitButton>
            </form>
          </div>
        ))}

      {/* 紐づく失敗ログ：他のリストと同じくコンパクト表示。開くとその場で編集。 */}
      {linked.length > 0 && (
        <ul className="mt-3 divide-y divide-border overflow-hidden rounded-xl border border-border">
          {linked.map((l) => {
            const m = failureStateMeta(l.outcome);
            return (
              <li key={l.id}>
                <details className="[&_summary::-webkit-details-marker]:hidden">
                  <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-sm hover:bg-surface-muted">
                    <span className="shrink-0">{m.icon}</span>
                    <span className="min-w-0 flex-1 truncate">
                      {l.description}
                    </span>
                    <span className="shrink-0 text-[11px] text-muted">
                      {m.label} ・ {formatDateOnly(l.occurredAt)}
                    </span>
                    <span className="shrink-0 text-xs text-muted">▾</span>
                  </summary>
                  <div className="space-y-2 border-t border-border px-3 py-3">
                    <form action={updateFailureLog} className="space-y-2">
                      <input type="hidden" name="id" value={l.id} />
                      <label className="block text-xs text-muted">
                        失敗内容
                        <textarea
                          name="description"
                          required
                          rows={2}
                          defaultValue={l.description}
                          className="mt-0.5 w-full rounded-lg border bg-background px-3 py-2 text-sm text-foreground"
                        />
                      </label>
                      <label className="block text-xs text-muted">
                        結果・状態
                        <select
                          name="outcome"
                          defaultValue={l.outcome ?? ""}
                          className="mt-0.5 w-full rounded-lg border bg-background px-3 py-2 text-sm text-foreground"
                        >
                          <option value="">未確認</option>
                          <option value="linked">
                            紐付け（この予定で起こりうる）
                          </option>
                          <option value="prevented">防げた</option>
                          <option value="not_prevented">防げなかった</option>
                          <option value="irrelevant">今回は関係ない</option>
                        </select>
                      </label>
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
                            className="mt-0.5 w-full rounded-lg border bg-background px-3 py-2 text-sm"
                          />
                        </label>
                        <label className="block text-xs text-muted">
                          日付
                          <input
                            type="date"
                            name="occurredAt"
                            defaultValue={toDateInputValue(l.occurredAt)}
                            className="mt-0.5 w-full rounded-lg border bg-background px-3 py-2 text-sm"
                          />
                        </label>
                      </div>
                      <SubmitButton variant="ghost">更新</SubmitButton>
                    </form>
                    <form action={deleteFailureLog}>
                      <input type="hidden" name="id" value={l.id} />
                      <ConfirmButton
                        message="この失敗ログを削除しますか？"
                        className="text-[11px] text-muted underline hover:text-warn"
                      >
                        削除
                      </ConfirmButton>
                    </form>
                  </div>
                </details>
              </li>
            );
          })}
        </ul>
      )}

      {/* 新しく記録する（内容・金額・日付は必須） */}
      <form action={createFailureLog} className="mt-4 space-y-3">
        <input type="hidden" name="eventId" value={eventId} />
        <label className="block text-sm">
          <span className="text-muted">新しく記録する — 何が起きた？ ※必須</span>
          <textarea
            name="description"
            required
            rows={2}
            placeholder="例: 集合時間に遅刻した／保険証を忘れた"
            className="mt-1 w-full rounded-lg border bg-background px-3 py-2"
          />
        </label>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-sm">
            <span className="text-muted">推定損失額（円）※必須</span>
            <input
              type="number"
              name="estimatedLossYen"
              required
              min={0}
              step={100}
              placeholder="概算・0でも可"
              className="mt-1 w-full rounded-lg border bg-background px-3 py-2"
            />
          </label>
          <label className="block text-sm">
            <span className="text-muted">いつ？ ※必須</span>
            <input
              type="date"
              name="occurredAt"
              required
              defaultValue={jstToday()}
              className="mt-1 w-full rounded-lg border bg-background px-3 py-2"
            />
          </label>
        </div>
        <SubmitButton>記録する</SubmitButton>
      </form>

      {/* その他の失敗ログから選ぶ */}
      {otherCandidates.length > 0 && (
        <form action={logRepeatedFailure} className="mt-4 space-y-2">
          <input type="hidden" name="eventId" value={eventId} />
          <p className="text-sm text-muted">その他の失敗ログから選ぶ</p>
          <div className="flex flex-wrap gap-2">
            <select
              name="failureLogId"
              required
              defaultValue=""
              className="min-w-0 flex-1 rounded-lg border bg-background px-3 py-2 text-sm"
            >
              <option value="" disabled>
                これまでの失敗ログから選ぶ
              </option>
              {otherCandidates.map((o) => (
                <option key={o.id} value={o.id}>
                  {formatDateOnly(o.occurredAt)}
                  {o.event ? ` ・「${o.event.title}」` : ""} ・{" "}
                  {o.description.length > 30
                    ? `${o.description.slice(0, 30)}…`
                    : o.description}
                </option>
              ))}
            </select>
            <SubmitButton variant="ghost">この予定にも紐づける</SubmitButton>
          </div>
          <p className="text-[11px] text-muted">
            同じ内容がこの予定に追加されます（追加後に上の一覧で編集できます）。
          </p>
        </form>
      )}
    </details>
  );
}
