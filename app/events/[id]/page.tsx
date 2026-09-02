import { Suspense } from "react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { DEFAULT_CATEGORIES } from "@/lib/categories";
import { formatDateTime } from "@/lib/format";
import { CategorySelect } from "../category-select";
import {
  ChecklistSection,
  ChecklistSectionSkeleton,
} from "./checklist-section";
import { ScrollToHash } from "./scroll-to-hash";
import { InfoHint } from "@/app/components/info-hint";

// 初回表示時に準備リストを OpenAI で生成することがあるため長めに
export const maxDuration = 60;

export default async function EventDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) redirect("/");

  const [event, categories] = await Promise.all([
    prisma.event.findFirst({
      where: { id, userId: user.id },
      include: { category: true },
    }),
    prisma.category.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "asc" },
    }),
  ]);
  if (!event) notFound();

  const categoryNames = Array.from(
    new Set([...DEFAULT_CATEGORIES, ...categories.map((c) => c.name)]),
  );

  return (
    <div className="space-y-6">
      <ScrollToHash />
      <Link
        href="/events"
        className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-2 text-sm font-medium text-foreground no-underline shadow-sm transition-colors hover:bg-surface-muted active:bg-surface-muted"
      >
        <span aria-hidden className="text-base leading-none">
          ←
        </span>
        予定一覧にもどる
      </Link>

      {/* 予定の情報は見出し程度に。主役は下の準備リスト。 */}
      <header className="space-y-2">
        <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
          <h1 className="min-w-0 flex-1 text-2xl font-semibold leading-tight tracking-tight">
            {event.title}
          </h1>
          <CategorySelect
            eventId={event.id}
            current={event.category?.name ?? "その他"}
            options={categoryNames}
          />
        </div>
        <p className="text-sm text-muted">
          {formatDateTime(event.eventDatetime)}
          {event.source === "google" ? " ・ Google" : " ・ 手動"}
        </p>
        {event.memo && (
          <p className="whitespace-pre-wrap rounded-xl bg-surface-muted p-3 text-sm text-muted">
            {event.memo}
          </p>
        )}
      </header>

      <h2 className="flex items-center gap-1.5 border-t border-border pt-5 text-lg font-semibold tracking-tight">
        準備リスト
        <InfoHint>
          追加・削除・通知タイミングの変更は、この種類の予定の学習に使われます。
        </InfoHint>
      </h2>

      <Suspense fallback={<ChecklistSectionSkeleton />}>
        <ChecklistSection
          event={{
            id: event.id,
            userId: event.userId,
            title: event.title,
            memo: event.memo,
            eventDatetime: event.eventDatetime,
            endDatetime: event.endDatetime,
            categoryId: event.categoryId,
            recurringEventId: event.recurringEventId,
            failureWarningAckAt: event.failureWarningAckAt,
            listReminderLeads: event.listReminderLeads,
            category: event.category
              ? { name: event.category.name }
              : null,
          }}
        />
      </Suspense>
    </div>
  );
}
