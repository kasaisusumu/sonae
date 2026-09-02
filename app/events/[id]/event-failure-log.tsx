import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";
import { markNoFailure } from "@/app/actions";
import { SubmitButton } from "@/app/components/submit-button";
import {
  FailureListEditor,
  type FLOther,
  type FLRow,
} from "./failure-list-editor";

/**
 * 予定詳細ページの失敗ログ。準備リストの各枠と同じ見た目・操作（<FailureListEditor>）。
 * 加えて、終了後まだ何も記録していない予定には「うっかりあった？なかった？」を出す。
 */
export async function EventFailureLog({
  eventId,
  userId: userIdProp,
}: {
  eventId: string;
  /** 省略時はセッションから解決（学習内容ページなどから使う）。 */
  userId?: string;
}) {
  const userId = userIdProp ?? (await getCurrentUser())?.id;
  if (!userId) return null;

  const [linked, others, ev] = await Promise.all([
    prisma.failureLog.findMany({
      where: { userId, eventId },
      orderBy: { occurredAt: "desc" },
      select: {
        id: true,
        description: true,
        outcome: true,
        estimatedLossYen: true,
        occurredAt: true,
      },
    }),
    prisma.failureLog.findMany({
      where: { userId, eventId: { not: eventId } },
      orderBy: { occurredAt: "desc" },
      take: 80,
      select: {
        id: true,
        description: true,
        occurredAt: true,
        event: { select: { title: true } },
      },
    }),
    prisma.event.findFirst({
      where: { id: eventId, userId },
      select: { eventDatetime: true, endDatetime: true, noFailureAt: true },
    }),
  ]);

  const linkedDesc = new Set(linked.map((l) => l.description.trim()));
  const otherCandidates: FLOther[] = others
    .filter((o) => !linkedDesc.has(o.description.trim()))
    .map((o) => ({
      id: o.id,
      description: o.description,
      occurredAt: o.occurredAt,
      eventTitle: o.event?.title ?? null,
    }));

  const isPast = !!ev && (ev.endDatetime ?? ev.eventDatetime) <= new Date();
  const askOutcome = isPast && linked.length === 0;

  return (
    <div id="failure-check" className="scroll-mt-4 space-y-2">
      {askOutcome &&
        (ev?.noFailureAt ? (
          <div className="flex flex-wrap items-center gap-2 rounded-xl bg-surface-muted p-3 text-xs text-muted">
            <span>「失敗はなかった」で記録済み。</span>
            <form action={markNoFailure}>
              <input type="hidden" name="eventId" value={eventId} />
              <input type="hidden" name="undo" value="1" />
              <button type="submit" className="underline hover:text-foreground">
                取り消す
              </button>
            </form>
          </div>
        ) : (
          <div className="rounded-xl border border-border bg-surface-muted p-3">
            <p className="text-xs font-medium text-foreground">
              この予定、うっかりはありましたか？
            </p>
            <p className="mt-0.5 text-[11px] text-muted">
              あったら下の「＋ 追加」で一言。なければワンタップで。
            </p>
            <form action={markNoFailure} className="mt-2">
              <input type="hidden" name="eventId" value={eventId} />
              <SubmitButton variant="ghost">なかった 🙆</SubmitButton>
            </form>
          </div>
        ))}

      <FailureListEditor
        eventId={eventId}
        label="この予定の失敗ログ"
        initial={linked as FLRow[]}
        others={otherCandidates}
      />
    </div>
  );
}
