import { prisma } from "@/lib/prisma";
import { ensureChecklistForEvent } from "@/lib/checklist";
import { getLearning } from "@/lib/learning";
import { getWarningForEvent } from "@/lib/failures";
import { regenerateChecklist } from "@/app/actions";
import { ChecklistEditor } from "./checklist-editor";
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
    eventDatetime: Date;
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
  }

  const [learning, warning] = await Promise.all([
    getLearning(event.categoryId),
    getWarningForEvent(event),
  ]);

  return (
    <>
      {warning && <WarningPanel warning={warning} />}

      <section>
        <div className="mb-2 flex items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">準備リスト</h2>
            <p className="text-xs text-muted">
              編集すると「{event.category?.name ?? "カテゴリ"}
              」の自分マニュアルに反映され、次回に活かされます。
            </p>
          </div>
          <form action={regenerateChecklist}>
            <input type="hidden" name="eventId" value={event.id} />
            <SubmitButton variant="ghost">作り直す</SubmitButton>
          </form>
        </div>

        <ChecklistEditor
          eventId={event.id}
          initialItems={items.map((c) => ({
            id: c.id,
            title: c.title,
            timingLabel: c.timingLabel,
            isDone: c.isDone,
            isUserAdded: c.isUserAdded,
          }))}
        />
      </section>

      {(learning.excludedItems.length > 0 ||
        learning.fixedItems.length > 0 ||
        Object.keys(learning.timingOverrides).length > 0) && (
        <section className="rounded-2xl bg-teal-soft p-5 text-sm">
          <h3 className="font-semibold text-teal-dark">
            このカテゴリで学習済みのこと
          </h3>
          <ul className="mt-2 space-y-1 text-teal-dark/90">
            {learning.fixedItems.length > 0 && (
              <li>毎回出す: {learning.fixedItems.map((f) => f.title).join(" / ")}</li>
            )}
            {learning.excludedItems.length > 0 && (
              <li>もう出さない: {learning.excludedItems.join(" / ")}</li>
            )}
            {Object.keys(learning.timingOverrides).length > 0 && (
              <li>
                タイミング調整:{" "}
                {Object.entries(learning.timingOverrides)
                  .map(([t, v]) => `${t}→${v}`)
                  .join(" / ")}
              </li>
            )}
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
