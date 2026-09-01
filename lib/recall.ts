import { prisma } from "@/lib/prisma";
import type { EventFeatureData, TimeBucket } from "@/lib/features";
import { featureSignature } from "@/lib/signature";
import { norm, type GeneratedItem } from "@/lib/learning";

export interface RecalledBase {
  tasks: GeneratedItem[];
  belongings: GeneratedItem[];
  sourceEventId: string;
  /** タイトルがほぼ完全一致だったか（UI 表示や説明用）。 */
  exact: boolean;
  /** 似た過去予定で「準備リストを全部消した」と学習済み → 何も出さない。 */
  cleared?: boolean;
}

/** タイトルを比較用に正規化する（数字・記号・「第N回」などの連番を落とす）。 */
function titleKey(t: string): string {
  return norm(t)
    .replace(/[0-9０-９]+/g, "")
    .replace(/[（）()【】[\]#＃・,、.。/／\-_~＝=|｜:：]+/g, "")
    .replace(/第|回目|回|part|no|vol|day/gi, "");
}

function kwSet(keywords: string[]): Set<string> {
  return new Set(
    keywords.map((k) => k.toLowerCase()).filter((k) => k.length >= 2),
  );
}

function kwSetFromJson(raw: string | null | undefined): Set<string> {
  if (!raw) return new Set();
  try {
    const a = JSON.parse(raw);
    return kwSet(Array.isArray(a) ? (a as string[]) : []);
  } catch {
    return new Set();
  }
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

type StoredFeature = {
  isOverseas: boolean | null;
  durationNights: number | null;
  isWeekday: boolean;
  timeBucket: string | null;
};

function sigOf(ef: StoredFeature): string | null {
  if (!ef.timeBucket) return null;
  return featureSignature({
    isOverseas: ef.isOverseas,
    durationNights: ef.durationNights,
    isWeekday: ef.isWeekday,
    timeBucket: ef.timeBucket as TimeBucket,
    keywords: [],
  });
}


/**
 * 同じユーザー・同じカテゴリで、名前がほぼ同じ／似ている過去の予定があれば、
 * その予定で確定していた準備リストを「今回のベース」として丸ごと再利用する。
 *
 * 方針（ユーザー指示）:
 * - ほぼ同名・同カテゴリなら、学習が1回きりでも前回とほぼ同じ内容をそのまま出してよい。
 * - まずは似せてよい。今回の予定が違う形に編集されたら、そこで初めて学習が働いて
 *   特徴シグネチャごとに内部で枝分かれする（この関数はあくまで「たたき台」）。
 * - 特徴シグネチャまで一致する候補を少しだけ優先する。
 * - 見つからなければ null（呼び出し側が通常の AI 生成にフォールバック）。
 */
export async function recallBaseChecklist(
  event: {
    id: string;
    userId: string;
    categoryId: string | null;
    title: string;
  },
  feature: EventFeatureData,
): Promise<RecalledBase | null> {
  if (!event.categoryId) return null;

  const myKey = titleKey(event.title);
  if (myKey.length < 2) return null;
  const myKw = kwSet(feature.keywords);
  const mySig = featureSignature(feature);

  const past = await prisma.event.findMany({
    where: {
      userId: event.userId,
      categoryId: event.categoryId,
      id: { not: event.id },
      AND: [
        // 中身がある予定、または「全部消した」と学習済みの予定。
        {
          OR: [
            { checklistItems: { some: { isSuggested: false } } },
            { listCleared: true },
          ],
        },
        // 「たたき台にしてよい」のは、ユーザーが確認 or 編集した予定だけ。
        // 生成しただけで一度も見られていないリストは再利用のもとにしない。
        {
          OR: [
            { editRecords: { some: {} } },
            { listCustomized: true },
            { listReviewedAt: { not: null } },
          ],
        },
      ],
    },
    orderBy: { eventDatetime: "desc" },
    take: 50,
    select: {
      id: true,
      title: true,
      listCleared: true,
      feature: {
        select: {
          isOverseas: true,
          durationNights: true,
          isWeekday: true,
          timeBucket: true,
          keywords: true,
        },
      },
      checklistItems: {
        where: { isSuggested: false },
        orderBy: { sortOrder: "asc" },
        select: {
          kind: true,
          title: true,
          timingLabel: true,
          notifyLeadMinutes: true,
        },
      },
    },
  });

  type Scored = {
    id: string;
    items: {
      kind: string;
      title: string;
      timingLabel: string | null;
      notifyLeadMinutes: number | null;
    }[];
    rank: number;
    exact: boolean;
    cleared: boolean;
  };

  let best: Scored | null = null;
  for (const p of past) {
    // 全消し学習済みの予定は、中身ゼロでも候補にする。
    if (p.checklistItems.length === 0 && !p.listCleared) continue;
    const pKey = titleKey(p.title);
    if (pKey.length < 2) continue;

    const pKw = kwSetFromJson(p.feature?.keywords);
    let nameScore = 0;
    let exact = false;
    if (pKey === myKey) {
      nameScore = 1;
      exact = true;
    } else if (pKey.includes(myKey) || myKey.includes(pKey)) {
      nameScore = 0.8;
    } else {
      // 「少しでも名前がかすっていれば」前回の内容を出す。1語でも共有していれば拾う。
      const j = jaccard(myKw, pKw);
      if (j > 0) nameScore = 0.55 + j * 0.3;
    }
    if (nameScore === 0) continue;

    const sigMatch = p.feature ? sigOf(p.feature) === mySig : false;
    // 名前の近さが主。シグネチャ一致は小さめの上乗せ。新しい順は for の走査順で担保。
    const rank = nameScore + (sigMatch ? 0.15 : 0);
    if (!best || rank > best.rank) {
      best = {
        id: p.id,
        items: p.checklistItems,
        rank,
        exact,
        cleared: p.listCleared,
      };
    }
  }

  if (!best) return null;

  // 似た予定で「準備リストを全部消した」と学習済み → 何も出さない。
  if (best.cleared) {
    return {
      tasks: [],
      belongings: [],
      sourceEventId: best.id,
      exact: best.exact,
      cleared: true,
    };
  }

  // 組み込みの2枠だけをたたき台にする。ユーザーが足した枠（買うもの等）は
  // AI 生成のもとには使わない（同名グループのコピー経路で引き継がれる）。
  const pick = (kind: "task" | "belonging"): GeneratedItem[] =>
    best!.items
      .filter((i) => i.kind === kind)
      .map((i) => ({
        title: i.title,
        timingLabel: i.timingLabel,
        notifyLeadMinutes: i.notifyLeadMinutes,
      }));

  return {
    tasks: pick("task"),
    belongings: pick("belonging"),
    sourceEventId: best.id,
    exact: best.exact,
  };
}
