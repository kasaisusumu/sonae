import { prisma } from "@/lib/prisma";

export interface GeneratedItem {
  title: string;
  timingLabel: string | null;
}

export interface Learning {
  excludedItems: string[];
  fixedItems: GeneratedItem[];
  timingOverrides: Record<string, string>;
}

const EMPTY: Learning = { excludedItems: [], fixedItems: [], timingOverrides: {} };

function safeParse<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export async function getLearning(categoryId: string | null): Promise<Learning> {
  if (!categoryId) return EMPTY;
  const row = await prisma.categoryLearning.findUnique({ where: { categoryId } });
  if (!row) return EMPTY;
  return {
    excludedItems: safeParse<string[]>(row.excludedItems, []),
    fixedItems: safeParse<GeneratedItem[]>(row.fixedItems, []),
    timingOverrides: safeParse<Record<string, string>>(row.timingOverrides, {}),
  };
}

function norm(s: string): string {
  return s.toLowerCase().replace(/\s+/g, "").trim();
}

/** 生成直後のリストに、そのカテゴリの学習内容（除外・固定・タイミング調整）を適用する。 */
export function applyLearning(
  items: GeneratedItem[],
  learning: Learning,
): GeneratedItem[] {
  const excluded = new Set(learning.excludedItems.map(norm));
  let result = items.filter((it) => !excluded.has(norm(it.title)));

  // 固定項目を（重複しなければ）先頭側に足す
  for (const fixed of learning.fixedItems) {
    if (!result.some((it) => norm(it.title) === norm(fixed.title))) {
      result.push({ ...fixed });
    }
  }

  // タイミング調整
  result = result.map((it) => {
    const override = learning.timingOverrides[norm(it.title)];
    return override ? { ...it, timingLabel: override } : it;
  });

  return result;
}

/**
 * ユーザーのチェックリスト編集内容をカテゴリ学習に反映する。
 * - removed: ユーザーが消した項目タイトル → 次回から除外
 * - added:   ユーザーが足した項目 → 次回から固定で出す
 * - retimed: タイミングを変えた項目 → 次回そのタイミングで出す
 */
export async function updateLearningFromEdits(
  categoryId: string,
  edits: {
    removed: string[];
    added: GeneratedItem[];
    retimed: { title: string; timingLabel: string }[];
  },
): Promise<void> {
  const current = await getLearning(categoryId);

  const excludedSet = new Set(current.excludedItems.map(norm));
  const excludedItems = [...current.excludedItems];
  for (const t of edits.removed) {
    if (t.trim() && !excludedSet.has(norm(t))) {
      excludedItems.push(t.trim());
      excludedSet.add(norm(t));
    }
  }

  const fixedMap = new Map(current.fixedItems.map((f) => [norm(f.title), f]));
  for (const a of edits.added) {
    if (a.title.trim()) fixedMap.set(norm(a.title), { ...a, title: a.title.trim() });
  }
  // 一度足した項目でも、その後ユーザーが消したら固定から外す
  for (const t of edits.removed) fixedMap.delete(norm(t));

  const timingOverrides = { ...current.timingOverrides };
  for (const r of edits.retimed) {
    if (r.title.trim()) timingOverrides[norm(r.title)] = r.timingLabel;
  }

  await prisma.categoryLearning.upsert({
    where: { categoryId },
    create: {
      categoryId,
      excludedItems: JSON.stringify(excludedItems),
      fixedItems: JSON.stringify([...fixedMap.values()]),
      timingOverrides: JSON.stringify(timingOverrides),
    },
    update: {
      excludedItems: JSON.stringify(excludedItems),
      fixedItems: JSON.stringify([...fixedMap.values()]),
      timingOverrides: JSON.stringify(timingOverrides),
    },
  });
}
