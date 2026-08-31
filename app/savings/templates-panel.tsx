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
    <details className="rounded-xl bg-background p-3 [&_summary::-webkit-details-marker]:hidden">
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

function KindGroup({
  kind,
  templates,
}: {
  kind: "task" | "belonging";
  templates: TemplateDetail[];
}) {
  const list = templates.filter((t) => t.kind === kind);
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-teal-dark">
          {KIND_LABEL[kind]}のリスト
        </h3>
        <span className="text-xs text-muted">{list.length}件</span>
      </div>

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

/** 学習内容ページに置く「名前をつけたリスト（テンプレート）」パネル。 */
export function TemplatesPanel({ templates }: { templates: TemplateDetail[] }) {
  return (
    <details
      className="rounded-2xl bg-surface p-4 [&_summary::-webkit-details-marker]:hidden"
      open={templates.length > 0}
    >
      <summary className="cursor-pointer list-none text-base font-semibold">
        名前をつけたリスト（テンプレート）
        <span className="ml-2 text-xs font-normal text-muted">
          {templates.length}件
        </span>
      </summary>
      <p className="mt-1 text-xs text-muted">
        よく使う準備すること・持ち物に名前を付けて保存。準備すること用と持ち物用は分けています。
        予定ページの「📋 テンプレート・他の予定から」でどの予定にも追加できます。
      </p>
      <div className="mt-3 grid gap-4 sm:grid-cols-2">
        <KindGroup kind="task" templates={templates} />
        <KindGroup kind="belonging" templates={templates} />
      </div>
    </details>
  );
}
