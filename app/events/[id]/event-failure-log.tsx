import { prisma } from "@/lib/prisma";
import {
  createFailureLog,
  deleteFailureLog,
  logRepeatedFailure,
  updateFailureLog,
} from "@/app/actions";
import { formatDateOnly, formatYen, toDateInputValue } from "@/lib/format";
import { SubmitButton } from "@/app/components/submit-button";
import { ConfirmButton } from "@/app/components/confirm-button";

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
  const [linked, others] = await Promise.all([
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
  ]);

  const linkedDesc = new Set(linked.map((l) => l.description.trim()));
  const otherCandidates = others.filter(
    (o) => !linkedDesc.has(o.description.trim()),
  );

  return (
    <details
      className="rounded-2xl bg-surface p-5 [&_summary::-webkit-details-marker]:hidden"
      open={linked.length > 0}
    >
      <summary className="cursor-pointer list-none text-sm font-semibold text-muted">
        この予定の失敗ログ（{linked.length}）
      </summary>
      <p className="mt-2 text-xs text-muted">
        責めるためではなく、次に似た予定が来たときに先回りするためです。失敗内容・金額・日付・結果は、この予定のページからいつでも直せます。金額は分からなければ空でOK。
      </p>

      {/* 紐づく失敗ログ：その場で編集（失敗内容・金額・日付・結果／状態）・削除 */}
      {linked.length > 0 && (
        <ul className="mt-4 space-y-2">
          {linked.map((l) => (
            <li key={l.id} className="rounded-xl bg-surface-muted p-3">
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
                <div className="flex flex-wrap items-center gap-2">
                  <label className="text-xs text-muted">
                    結果・状態
                    <select
                      name="outcome"
                      defaultValue={l.outcome ?? ""}
                      className="ml-1 rounded-md border bg-background px-2 py-1 text-sm text-foreground"
                    >
                      <option value="">未選択</option>
                      <option value="prevented">防げた</option>
                      <option value="not_prevented">防げなかった</option>
                      <option value="irrelevant">今回は関係ない</option>
                    </select>
                  </label>
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
                  現在: {formatDateOnly(l.occurredAt)}
                  {l.estimatedLossYen > 0
                    ? ` ・ 推定 ${formatYen(l.estimatedLossYen)}`
                    : ""}
                  {" ・ "}
                  {l.outcome === "prevented"
                    ? "防げた"
                    : l.outcome === "not_prevented"
                      ? "防げなかった"
                      : l.outcome === "irrelevant"
                        ? "今回は関係ない"
                        : "未選択"}
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
