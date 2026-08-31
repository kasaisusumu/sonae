import {
  applyTemplateToEvent,
  copyListFromEvent,
  saveListAsTemplate,
} from "@/app/actions";
import { getEventsWithLists, getUserTemplates } from "@/lib/templates";
import { SubmitButton } from "@/app/components/submit-button";

/**
 * 予定ページの「テンプレート・他の予定から」ツール。
 * - いまのリストに名前を付けて保存
 * - 保存済みテンプレートを追加
 * - 他の予定（過去のデータ）のリストをコピー
 */
export async function ListToolbox({
  eventId,
  userId,
}: {
  eventId: string;
  userId: string;
}) {
  const [templates, pastEvents] = await Promise.all([
    getUserTemplates(userId),
    getEventsWithLists(userId, eventId),
  ]);

  return (
    <details className="rounded-2xl bg-surface p-4 [&_summary::-webkit-details-marker]:hidden">
      <summary className="cursor-pointer list-none text-sm font-medium text-teal-dark">
        📋 テンプレート・他の予定から
      </summary>

      <div className="mt-4 space-y-5">
        {/* いまのリストを保存 */}
        <form action={saveListAsTemplate} className="space-y-1.5">
          <input type="hidden" name="eventId" value={eventId} />
          <p className="text-xs font-semibold text-muted">
            いまのリストに名前を付けて保存
          </p>
          <div className="flex flex-wrap gap-2">
            <input
              name="name"
              required
              maxLength={60}
              placeholder="例: 日帰り出張セット"
              className="min-w-0 flex-1 rounded-lg border bg-background px-3 py-2 text-sm"
            />
            <SubmitButton variant="ghost">保存</SubmitButton>
          </div>
          <p className="text-[11px] text-muted">
            同じ名前で保存すると上書きします。準備すること・持ち物・通知タイミングをまとめて保存します。
          </p>
        </form>

        {/* テンプレートを使う */}
        <form action={applyTemplateToEvent} className="space-y-1.5">
          <input type="hidden" name="eventId" value={eventId} />
          <p className="text-xs font-semibold text-muted">
            保存したテンプレートを追加
          </p>
          {templates.length === 0 ? (
            <p className="text-[11px] text-muted">
              まだテンプレートはありません。上で保存すると選べます。
            </p>
          ) : (
            <div className="flex flex-wrap gap-2">
              <select
                name="templateId"
                required
                defaultValue=""
                className="min-w-0 flex-1 rounded-lg border bg-background px-3 py-2 text-sm"
              >
                <option value="" disabled>
                  テンプレートを選ぶ
                </option>
                {templates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}（準備{t.taskCount}・持ち物{t.belongingCount}）
                  </option>
                ))}
              </select>
              <SubmitButton variant="ghost">追加</SubmitButton>
            </div>
          )}
        </form>

        {/* 他の予定からコピー */}
        <form action={copyListFromEvent} className="space-y-1.5">
          <input type="hidden" name="eventId" value={eventId} />
          <p className="text-xs font-semibold text-muted">
            他の予定のリストをコピー（過去のデータを参照）
          </p>
          {pastEvents.length === 0 ? (
            <p className="text-[11px] text-muted">
              リストのある他の予定がまだありません。
            </p>
          ) : (
            <div className="flex flex-wrap gap-2">
              <select
                name="sourceEventId"
                required
                defaultValue=""
                className="min-w-0 flex-1 rounded-lg border bg-background px-3 py-2 text-sm"
              >
                <option value="" disabled>
                  予定を選ぶ
                </option>
                {pastEvents.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.eventDatetime.toLocaleDateString("ja-JP")} {e.title}（準備
                    {e.taskCount}・持ち物{e.belongingCount}）
                  </option>
                ))}
              </select>
              <SubmitButton variant="ghost">コピー</SubmitButton>
            </div>
          )}
          <p className="text-[11px] text-muted">
            すでにある項目（同じ種類・同じ名前）はスキップします。
          </p>
        </form>
      </div>
    </details>
  );
}
