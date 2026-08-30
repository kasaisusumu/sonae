import Link from "next/link";
import { after } from "next/server";
import { prisma } from "@/lib/prisma";
import { ensureChecklistForEvent } from "@/lib/checklist";
import { syncEventDescription } from "@/lib/description-sync";
import { extractEventFeature } from "@/lib/features";
import { getApplicableRules } from "@/lib/learning";
import { getWarningForEvent } from "@/lib/failures";
import { regenerateChecklist } from "@/app/actions";
import { ChecklistEditor } from "./checklist-editor";
import { SuggestionList } from "./suggestion-list";
import { WarningPanel } from "./warning-panel";
import { SubmitButton } from "@/app/components/submit-button";

/**
 * 重い処理（初回は OpenAI で準備リスト生成）をまとめた部分。
 * page.tsx の <Suspense> 境界内で描画され、ページ枠より後から差し込まれる。
 */
export async function ChecklistSection({
  event,
}: {
  event: {
    id: string;
    userId: string;
    title: string;
    memo: string | null;
    eventDatetime: Date;
    endDatetime: Date | null;
    categoryId: string | null;
    failureWarningAckAt: Date | null;
    category: { name: string } | null;
  };
}) {
  let items = await prisma.checklistItem.findMany({
    where: { eventId: event.id },
    orderBy: { sortOrder: "asc" },
  });
  if (items.length === 0) {
    await ensureChecklistForEvent(event.id);
    items = await prisma.checklistItem.findMany({
      where: { eventId: event.id },
      orderBy: { sortOrder: "asc" },
    });
    // 初回生成後、説明欄書き込みが有効なら反映（レスポンスはブロックしない）
    after(() => syncEventDescription(event.id));
  }

  const feature = extractEventFeature({
    title: event.title,
    memo: event.memo,
    eventDatetime: event.eventDatetime,
    endDatetime: event.endDatetime,
  });
  const [warning, rules] = await Promise.all([
    getWarningForEvent(event),
    getApplicableRules(event.categoryId, feature),
  ]);
  const forced = rules.filter((r) => r.forced);

  const normal = items.filter((i) => !i.isSuggested);
  const suggestions = items.filter((i) => i.isSuggested);

  return (
    <>
      {warning && <WarningPanel warning={warning} />}

      <section>
        <div className="mb-2 flex items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">準備リスト</h2>
            <p className="text-xs text-muted">
              追加・削除・タイミング変更は学習に使われ、次回以降の精度が上がります。
            </p>
          </div>
          <form action={regenerateChecklist}>
            <input type="hidden" name="eventId" value={event.id} />
            <SubmitButton variant="ghost">作り直す</SubmitButton>
          </form>
        </div>

        {suggestions.length > 0 && (
          <div className="mb-3">
            <SuggestionList
              suggestions={suggestions.map((s) => ({
                id: s.id,
                title: s.title,
                timingLabel: s.timingLabel,
                suggestionType: s.suggestionType as
                  | "exclude"
                  | "add"
                  | "timing"
                  | null,
                suggestionValue: s.suggestionValue,
              }))}
            />
          </div>
        )}

        <ChecklistEditor
          eventId={event.id}
          initialItems={normal.map((c) => ({
            id: c.id,
            title: c.title,
            timingLabel: c.timingLabel,
            isDone: c.isDone,
            isUserAdded: c.isUserAdded,
          }))}
        />
      </section>

      {forced.length > 0 && (
        <section className="rounded-2xl bg-teal-soft p-4 text-sm">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-teal-dark">
              この種類の予定で学習済みのこと
            </h3>
            <Link
              href="/settings/learning"
              className="text-xs text-teal-dark underline"
            >
              確認・編集
            </Link>
          </div>
          <ul className="mt-2 space-y-1 text-teal-dark/90">
            {forced
              .filter((r) => r.ruleType === "fixed_item")
              .map((r) => (
                <li key={r.id}>毎回入れる: {r.target}</li>
              ))}
            {forced
              .filter((r) => r.ruleType === "exclude_item")
              .map((r) => (
                <li key={r.id}>出さない: {r.target}</li>
              ))}
            {forced
              .filter((r) => r.ruleType === "timing_override")
              .map((r) => (
                <li key={r.id}>
                  {r.target} → {r.value}
                </li>
              ))}
          </ul>
        </section>
      )}
    </>
  );
}

export function ChecklistSectionSkeleton() {
  return (
    <div className="animate-pulse space-y-3" aria-hidden>
      <div className="h-6 w-32 rounded bg-surface-muted" />
      <div className="space-y-2 rounded-2xl bg-surface p-4">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-6 rounded bg-surface-muted" />
        ))}
        <p className="pt-2 text-xs text-muted">準備リストを作成中…（初回のみ数秒）</p>
      </div>
    </div>
  );
}
