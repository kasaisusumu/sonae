import {
  createListTemplate,
  deleteListTemplate,
  renameListTemplate,
} from "@/app/actions";
import type { TemplateDetail } from "@/lib/templates";
import { SubmitButton } from "@/app/components/submit-button";
import { ConfirmButton } from "@/app/components/confirm-button";
import { TemplateEditor } from "./template-editor";

const KIND_LABEL = { task: "準備すること", belonging: "持ち物" } as const;

function TemplateCard({ t }: { t: TemplateDetail }) {
  return (
    <details
      id={`tpl-${t.id}`}
      className="scroll-mt-24 rounded-xl bg-background p-3 [&_summary::-webkit-details-marker]:hidden"
    >
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 text-sm font-medium">
        <span>
          {t.name}
          <span className="ml-1.5 text-xs font-normal text-muted">
            {t.items.length}項目
          </span>
        </span>
        <span className="text-xs text-teal-dark">開いて編集</span>
      </summary>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <form action={renameListTemplate} className="flex items-center gap-1">
          <input type="hidden" name="id" value={t.id} />
          <input
            name="name"
            defaultValue={t.name}
            maxLength={60}
            className="w-40 rounded-md border bg-surface px-2 py-1 text-xs"
          />
          <button
            type="submit"
            className="rounded-md border border-border px-2 py-1 text-[11px] text-teal-dark hover:border-teal"
          >
            名前を変更
          </button>
        </form>
        <form action={deleteListTemplate}>
          <input type="hidden" name="id" value={t.id} />
          <ConfirmButton
            message={`テンプレート「${t.name}」を削除しますか？`}
            className="text-[11px] text-muted underline hover:text-warn"
          >
            削除
          </ConfirmButton>
        </form>
      </div>

      <TemplateEditor
        templateId={t.id}
        initialItems={t.items.map((i) => ({
          title: i.title,
          notifyLeadMinutes: i.notifyLeadMinutes,
        }))}
      />
    </details>
  );
}

export function KindGroup({
  kind,
  templates,
}: {
  kind: "task" | "belonging";
  templates: TemplateDetail[];
}) {
  const list = templates.filter((t) => t.kind === kind);
  return (
    <div className="space-y-2">
      <p className="text-xs text-muted">
        よく使う{KIND_LABEL[kind]}に名前を付けて保存。予定ページの「📋 テンプレート・他の予定から」で
        どの予定にも追加できます。
      </p>

      {list.length === 0 && (
        <p className="rounded-xl bg-surface px-4 py-6 text-center text-sm text-muted">
          まだありません。下の「＋ 新しいリストを作る」から作成できます。
        </p>
      )}

      {list.length > 0 && (
        <div className="space-y-1.5">
          {list.map((t) => (
            <TemplateCard key={t.id} t={t} />
          ))}
        </div>
      )}

      {/* 新規作成（一括貼り付け対応） */}
      <details className="rounded-xl bg-background p-3 [&_summary::-webkit-details-marker]:hidden">
        <summary className="cursor-pointer list-none text-xs font-medium text-teal-dark">
          ＋ {KIND_LABEL[kind]}の新しいリストを作る
        </summary>
        <form action={createListTemplate} className="mt-2 space-y-2">
          <input type="hidden" name="kind" value={kind} />
          <input
            name="name"
            required
            maxLength={60}
            placeholder="リスト名（例: 日帰り出張の持ち物）"
            className="w-full rounded-lg border bg-surface px-3 py-2 text-sm"
          />
          <textarea
            name="bulkText"
            rows={4}
            placeholder={"項目を1行に1つ貼り付け\n充電器\nモバイルバッテリー\n常備薬"}
            className="w-full rounded-lg border bg-surface px-3 py-2 text-sm"
          />
          <SubmitButton>作成する</SubmitButton>
        </form>
      </details>
    </div>
  );
}

