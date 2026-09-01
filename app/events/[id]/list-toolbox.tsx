import {
  applyTemplateToEvent,
  copyListFromEvent,
  saveListAsTemplate,
} from "@/app/actions";
import { getEventsWithLists, getUserTemplates } from "@/lib/templates";
import { formatDateOnly } from "@/lib/format";
import { SubmitButton } from "@/app/components/submit-button";

const KIND_LABEL = { task: "準備すること", belonging: "持ち物" } as const;

/**
 * 予定ページの「テンプレート・他の予定から」ツール。
 * - いまのリストを種類ごと（準備すること／持ち物）に名前を付けて保存
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
    <details
      id="list-toolbox"
      className="scroll-mt-24 rounded-2xl bg-surface p-4 [&_summary::-webkit-details-marker]:hidden"
    >
      <summary className="cursor-pointer list-none text-sm font-medium text-teal-dark">
        📋 テンプレート・他の予定から
      </summary>

      <div className="mt-4 space-y-5">
        {/* いまのリストを種類ごとに保存 */}
        <form
          id="tpl-save"
          action={saveListAsTemplate}
          className="scroll-mt-24 space-y-1.5 rounded-lg"
        >
          <input type="hidden" name="eventId" value={eventId} />
          <p className="text-xs font-semibold text-muted">
            いまのリストに名前を付けて保存
          </p>
          <div className="flex flex-wrap gap-2">
            <select
              name="kind"
              defaultValue="task"
              className="rounded-lg border bg-background px-2 py-2 text-sm"
              aria-label="種類"
            >
              <option value="task">準備すること</option>
              <option value="belonging">持ち物</option>
            </select>
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
            準備すること用と持ち物用は別々に保存します。同じ種類・同じ名前なら上書きします。
          </p>
        </form>

        {/* テンプレートを使う */}
        <form
          id="tpl-apply"
          action={applyTemplateToEvent}
          className="scroll-mt-24 space-y-1.5 rounded-lg"
        >
          <input type="hidden" name="eventId" value={eventId} />
          <p className="text-xs font-semibold text-muted">
            保存したテンプレートを追加
          </p>
          {templates.length === 0 ? (
            <p className="text-[11px] text-muted">
              まだテンプレートはありません。上で保存するか、学習内容ページで作成できます。
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
                    [{KIND_LABEL[t.kind]}] {t.name}（{t.items.length}）
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
                    {formatDateOnly(e.eventDatetime)} {e.title}（準備
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
