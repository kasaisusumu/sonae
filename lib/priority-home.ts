import { prisma } from "@/lib/prisma";
import { normTitle } from "@/lib/text-norm";

/**
 * ホームの「急ぎ」「そのうち」一覧（2026-10-23追加）。ver1/ver2どちらでも出す。
 * 同じ名前（項目は kind+normTitle、メッセージは FutureMessage.id）は1行にまとめ、
 * 代表項目は「直近の未来の予定の項目」（無ければ「直近の過去の予定の項目」）。
 * 完了済みの項目は候補から外す（代表を選ぶ前に除外。全部完了していればその行自体を出さない）。
 */

export type HomePriority = "urgent" | "later";

export interface PriorityHomeRow {
  key: string;
  title: string;
  /** 予定に紐づく行だけ入る。StandalonePriorityItem（予定に紐づかない行）は null。 */
  eventId: string | null;
  eventTitle: string | null;
  eventDate: Date | null;
  isPast: boolean;
  isMessage: boolean;
  /** 予定に紐づかず、ホームから直接追加した項目か（2026-10-23追加・ユーザー指定）。 */
  isStandalone: boolean;
  /** チェックボックス操作の対象 id。項目なら ChecklistItem.id、メッセージなら
   * EventFutureMessage.id、予定に紐づかない項目なら StandalonePriorityItem.id。 */
  toggleId: string;
}

interface Candidate {
  eventId: string;
  eventTitle: string;
  eventDatetime: Date;
  isPast: boolean;
  isDone: boolean;
  toggleId: string;
}

/** `predicate` に合う候補だけから代表を選ぶ（既定: 未完了）。§ `loadCompletedPriorityItems`
 * では完了済みだけを対象にするため `(c) => c.isDone` を渡す。 */
function pickRepresentative(
  candidates: Candidate[],
  predicate: (c: Candidate) => boolean = (c) => !c.isDone,
): Candidate | null {
  const open = candidates.filter(predicate);
  if (open.length === 0) return null;
  const upcoming = open
    .filter((c) => !c.isPast)
    .sort((a, b) => a.eventDatetime.getTime() - b.eventDatetime.getTime());
  if (upcoming.length > 0) return upcoming[0];
  const past = open
    .filter((c) => c.isPast)
    .sort((a, b) => b.eventDatetime.getTime() - a.eventDatetime.getTime());
  return past[0] ?? null;
}

/** 急ぎ/そのうちの通常一覧の並び順: 期限（予定日時）が早い順（ユーザー指定・
 * 2026-10-24: 「急ぎ、そのうちリストは期限が早い順に上から表示して」）。過去・未来を
 * 分けず、予定日時そのもので昇順に並べる（過去に残っている＝まだ完了していない項目は
 * 「最も期限が早い＝最も遅れている」として最上段に出る）。予定に紐づかない項目
 * （期限が無い）は、期限で比べられないため最後にまとめる。 */
function sortRows(rows: PriorityHomeRow[]): PriorityHomeRow[] {
  const dated = rows.filter((r) => r.eventDate !== null) as (PriorityHomeRow & { eventDate: Date })[];
  const undated = rows.filter((r) => r.eventDate === null);
  const sortedDated = [...dated].sort((a, b) => a.eventDate.getTime() - b.eventDate.getTime());
  return [...sortedDated, ...undated];
}

