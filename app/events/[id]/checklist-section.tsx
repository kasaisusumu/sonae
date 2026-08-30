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

type Row = {
  id: string;
  kind: string;
  title: string;
  timingLabel: string | null;
  isDone: boolean;
  isUserAdded: boolean;
  isSuggested: boolean;
  suggestionType: string | null;
  suggestionValue: string | null;
};

function KindBlock({
  eventId,
  kind,
  rows,
}: {
  eventId: string;
  kind: "task" | "belonging";
  rows: Row[];
}) {
  const mine = rows.filter((r) => r.kind === kind);
  const suggestions = mine.filter((r) => r.isSuggested);
  const normal = mine.filter((r) => !r.isSuggested);

  return (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold text-foreground">
        {kind === "task" ? "準備すること" : "持ち物"}
      </h3>
      {suggestions.length > 0 && (
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
      )}
      <ChecklistEditor
        eventId={eventId}
        kind={kind}
        initialItems={normal.map((c) => ({
          id: c.id,
          title: c.title,
          timingLabel: c.timingLabel,
          isDone: c.isDone,
          isUserAdded: c.isUserAdded,
        }))}
      />
    </div>
  );
}

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
    after(() => syncEventDescription(event.id));
  }

  const feature = extractEventFeature({
    title: event.title,
    memo: event.memo,
    eventDatetime: event.eventDatetime,
    endDatetime: event.endDatetime,
  });
  const [warning, taskRules, belongingRules] = await Promise.all([
    getWarningForEvent(event),
    getApplicableRules(event.categoryId, feature, "task"),
    getApplicableRules(event.categoryId, feature, "belonging"),
  ]);
  const forced = [...taskRules, ...belongingRules].filter((r) => r.forced);
  const rows = items as unknown as Row[];

  return (
    <>
      {warning && <WarningPanel warning={warning} />}

      <section className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-muted">
            追加・削除・タイミング変更は、この種類の予定の学習に使われます。
          </p>
          <form action={regenerateChecklist}>
            <input type="hidden" name="eventId" value={event.id} />
            <SubmitButton variant="ghost">作り直す</SubmitButton>
          </form>
        </div>

        <KindBlock eventId={event.id} kind="task" rows={rows} />
        <KindBlock eventId={event.id} kind="belonging" rows={rows} />
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
                <li key={r.id}>
                  毎回入れる: {r.target}
                  {r.itemKind === "belonging" ? "（持ち物）" : ""}
                </li>
              ))}
            {forced
              .filter((r) => r.ruleType === "exclude_item")
              .map((r) => (
                <li key={r.id}>
                  出さない: {r.target}
                  {r.itemKind === "belonging" ? "（持ち物）" : ""}
                </li>
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
