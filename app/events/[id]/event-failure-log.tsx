import { prisma } from "@/lib/prisma";
import {
  attachFailureToEvent,
  createFailureLog,
  deleteFailureLog,
  logRepeatedFailure,
  updateFailureLog,
} from "@/app/actions";
import { suggestFailureLogsForEvent } from "@/lib/failures";
import { formatDateOnly, formatYen, toDateInputValue } from "@/lib/format";
import { SubmitButton } from "@/app/components/submit-button";
import { ConfirmButton } from "@/app/components/confirm-button";

/**
 * 予定詳細ページの失敗ログ。
 * - 似た予定・同カテゴリからの「こんな失敗もあり得ます」提案（内容・金額・成功/失敗を選んで記録）
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
  const [linked, suggestions, others] = await Promise.all([
    prisma.failureLog.findMany({
      where: { userId, eventId },
      orderBy: { occurredAt: "desc" },
    }),
    suggestFailureLogsForEvent(eventId, 6),
    prisma.failureLog.findMany({
      where: { userId, eventId: { not: eventId } },
      orderBy: { occurredAt: "desc" },
      take: 80,
      include: { event: { select: { title: true } } },
    }),
  ]);

  const linkedDesc = new Set(linked.map((l) => l.description.trim()));
  const suggestDesc = new Set(suggestions.map((s) => s.description.trim()));
  const otherCandidates = others.filter(
    (o) =>
      !linkedDesc.has(o.description.trim()) &&
      !suggestDesc.has(o.description.trim()),
  );

  return (
    <details
      className="rounded-2xl bg-surface p-5 [&_summary::-webkit-details-marker]:hidden"
      open={suggestions.length > 0}
    >
      <summary className="cursor-pointer list-none text-sm font-semibold text-muted">
        この予定の失敗ログ（{linked.length}）
        {suggestions.length > 0 && (
          <span className="ml-2 rounded-full bg-warn-soft px-2 py-0.5 text-[11px] text-warn">
            提案 {suggestions.length}
          </span>
        )}
      </summary>
      <p className="mt-2 text-xs text-muted">
        責めるためではなく、次に似た予定が来たときに先回りするためです。金額は分からなければ空でOK。
      </p>

      {/* 似た予定・同カテゴリからの提案 */}
      {suggestions.length > 0 && (
        <div className="mt-3 space-y-2">
          <p className="text-xs font-semibold text-warn">
            こんな失敗もあり得ます（似た予定から）
          </p>
          {suggestions.map((s) => (
            <form
              key={s.sourceId}
              action={attachFailureToEvent}
              className="space-y-2 rounded-xl border border-warn/30 bg-warn-soft p-3"
            >
              <input type="hidden" name="eventId" value={eventId} />
              <div className="flex flex-wrap gap-1">
                {s.reasons.map((r) => (
                  <span
                    key={r}
                    className="rounded bg-surface px-1.5 py-0.5 text-[10px] text-muted"
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
              <div className="flex flex-wrap items-center gap-3">
                <label className="text-xs text-muted">
                  金額（円）
                  <input
                    type="number"
                    name="estimatedLossYen"
                    min={0}
                    step={100}
                    defaultValue={s.estimatedLossYen || ""}
                    placeholder="任意"
                    className="ml-1 w-24 rounded-md border bg-background px-2 py-1 text-sm"
                  />
                </label>
                <span className="inline-flex items-center gap-2 text-xs text-muted">
                  <label className="inline-flex items-center gap-1">
                    <input
                      type="radio"
                      name="outcome"
                      value=""
                      defaultChecked
                    />
                    まだ
                  </label>
                  <label className="inline-flex items-center gap-1">
                    <input type="radio" name="outcome" value="prevented" />
                    防げた
                  </label>
                  <label className="inline-flex items-center gap-1">
                    <input type="radio" name="outcome" value="not_prevented" />
                    防げなかった
                  </label>
                </span>
                <SubmitButton variant="ghost">この予定に記録</SubmitButton>
              </div>
            </form>
          ))}
        </div>
      )}

      {/* 紐づく失敗ログ：その場で編集・削除 */}
      {linked.length > 0 && (
        <ul className="mt-4 space-y-2">
          {linked.map((l) => (
            <li key={l.id} className="rounded-xl bg-surface-muted p-3">
              <form action={updateFailureLog} className="space-y-2">
                <input type="hidden" name="id" value={l.id} />
                <textarea
                  name="description"
                  required
                  rows={2}
                  defaultValue={l.description}
                  className="w-full rounded-lg border bg-background px-3 py-2 text-sm"
                />
                <div className="flex flex-wrap items-center gap-2">
                  <label className="text-xs text-muted">
                    金額（円）
                    <input
                      type="number"
                      name="estimatedLossYen"
                      min={0}
                      step={100}
                      defaultValue={l.estimatedLossYen || ""}
                      placeholder="任意"
                      className="ml-1 w-24 rounded-md border bg-background px-2 py-1 text-sm"
                    />
                  </label>
                  <label className="text-xs text-muted">
                    日付
                    <input
                      type="date"
                      name="occurredAt"
                      defaultValue={toDateInputValue(l.occurredAt)}
                      className="ml-1 rounded-md border bg-background px-2 py-1 text-sm"
                    />
                  </label>
                  <SubmitButton variant="ghost">更新</SubmitButton>
                </div>
              </form>
              <div className="mt-1.5 flex items-center gap-3 text-[11px] text-muted">
                <span>
                  {formatDateOnly(l.occurredAt)}
                  {l.estimatedLossYen > 0
                    ? ` ・ 推定 ${formatYen(l.estimatedLossYen)}`
                    : ""}
                  {l.outcome === "prevented"
                    ? " ・ 防げた"
                    : l.outcome === "not_prevented"
                      ? " ・ 防げなかった"
                      : ""}
                </span>
                <form action={deleteFailureLog}>
                  <input type="hidden" name="id" value={l.id} />
                  <ConfirmButton
                    message="この失敗ログを削除しますか？"
                    className="underline hover:text-warn"
                  >
                    削除
                  </ConfirmButton>
                </form>
              </div>
            </li>
          ))}
        </ul>
      )}

      {/* 新しく記録する */}
      <form action={createFailureLog} className="mt-4 space-y-3">
        <input type="hidden" name="eventId" value={eventId} />
        <label className="block text-sm">
          <span className="text-muted">新しく記録する — 何が起きた？</span>
          <textarea
            name="description"
            required
            rows={2}
            placeholder="例: 集合時間に遅刻した／保険証を忘れた"
            className="mt-1 w-full rounded-lg border bg-background px-3 py-2"
          />
        </label>
        <label className="block text-sm sm:max-w-xs">
          <span className="text-muted">推定損失額（円・任意）</span>
          <input
            type="number"
            name="estimatedLossYen"
            min={0}
            step={100}
            placeholder="なくてもOK"
            className="mt-1 w-full rounded-lg border bg-background px-3 py-2"
          />
        </label>
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
