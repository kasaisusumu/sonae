/**
 * 準備リストの項目の「急ぎ」「そのうち」タグ（2026-10-23追加）。
 *
 * - `ChecklistItem` には持たせない（`saveChecklist` が保存のたびに項目行を作り直し、
 *   id が変わるため）。`(eventId, kind, normTitle)` に紐づく別テーブル
 *   （`ChecklistItemPriority`、`ChecklistItemImage` と同じ考え方）に持つ。
 * - 選ぶ／選び直す／もう一度押して解除のどれも、行の upsert／delete で表現する
 *   （`priority` 列は null を使わず、「行が無い」＝未設定）。
 * - 同じ項目名（`kind:normTitle`）を持つ**他の全ての予定**にも連動して書き込む
 *   （`lib/item-scope.ts` の `saveScopeForItem` の連動方式と同じ考え方。予定の
 *   新旧は見ない）。
 * - 新しい予定に、学習・再利用・コピー・パターン提案で項目の結びつきが作られるときは
 *   このテーブルを一切参照しないため、自然と「引き継がず未設定で始まる」。
 */
import { prisma } from "@/lib/prisma";
import { normTitle } from "@/lib/text-norm";

export type ItemPriority = "urgent" | "later";

/** 1つの予定の、項目（kind+normTitle）ごとの現在の優先度（無ければ undefined）。 */
export async function loadItemPriorityMap(
  eventId: string,
): Promise<Map<string, ItemPriority>> {
  const rows = await prisma.checklistItemPriority.findMany({
    where: { eventId },
    select: { kind: true, normTitle: true, priority: true },
  });
  return new Map(
    rows.map((r) => [`${r.kind}:${r.normTitle}`, r.priority as ItemPriority]),
  );
}

/**
 * 項目の優先度を設定・解除する。同じ項目名（kind+normTitle）を持つ、この利用者の
 * 他の全ての既存の予定の実際の項目にも、その場で同じ内容を連動させる
 * （予定の新旧は見ない。初めてこの名前にタグを付けたときも対象）。
 * 判定は「既にタグが付いている行」ではなく「実際に同名の ChecklistItem が存在する予定」
 * を基準にする（既にタグ済みの行だけを基準にすると、初めて選んだときに他の既存予定へ
 * 連動しない）。この書き込みの“あと”に学習・再利用・コピー等で作られる新しい予定は、
 * ここを一切参照しないため自然に未設定で始まる。
 */
export async function setItemPriority(input: {
  userId: string;
  eventId: string;
  kind: string;
  title: string;
  priority: ItemPriority | null;
}): Promise<void> {
  const nt = normTitle(input.title);
  if (!nt) return;

  const priority = input.priority;
  if (priority === null) {
    await prisma.checklistItemPriority.deleteMany({
      where: { userId: input.userId, kind: input.kind, normTitle: nt },
    });
    return;
  }

  const items = await prisma.checklistItem.findMany({
    where: { kind: input.kind, isSuggested: false, event: { userId: input.userId } },
    select: { eventId: true, title: true },
  });
  const eventIds = new Set(
    items.filter((it) => normTitle(it.title) === nt).map((it) => it.eventId),
  );
  // 操作した予定自身は、実際の項目行がまだ無い場合（追加直後の保存前など）でも対象にする
  eventIds.add(input.eventId);

  await prisma.$transaction(
    [...eventIds].map((eventId) =>
      prisma.checklistItemPriority.upsert({
        where: { eventId_kind_normTitle: { eventId, kind: input.kind, normTitle: nt } },
        update: { priority, title: input.title },
        create: {
          userId: input.userId,
          eventId,
          kind: input.kind,
          normTitle: nt,
          title: input.title,
          priority,
        },
      }),
    ),
  );
}

/**
 * 項目名の書き換え（この予定の中だけ）に合わせて、優先度の紐づけも付け替える。
 * 他の予定の同名の行、他の項目名の行には一切触れない。
 */
export async function renameItemPriority(
  eventId: string,
  kind: string,
  fromTitle: string,
  toTitle: string,
): Promise<void> {
  const fromNorm = normTitle(fromTitle);
  const toNorm = normTitle(toTitle);
  if (!fromNorm || !toNorm || fromNorm === toNorm) return;
  // 新しい名前の行が既にこの予定に存在するなら、古い方は捨てる（合流）。
  const existingNew = await prisma.checklistItemPriority.findUnique({
    where: { eventId_kind_normTitle: { eventId, kind, normTitle: toNorm } },
  });
  if (existingNew) {
    await prisma.checklistItemPriority.deleteMany({
      where: { eventId, kind, normTitle: fromNorm },
    });
    return;
  }
  await prisma.checklistItemPriority
    .updateMany({
      where: { eventId, kind, normTitle: fromNorm },
      data: { normTitle: toNorm, title: toTitle },
    })
    .catch(() => {
      /* 同時書き込み等で稀に一意制約に触れても、優先度タグは補助的な情報なので無視する */
    });
}

/**
 * 「同名グループの波及」（`propagateListToNameGroup`／`resolveNameGroupOnEdit`）で
 * 既存の予定（toEventId）の項目が source（fromEventId）の内容で丸ごと置き換わるとき、
 * 優先度タグも source の内容に合わせて置き換える。
 *
 * これは `copyChecklistItems` の呼び出し元のうち、**既に項目を持っていた予定を
 * 編集内容に合わせて更新し直す**経路（`propagateListToNameGroup`）だけから呼ぶこと。
 * 「まだ項目が一つも無い新しい予定」に初めて項目を持たせる経路
 * （`generateAndSaveChecklist`・`primeNotifiedChecklists` が同じ `copyChecklistItems`
 * を呼ぶ別の2箇所）からは呼ばない。新しい予定は優先度タグを引き継がず未設定で
 * 始まる、という方針（上記ファイル冒頭コメント）はこの関数を呼ばないことで守られる。
 */
export async function copyItemPriorityForNameGroup(
  fromEventId: string,
  toEventId: string,
): Promise<void> {
  const srcTags = await prisma.checklistItemPriority.findMany({
    where: { eventId: fromEventId },
    select: { userId: true, kind: true, normTitle: true, title: true, priority: true },
  });
  await prisma.$transaction([
    prisma.checklistItemPriority.deleteMany({ where: { eventId: toEventId } }),
    ...(srcTags.length > 0
      ? [
          prisma.checklistItemPriority.createMany({
            data: srcTags.map((t) => ({
              userId: t.userId,
              eventId: toEventId,
              kind: t.kind,
              normTitle: t.normTitle,
              title: t.title,
              priority: t.priority,
            })),
          }),
        ]
      : []),
  ]);
}

/**
 * 枠の改名（renameSectionKind）に合わせて、優先度の紐づけの kind も付け替える。
 * その予定（eventId）の中だけが対象。
 */
export async function renameItemPriorityKind(
  eventId: string,
  oldKind: string,
  newKind: string,
): Promise<void> {
  if (!oldKind || !newKind || oldKind === newKind) return;
  await prisma.checklistItemPriority
    .updateMany({
      where: { eventId, kind: oldKind },
      data: { kind: newKind },
    })
    .catch(() => {
      /* 合流先に同名の行が既にあり一意制約に触れる場合も、優先度タグは補助的な
         情報なので処理全体を失敗させない（古い行は kind だけ古いまま残るが、
         該当する項目はその枠に二度と現れないため実害は無い）。 */
    });
}