export async function loadPriorityHomeLists(
  userId: string,
): Promise<Record<HomePriority, PriorityHomeRow[]>> {
  const now = new Date();
  const result: Record<HomePriority, PriorityHomeRow[]> = { urgent: [], later: [] };

  const [itemTags, links] = await Promise.all([
    prisma.checklistItemPriority.findMany({
      where: { userId },
      select: { eventId: true, kind: true, normTitle: true, title: true, priority: true },
    }),
    prisma.eventFutureMessage.findMany({
      where: { userId, priority: { not: null } },
      select: {
        id: true,
        isDone: true,
        priority: true,
        message: { select: { id: true, body: true } },
        event: {
          select: { id: true, title: true, eventDatetime: true, endDatetime: true },
        },
      },
    }),
  ]);

  if (itemTags.length > 0) {
    const eventIds = [...new Set(itemTags.map((t) => t.eventId))];
    const items = await prisma.checklistItem.findMany({
      where: { eventId: { in: eventIds }, isSuggested: false },
      select: {
        id: true,
        eventId: true,
        kind: true,
        title: true,
        isDone: true,
        event: {
          select: { id: true, title: true, eventDatetime: true, endDatetime: true },
        },
      },
    });
    const itemIndex = new Map<string, (typeof items)[number][]>();
    for (const it of items) {
      const k = `${it.eventId}:${it.kind}:${normTitle(it.title)}`;
      const arr = itemIndex.get(k);
      if (arr) arr.push(it);
      else itemIndex.set(k, [it]);
    }

    const groups = new Map<
      string,
      { title: string; priority: HomePriority; candidates: Candidate[] }
    >();
    for (const t of itemTags) {
      if (t.priority !== "urgent" && t.priority !== "later") continue;
      const matches = itemIndex.get(`${t.eventId}:${t.kind}:${t.normTitle}`);
      if (!matches || matches.length === 0) continue;
      const groupKey = `${t.kind}:${t.normTitle}`;
      let g = groups.get(groupKey);
      if (!g) {
        g = { title: t.title, priority: t.priority, candidates: [] };
        groups.set(groupKey, g);
      }
      for (const m of matches) {
        g.candidates.push({
          eventId: m.eventId,
          eventTitle: m.event.title,
          eventDatetime: m.event.eventDatetime,
          isPast: (m.event.endDatetime ?? m.event.eventDatetime) <= now,
          isDone: m.isDone,
          toggleId: m.id,
        });
      }
    }

    for (const [groupKey, g] of groups) {
      const rep = pickRepresentative(g.candidates);
      if (!rep) continue;
      result[g.priority].push({
        key: `item:${groupKey}`,
        title: g.title,
        eventId: rep.eventId,
        eventTitle: rep.eventTitle,
        eventDate: rep.eventDatetime,
        isPast: rep.isPast,
        isMessage: false,
        isStandalone: false,
        toggleId: rep.toggleId,
      });
    }
  }

  const messageGroups = new Map<
    string,
    { title: string; priority: HomePriority; candidates: Candidate[] }
  >();
  for (const l of links) {
    if (l.priority !== "urgent" && l.priority !== "later") continue;
    const groupKey = l.message.id;
    let g = messageGroups.get(groupKey);
    if (!g) {
      g = { title: l.message.body, priority: l.priority, candidates: [] };
      messageGroups.set(groupKey, g);
    }
    g.candidates.push({
      eventId: l.event.id,
      eventTitle: l.event.title,
      eventDatetime: l.event.eventDatetime,
      isPast: (l.event.endDatetime ?? l.event.eventDatetime) <= now,
      isDone: l.isDone,
      toggleId: l.id,
    });
  }
  for (const [groupKey, g] of messageGroups) {
    const rep = pickRepresentative(g.candidates);
    if (!rep) continue;
    result[g.priority].push({
      key: `message:${groupKey}`,
      title: g.title,
      eventId: rep.eventId,
      eventTitle: rep.eventTitle,
      eventDate: rep.eventDatetime,
      isPast: rep.isPast,
      isMessage: true,
      isStandalone: false,
      toggleId: rep.toggleId,
    });
  }

  const standaloneItems = await prisma.standalonePriorityItem.findMany({
    where: { userId, isDone: false },
    orderBy: { createdAt: "desc" },
    select: { id: true, title: true, priority: true },
  });
  for (const s of standaloneItems) {
    if (s.priority !== "urgent" && s.priority !== "later") continue;
    result[s.priority].push({
      key: `standalone:${s.id}`,
      title: s.title,
      eventId: null,
      eventTitle: null,
      eventDate: null,
      isPast: false,
      isMessage: false,
      isStandalone: true,
      toggleId: s.id,
    });
  }

  result.urgent = sortRows(result.urgent);
  result.later = sortRows(result.later);
  return result;
}

/**
 * ホームの「完了した項目を見る」ボタン用（2026-10-24追加）。指定した priority の、
 * **名前グループ全体が完了済み**な行だけを返す（同じ名前の中に1つでも未完了の
 * 候補があれば、そちらが通常の一覧（loadPriorityHomeLists）に代表として出ているため、
 * ここには出さない。二重表示を避ける）。チェックを外す（復活させる）操作は、
 * 通常の一覧と同じ toggleChecklistItemDone／toggleFutureMessageDoneAction／
 * toggleStandalonePriorityItemAction をそのまま使う（別の仕組みを作らない）。
 */
