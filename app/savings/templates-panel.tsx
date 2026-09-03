import {
  deleteListTemplate,
  duplicateListTemplate,
  renameListTemplate,
  setListTemplateKind,
} from "@/app/actions";
import type { TemplateDetail } from "@/lib/templates";
import { sectionLabel } from "@/lib/sections";
import { ConfirmButton } from "@/app/components/confirm-button";
import { TemplateEditor } from "./template-editor";
import { CopyTemplateButton } from "./copy-template-button";
import { NewTemplateForm } from "./new-template-form";

function TemplateCard({ t }: { t: TemplateDetail }) {
  return (
    <details
      id={`tpl-${t.id}`}
      className="group scroll-mt-24 rounded-xl bg-background p-3 [&_summary::-webkit-details-marker]:hidden"
    >
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 text-sm font-medium">
        <span className="min-w-0">
          {t.name}
          <span className="ml-1 font-normal text-muted">
            （{sectionLabel(t.kind)}）
          </span>
          <span className="ml-1.5 text-xs font-normal text-muted">
            {t.items.length}項目
          </span>
        </span>
        <span className="shrink-0 text-xs text-teal-dark">
          <span className="group-open:hidden">開いて編集</span>
          <span className="hidden group-open:inline">閉じる</span>
        </span>
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
        <form action={setListTemplateKind} className="flex items-center gap-1">
          <input type="hidden" name="id" value={t.id} />
          <select
            name="kind"
            defaultValue={t.kind}
            aria-label="どの枠に入るか"
            className="rounded-md border bg-surface px-2 py-1 text-xs"
          >
            <option value="task">準備すること</option>
            <option value="belonging">持ち物</option>
            {t.kind !== "task" && t.kind !== "belonging" && (
              <option value={t.kind}>{t.kind}（現在の枠）</option>
            )}
          </select>
          <button
            type="submit"
            className="rounded-md border border-border px-2 py-1 text-[11px] text-teal-dark hover:border-teal"
          >
            枠を変更
          </button>
        </form>
        <CopyTemplateButton text={t.items.map((i) => i.title).join("\n")} />
        <form action={duplicateListTemplate}>
          <input type="hidden" name="id" value={t.id} />
          <button
            type="submit"
            className="rounded-md border border-border px-2 py-1 text-[11px] text-teal-dark hover:border-teal"
          >
            複製する
          </button>
        </form>
        <form action={deleteListTemplate}>
          <input type="hidden" name="id" value={t.id} />
          <ConfirmButton
            message={`マニュアル「${t.name}」を削除しますか？`}
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

/** 名前付きマニュアル。準備すること／持ち物をまとめて 1 リストで表示する。 */
export function TemplatesGroup({ templates }: { templates: TemplateDetail[] }) {
  return (
    <div className="space-y-2">
      <p className="text-xs text-muted">
        よく使う準備すること・持ち物に名前を付けて保存。予定ページの
        「📋 マニュアル・他の予定から」でどの予定にも追加できます。名前の横の
        （　）は、その予定でどの枠に入るかです。
      </p>

      {templates.length === 0 && (
        <p className="rounded-xl bg-surface px-4 py-6 text-center text-sm text-muted">
          まだありません。下の「＋ 新しいリストを作る」から作成できます。
        </p>
      )}

      {templates.length > 0 && (
        <div className="space-y-1.5">
          {templates.map((t) => (
            <TemplateCard key={t.id} t={t} />
          ))}
        </div>
      )}

      {/* 新規作成（一括貼り付け・音声入力・AI整列・枠の新設に対応） */}
      <details className="rounded-xl bg-background p-3 [&_summary::-webkit-details-marker]:hidden">
        <summary className="cursor-pointer list-none text-xs font-medium text-teal-dark">
          ＋ 新しいリストを作る
        </summary>
        <NewTemplateForm />
      </details>
    </div>
  );
}
