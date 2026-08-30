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
      <Link
        href="/events"
        className="text-sm text-muted no-underline hover:text-teal-dark"
      >
        ← 予定一覧
      </Link>

      <header className="rounded-2xl bg-surface p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-xl font-semibold">{event.title}</h1>
            <p className="mt-1 text-sm text-muted">
              {formatDateTime(event.eventDatetime)}
              {event.source === "google" ? " ・ Google" : " ・ 手動"}
            </p>
          </div>
          <CategorySelect
            eventId={event.id}
            current={event.category?.name ?? "その他"}
            options={categoryNames}
          />
        </div>
        {event.memo && (
          <p className="mt-3 whitespace-pre-wrap rounded-lg bg-surface-muted p-3 text-sm text-muted">
            {event.memo}
          </p>
        )}
      </header>

      <Suspense fallback={<ChecklistSectionSkeleton />}>
        <ChecklistSection
          event={{
            id: event.id,
            userId: event.userId,
            title: event.title,
            eventDatetime: event.eventDatetime,
            categoryId: event.categoryId,
            failureWarningAckAt: event.failureWarningAckAt,
            category: event.category
              ? { name: event.category.name }
              : null,
          }}
        />
      </Suspense>
    </div>
  );
}
