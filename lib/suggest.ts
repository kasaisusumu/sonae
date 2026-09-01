import { prisma } from "@/lib/prisma";
import { extractEventFeature, type EventFeatureData } from "@/lib/features";
import { generateBaseChecklist, type GeneratedBase } from "@/lib/generate";
import { recallBaseChecklist } from "@/lib/recall";
import { parseLead } from "@/lib/lead-time";
import {
  getApplicableRules,
  norm,
  parseNotifyValue,
  suggestNotifyLead,
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
  opts: { autofillNotify?: boolean; verbatim?: boolean } = {},
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
  // 通知リード時間（内容とセットで学習した値。"off" は通知しない）
  // recall（前回そっくり再利用）のときは、前回のリストと時間をそのまま出す。
  // notify_override / timing_override の上書きも仮提案もしない。編集されて初めて枝分かれ。
  const notifyLearned = new Set<string>();
  if (!opts.verbatim) {
    for (const r of byType(forced, "notify_override")) {
      const hit = items.find((it) => norm(it.title) === norm(r.target));
      if (hit) {
        hit.notifyLeadMinutes = parseNotifyValue(r.value);
        notifyLearned.add(norm(hit.title));
      }
    }
    // 旧「タイミング」学習は通知リード時間として引き継ぐ
    for (const r of byType(forced, "timing_override")) {
      const hit = items.find((it) => norm(it.title) === norm(r.target));
      if (hit && r.value) {
        hit.timingLabel = r.value;
        const lead = parseLead(r.value);
        if (lead != null && !notifyLearned.has(norm(hit.title))) {
          hit.notifyLeadMinutes = lead;
          notifyLearned.add(norm(hit.title));
        }
      }
    }
  }
  // 学習値が無い項目は、目安（生成時のラベル）から通知時間を自動提案する
  if (opts.autofillNotify && !opts.verbatim) {
    for (const it of items) {
      if (it.notifyLeadMinutes === null && !notifyLearned.has(norm(it.title))) {
        it.notifyLeadMinutes = suggestNotifyLead(it.timingLabel, kind);
      }
    }
  }

  // 仮ルール（提案。1タップで適用/却下）
  // recall のときは提案を出さない ── 前回どおりを黙って出し、編集で初めて枝分かれ。
  const tentativeRules = opts.verbatim ? [] : tentative;
  for (const r of byType(tentativeRules, "exclude_item")) {
    const hit = items.find(
      (it) => norm(it.title) === norm(r.target) && !it.isSuggested,
    );
    if (hit) {
      hit.isSuggested = true;
      hit.suggestionType = "exclude";
      hit.suggestionRuleId = r.id;
    }
  }
  for (const r of byType(tentativeRules, "fixed_item")) {
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
  for (const r of byType(tentativeRules, "timing_override")) {
    const hit = items.find(
      (it) => norm(it.title) === norm(r.target) && !it.isSuggested,
    );
    const lead = parseLead(r.value);
    if (hit && lead != null && hit.notifyLeadMinutes !== lead) {
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
    // 似た予定を思い出したときは、シグネチャ違いも含めて前回の学習を全部当てる。
    // そこで今回の予定が違う形に編集されたら、初めてシグネチャごとに枝分かれする。
    getApplicableRules(event.categoryId, feature, "task", { broad: !!recalled }),
    getApplicableRules(event.categoryId, feature, "belonging", {
      broad: !!recalled,
    }),
  ]);

  // 項目ごとの通知は既定「なし」。生成時に時間を自動で埋めない（学習した notify_override があればそれは効く）。
  // リマインドは予定単位の「準備リストのリマインド」（既定 1 日前）に一本化。
  const verbatim = !!recalled;
  return [
    ...composeKind("task", gen.tasks, taskRules, {
      autofillNotify: false,
      verbatim,
    }),
    ...composeKind("belonging", gen.belongings, belongingRules, {
      autofillNotify: false,
      verbatim,
    }),
  ];
}
