import { prisma } from "@/lib/prisma";
import { extractEventFeature, type EventFeatureData } from "@/lib/features";
import { generateBaseChecklist, type GeneratedBase } from "@/lib/generate";
import {
  recallBaseChecklist,
  type RecalledCustomSectionSeed,
} from "@/lib/recall";
import { parseLead } from "@/lib/lead-time";
import { matchEventToSlotType } from "@/lib/pattern-classify";
import {
  getApplicableRules,
  getApplicablePatternRules,
  getKnownPatternSlotTypes,
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
  suggestionType: "exclude" | "add" | "timing" | "pattern_analogy" | null;
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
    // 通知は「一度でも設定して学習されたら、その値をそのまま初期値にする」（ユーザー指示）。
    // なので forced/tentative を問わず notify_override が有れば適用する。
    for (const r of byType(rules, "notify_override")) {
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
 * カテゴリ横断パターン（ruleType="pattern_item"）を、この予定向けに具体化する。
 * - skip（recall で前回の内容をそのまま出す＝verbatim）のときは何も足さない。
 *   通知/タイミングの上書きや仮提案も verbatim では出さない既存方針と揃える。
 * - ユーザーが1件もパターンを学習していなければ、AI を呼ぶまでもなく空を返す。
 * - 確信度の条件（aiConfidence >= 0.8 または 採用-却下 >= 2）を満たすものだけ、
 *   isSuggested:false・通常の項目と同じ見え方で追加する（目立たない中間状態は作らない）。
 */
async function buildPatternItems(
  userId: string,
  eventTitle: string,
  feature: EventFeatureData,
  skip: boolean,
): Promise<BuiltItem[]> {
  if (skip) return [];
  const knownSlotTypes = await getKnownPatternSlotTypes(userId);
  if (knownSlotTypes.length === 0) return [];

  const match = await matchEventToSlotType(
    { title: eventTitle, keywords: feature.keywords },
    knownSlotTypes,
  );
  if (!match) return [];

  const out: BuiltItem[] = [];
  for (const kind of ["task", "belonging"] as ItemKind[]) {
    const rules = await getApplicablePatternRules(userId, match.slotType, kind);
    for (const r of rules) {
      const strong =
        (r.aiConfidence ?? 0) >= 0.8 ||
        r.confirmedCount - r.contradictedCount >= 2;
      if (!strong || !r.patternTemplate.includes("{slot}")) continue;
      const title = r.patternTemplate.replace("{slot}", match.value);
      if (!title.trim()) continue;
      out.push({
        kind,
        title,
        timingLabel: null,
        notifyLeadMinutes: null,
        isSuggested: false,
        suggestionType: "pattern_analogy",
        suggestionRuleId: r.id,
        suggestionValue: title,
        priority: 1,
      });
    }
  }
  return out;
}

export interface BuildChecklistResult {
  items: BuiltItem[];
  /**
   * 似た過去予定で「そのまま使われていた」名前付きリスト由来の枠（task/belonging 以外）。
   * `items` には含めない（AI 再生成の対象＝task/belonging とは別経路で保存するため）。
   * `lib/checklist.ts` の `generateAndSaveChecklist` が `addSeedItemsToEvent` に渡す。
   */
  customSectionSeeds: RecalledCustomSectionSeed[];
}

/**
 * 予定の準備リスト（準備すること＋持ち物）を組み立てる。
 * 一般ベース → 確定ルール強制適用 → 仮ルールは提案 → 上限で間引き。
 * 学習が薄いカテゴリ・パターンではベースがほぼそのまま出る。
 */
export async function buildChecklistForEvent(
  eventId: string,
): Promise<BuildChecklistResult> {
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
      eventLengthBucket: feature.eventLengthBucket,
    },
    update: {
      isOverseas: feature.isOverseas,
      durationNights: feature.durationNights,
      isWeekday: feature.isWeekday,
      timeBucket: feature.timeBucket,
      keywords: JSON.stringify(feature.keywords),
      eventLengthBucket: feature.eventLengthBucket,
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

  // 似た予定で「準備リストを全部消した」と学習済み → 何も出さない（提案も無し）。
  if (recalled?.cleared) return { items: [], customSectionSeeds: [] };

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
  const composed = [
    ...composeKind("task", gen.tasks, taskRules, {
      autofillNotify: false,
      verbatim,
    }),
    ...composeKind("belonging", gen.belongings, belongingRules, {
      autofillNotify: false,
      verbatim,
    }),
  ];

  // カテゴリ横断パターン（例:「新幹線の時間を確認する」→ 別カテゴリでも交通手段の項目として転用）。
  // 既に同じ内容の項目があれば重複させない。
  const patternItems = await buildPatternItems(
    event.userId,
    event.title,
    feature,
    verbatim,
  );
  const existingKeys = new Set(composed.map((it) => `${it.kind}:${norm(it.title)}`));
  const dedupedPatternItems = patternItems.filter(
    (it) => !existingKeys.has(`${it.kind}:${norm(it.title)}`),
  );

  return {
    items: [...composed, ...dedupedPatternItems],
    customSectionSeeds: recalled?.customSectionSeeds ?? [],
  };
}
