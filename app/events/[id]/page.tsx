import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { ensureChecklistForEvent } from "@/lib/checklist";
import { getLearning } from "@/lib/learning";
import { getWarningForEvent } from "@/lib/failures";
import { regenerateChecklist } from "@/app/actions";
import { formatDateTime } from "@/lib/format";
import { ChecklistEditor } from "./checklist-editor";
import { WarningPanel } from "./warning-panel";
import { SubmitButton } from "@/app/components/submit-button";

export default async function EventDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) redirect("/");

  let event = await prisma.event.findFirst({
    where: { id, userId: user.id },
    include: {
      category: true,
      checklistItems: { orderBy: { sortOrder: "asc" } },
    },
  });
  if (!event) notFound();

  if (event.checklistItems.length === 0) {
    await ensureChecklistForEvent(event.id);
    event = await prisma.event.findFirst({
      where: { id, userId: user.id },
      include: {
        category: true,
        checklistItems: { orderBy: { sortOrder: "asc" } },
      },
    });
    if (!event) notFound();
  }

  const [learning, warning] = await Promise.all([
    getLearning(event.categoryId),
    getWarningForEvent(event.id),
  ]);

  return (
    <div className="space-y-6">
      <Link
        href="/events"
        className="text-sm text-muted no-underline hover:text-teal-dark"
      >
        ← 予定一覧
      </Link>

      <header className="rounded-2xl bg-surface p-5">
        <h1 className="text-xl font-semibold">{event.title}</h1>
        <p className="mt-1 text-sm text-muted">
          {formatDateTime(event.eventDatetime)}
          {event.category ? ` ・ ${event.category.name}` : ""}
          {event.source === "google" ? " ・ Google カレンダー" : " ・ 手動登録"}
        </p>
        {event.memo && (
          <p className="mt-3 whitespace-pre-wrap rounded-lg bg-surface-muted p-3 text-sm text-muted">
            {event.memo}
          </p>
        )}
      </header>

      {warning && <WarningPanel warning={warning} />}

      <section>
        <div className="mb-2 flex items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">準備リスト</h2>
            <p className="text-xs text-muted">
              編集すると、この内容が「{event.category?.name ?? "カテゴリ"}
              」の自分マニュアルに反映され、次回同じカテゴリの予定に活かされます。
            </p>
          </div>
          <form action={regenerateChecklist}>
            <input type="hidden" name="eventId" value={event.id} />
            <SubmitButton variant="ghost">作り直す</SubmitButton>
          </form>
        </div>

        <ChecklistEditor
          eventId={event.id}
          initialItems={event.checklistItems.map((c) => ({
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
              <li>
                毎回出す:{" "}
                {learning.fixedItems.map((f) => f.title).join(" / ")}
              </li>
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
    </div>
  );
}