export async function loadCompletedPriorityItems(
  userId: string,
  priority: HomePriority,
): Promise<PriorityHomeRow[]> {
  // 行本体とは別に「終わった順」の並び替えキーを保持する（予定に紐づく行は、その
  // 予定の日時＝「その予定がいつ終わったか」、予定に紐づかない項目は実際にチェックを
  // 入れた時刻に最も近い StandalonePriorityItem.updatedAt を使う。どちらも
  // PriorityHomeRow の型には持たせず、ここでの並び替え専用に使う）。
  const entries: { row: PriorityHomeRow; finishedAt: Date }[] = [];
  const now = new Date();

  const itemTags = await prisma.checklistItemPriority.findMany({
    where: { userId, priority },
    select: { eventId: true, kind: true, normTitle: true, title: true },
  });
  if (itemTags.length > 0) {
    const eventIds = [...new Set(itemTags.map((t) => t.eventId))];
    const items = await prisma.checklistItem.findMany({
      where: { eventId: { in: eventIds }, isSuggested: false },
      select: {
        id: true,
        eventId: true,
        kind: true,
        title: true,
        isDone: true,
        event: { select: { id: true, title: true, eventDatetime: true, endDatetime: true } },
      },
    });
    const itemIndex = new Map<string, (typeof items)[number][]>();
    for (const it of items) {
      const k = `${it.eventId}:${it.kind}:${normTitle(it.title)}`;
      const arr = itemIndex.get(k);
      if (arr) arr.push(it);
      else itemIndex.set(k, [it]);
    }
    const groups = new Map<string, { title: string; candidates: Candidate[] }>();
    for (const t of itemTags) {
      const matches = itemIndex.get(`${t.eventId}:${t.kind}:${t.normTitle}`);
      if (!matches || matches.length === 0) continue;
      const groupKey = `${t.kind}:${t.normTitle}`;
      let g = groups.get(groupKey);
      if (!g) {
        g = { title: t.title, candidates: [] };
        groups.set(groupKey, g);
      }
      for (const m of matches) {
        g.candidates.push({
          eventId: m.eventId,
          eventTitle: m.event.title,
          eventDatetime: m.event.eventDatetime,
          isPast: (m.event.endDatetime ?? m.event.eventDatetime) <= now,
          isDone: m.isDone,
          toggleId: m.id,
        });
      }
    }
    for (const [groupKey, g] of groups) {
      if (g.candidates.some((c) => !c.isDone)) continue;
      const rep = pickRepresentative(g.candidates, (c) => c.isDone);
      if (!rep) continue;
      entries.push({
        row: {
          key: `item:${groupKey}`,
          title: g.title,
          eventId: rep.eventId,
          eventTitle: rep.eventTitle,
          eventDate: rep.eventDatetime,
          isPast: rep.isPast,
          isMessage: false,
          isStandalone: false,
          toggleId: rep.toggleId,
        },
        finishedAt: rep.eventDatetime,
      });
    }
  }

  const links = await prisma.eventFutureMessage.findMany({
    where: { userId, priority },
    select: {
      id: true,
      isDone: true,
      message: { select: { id: true, body: true } },
      event: { select: { id: true, title: true, eventDatetime: true, endDatetime: true } },
    },
  });
  const messageGroups = new Map<string, { title: string; candidates: Candidate[] }>();
  for (const l of links) {
    const groupKey = l.message.id;
    let g = messageGroups.get(groupKey);
    if (!g) {
      g = { title: l.message.body, candidates: [] };
      messageGroups.set(groupKey, g);
    }
    g.candidates.push({
      eventId: l.event.id,
      eventTitle: l.event.title,
      eventDatetime: l.event.eventDatetime,
      isPast: (l.event.endDatetime ?? l.event.eventDatetime) <= now,
      isDone: l.isDone,
      toggleId: l.id,
    });
  }
  for (const [groupKey, g] of messageGroups) {
    if (g.candidates.some((c) => !c.isDone)) continue;
    const rep = pickRepresentative(g.candidates, (c) => c.isDone);
    if (!rep) continue;
    entries.push({
      row: {
        key: `message:${groupKey}`,
        title: g.title,
        eventId: rep.eventId,
        eventTitle: rep.eventTitle,
        eventDate: rep.eventDatetime,
        isPast: rep.isPast,
        isMessage: true,
        isStandalone: false,
        toggleId: rep.toggleId,
      },
      finishedAt: rep.eventDatetime,
    });
  }

  const standaloneItems = await prisma.standalonePriorityItem.findMany({
    where: { userId, isDone: true, priority },
    select: { id: true, title: true, updatedAt: true },
  });
  for (const s of standaloneItems) {
    entries.push({
      row: {
        key: `standalone:${s.id}`,
        title: s.title,
        eventId: null,
        eventTitle: null,
        eventDate: null,
        isPast: false,
        isMessage: false,
        isStandalone: true,
        toggleId: s.id,
      },
      finishedAt: s.updatedAt,
    });
  }

  // 「終わったのが遅い順に上から」＝ finishedAt の降順（ユーザー指定・2026-10-24）。
  entries.sort((a, b) => b.finishedAt.getTime() - a.finishedAt.getTime());
  return entries.map((e) => e.row);
}
