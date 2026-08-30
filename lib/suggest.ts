import { prisma } from "@/lib/prisma";
import { extractEventFeature, type EventFeatureData } from "@/lib/features";
import { generateBaseChecklist, type GeneratedBase } from "@/lib/generate";
import { recallBaseChecklist } from "@/lib/recall";
import {
  getApplicableRules,
  norm,
  parseNotifyValue,
  type ApplicableRule,
  type GeneratedItem,
  type ItemKind,
} from "@/lib/learning";

const LIMITS: Record<ItemKind, { min: number; max: number }> = {
  task: { min: 3, max: 7 },
  belonging: { min: 2, max: 8 },
};

export interface BuiltItem {
  kind: ItemKind;
  title: string;
  timingLabel: string | null;
  notifyLeadMinutes: number | null;
  isSuggested: boolean;
  suggestionType: "exclude" | "add" | "timing" | null;
  suggestionRuleId: string | null;
  suggestionValue: string | null;
  priority: number;
}

function base(kind: ItemKind, title: string, timingLabel: string | null): BuiltItem {
  return {
    kind,
    title,
    timingLabel,
    notifyLeadMinutes: null,
    isSuggested: false,
    suggestionType: null,
    suggestionRuleId: null,
    suggestionValue: null,
    priority: 0.5,
  };
}

function composeKind(
  kind: ItemKind,
  baseItems: GeneratedItem[],
  rules: ApplicableRule[],
): BuiltItem[] {
  const { min, max } = LIMITS[kind];
  let items: BuiltItem[] = baseItems.map((b) => ({
    ...base(kind, b.title, b.timingLabel),
    notifyLeadMinutes: b.notifyLeadMinutes ?? null,
  }));

  const forced = rules.filter((r) => r.forced);
  const tentative = rules.filter((r) => !r.forced);
  const byType = (rs: ApplicableRule[], t: string) =>
    rs.filter((r) => r.ruleType === t);

  // 確定ルール（強制適用）
  const forcedExclude = new Set(
    byType(forced, "exclude_item").map((r) => norm(r.target)),
  );
  items = items.filter((it) => !forcedExclude.has(norm(it.title)));

  for (const r of byType(forced, "fixed_item")) {
    const hit = items.find((it) => norm(it.title) === norm(r.target));
    if (hit) {
      hit.priority = 1;
      if (r.value) hit.timingLabel = r.value;
    } else {
      items.push({ ...base(kind, r.target, r.value), priority: 1 });
    }
  }
  for (const r of byType(forced, "timing_override")) {
    const hit = items.find((it) => norm(it.title) === norm(r.target));
    if (hit && r.value) hit.timingLabel = r.value;
  }
  // 通知リード時間（内容とセットで学習した値。"off" は通知しない）
  for (const r of byType(forced, "notify_override")) {
    const hit = items.find((it) => norm(it.title) === norm(r.target));
    if (hit) hit.notifyLeadMinutes = parseNotifyValue(r.value);
  }

  // 仮ルール（提案。1タップで適用/却下）
  for (const r of byType(tentative, "exclude_item")) {
    const hit = items.find(
      (it) => norm(it.title) === norm(r.target) && !it.isSuggested,
    );
    if (hit) {
      hit.isSuggested = true;
      hit.suggestionType = "exclude";
      hit.suggestionRuleId = r.id;
    }
  }
  for (const r of byType(tentative, "fixed_item")) {
    if (!items.some((it) => norm(it.title) === norm(r.target))) {
      items.push({
        ...base(kind, r.target, r.value),
        isSuggested: true,
        suggestionType: "add",
        suggestionRuleId: r.id,
        priority: r.effectiveConfidence,
      });
    }
  }
  for (const r of byType(tentative, "timing_override")) {
    const hit = items.find(
      (it) => norm(it.title) === norm(r.target) && !it.isSuggested,
    );
    if (hit && r.value && norm(hit.timingLabel ?? "") !== norm(r.value)) {
      hit.isSuggested = true;
      hit.suggestionType = "timing";
      hit.suggestionRuleId = r.id;
      hit.suggestionValue = r.value;
    }
  }

  // 重複排除
  const seen = new Set<string>();
  items = items.filter((it) => {
    const k = norm(it.title);
    if (!k || seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  // 上限で間引き（priority の低い＝confidence の低いものから。確定 fixed は守る）
  if (items.length > max) {
    const protectedCount = items.filter((it) => it.priority >= 1).length;
    const keepCount = Math.max(min, max - protectedCount);
    const kept = new Set(
      items
        .filter((it) => it.priority < 1)
        .sort((a, b) => b.priority - a.priority)
        .slice(0, keepCount),
    );
    items = items.filter((it) => it.priority >= 1 || kept.has(it));
  }

  return items;
}

/**
 * 予定の準備リスト（準備すること＋持ち物）を組み立てる。
 * 一般ベース → 確定ルール強制適用 → 仮ルールは提案 → 上限で間引き。
 * 学習が薄いカテゴリ・パターンではベースがほぼそのまま出る。
 */
export async function buildChecklistForEvent(eventId: string): Promise<BuiltItem[]> {
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    include: { category: true },
  });
  if (!event) throw new Error("予定が見つかりません。");

  const feature: EventFeatureData = extractEventFeature({
    title: event.title,
    memo: event.memo,
    eventDatetime: event.eventDatetime,
    endDatetime: event.endDatetime,
  });

  await prisma.eventFeature.upsert({
    where: { eventId },
    create: {
      eventId,
      isOverseas: feature.isOverseas,
      durationNights: feature.durationNights,
      isWeekday: feature.isWeekday,
      timeBucket: feature.timeBucket,
      keywords: JSON.stringify(feature.keywords),
    },
    update: {
      isOverseas: feature.isOverseas,
      durationNights: feature.durationNights,
      isWeekday: feature.isWeekday,
      timeBucket: feature.timeBucket,
      keywords: JSON.stringify(feature.keywords),
    },
  });

  // 同名・類似・同カテゴリの過去予定があれば、その確定リストをベースに丸ごと再利用する。
  // （AI 生成は呼ばない。学習が1回きりでも「前回とほぼ同じ」を素直に出す。）
  const recalled = await recallBaseChecklist(
    {
      id: event.id,
      userId: event.userId,
      categoryId: event.categoryId,
      title: event.title,
    },
    feature,
  );

  const [gen, taskRules, belongingRules] = await Promise.all([
    recalled
      ? Promise.resolve<GeneratedBase>({
          tasks: recalled.tasks,
          belongings: recalled.belongings,
          source: "recall",
        })
      : generateBaseChecklist({
          title: event.title,
          categoryName: event.category?.name ?? "その他",
          eventDatetime: event.eventDatetime,
          memo: event.memo,
          isOverseas: feature.isOverseas,
          durationNights: feature.durationNights,
        }),
    getApplicableRules(event.categoryId, feature, "task"),
    getApplicableRules(event.categoryId, feature, "belonging"),
  ]);

  return [
    ...composeKind("task", gen.tasks, taskRules),
    ...composeKind("belonging", gen.belongings, belongingRules),
  ];
}
