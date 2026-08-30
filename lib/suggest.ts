import { prisma } from "@/lib/prisma";
import { extractEventFeature } from "@/lib/features";
import { generateBaseChecklist } from "@/lib/generate";
import { getApplicableRules, norm, type ApplicableRule } from "@/lib/learning";

const MIN_ITEMS = 3;
const MAX_ITEMS = 7;

export interface BuiltItem {
  title: string;
  timingLabel: string | null;
  isSuggested: boolean;
  suggestionType: "exclude" | "add" | "timing" | null;
  suggestionRuleId: string | null;
  suggestionValue: string | null;
  priority: number; // trim 用（低いものから削る）。永続化しない
}

function base(title: string, timingLabel: string | null): BuiltItem {
  return {
    title,
    timingLabel,
    isSuggested: false,
    suggestionType: null,
    suggestionRuleId: null,
    suggestionValue: null,
    priority: 0.5,
  };
}

/**
 * 予定の準備リストを組み立てる。
 * 一般的なベースリスト → 確定ルール(強制適用) → 仮ルール(提案として弱く表示) → 上限で間引き。
 * 学習が薄いカテゴリ・パターンでは、ベースリストがほぼそのまま出る。
 */
export async function buildChecklistForEvent(eventId: string): Promise<BuiltItem[]> {
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    include: { category: true },
  });
  if (!event) throw new Error("予定が見つかりません。");

  const feature = extractEventFeature({
    title: event.title,
    memo: event.memo,
    eventDatetime: event.eventDatetime,
    endDatetime: event.endDatetime,
  });

  // 特徴量を保存（次回以降の判定に使う）
  await prisma.eventFeature.upsert({
    where: { eventId },
    create: {
      eventId,
      isOverseas: feature.isOverseas,
      durationNights: feature.durationNights,
      isWeekday: feature.isWeekday,
      keywords: JSON.stringify(feature.keywords),
    },
    update: {
      isOverseas: feature.isOverseas,
      durationNights: feature.durationNights,
      isWeekday: feature.isWeekday,
      keywords: JSON.stringify(feature.keywords),
    },
  });

  const [{ items: baseItems }, rules] = await Promise.all([
    generateBaseChecklist({
      title: event.title,
      categoryName: event.category?.name ?? "その他",
      eventDatetime: event.eventDatetime,
      memo: event.memo,
      isOverseas: feature.isOverseas,
      durationNights: feature.durationNights,
    }),
    getApplicableRules(event.categoryId, feature),
  ]);

  let items: BuiltItem[] = baseItems.map((b) => base(b.title, b.timingLabel));

  const forced = rules.filter((r) => r.forced);
  const tentative = rules.filter((r) => !r.forced);
  const byType = (rs: ApplicableRule[], t: string) =>
    rs.filter((r) => r.ruleType === t);

  // ── 確定ルール（強制適用）──
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
      items.push({ ...base(r.target, r.value), priority: 1 });
    }
  }
  for (const r of byType(forced, "timing_override")) {
    const hit = items.find((it) => norm(it.title) === norm(r.target));
    if (hit && r.value) hit.timingLabel = r.value;
  }

  // ── 仮ルール（提案として弱く表示。ユーザーが1タップで適用/却下）──
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
        ...base(r.target, r.value),
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

  // ── 重複排除（正規化タイトル）──
  const seen = new Set<string>();
  items = items.filter((it) => {
    const k = norm(it.title);
    if (!k || seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  // ── 上限で間引き（confidence の低い＝priority の低いものから。確定 fixed は守る）──
  if (items.length > MAX_ITEMS) {
    const protectedCount = items.filter((it) => it.priority >= 1).length;
    const keepCount = Math.max(MIN_ITEMS, MAX_ITEMS - protectedCount);
    const kept = new Set(
      items
        .filter((it) => it.priority < 1)
        .sort((a, b) => b.priority - a.priority) // 高い順
        .slice(0, keepCount),
    );
    items = items.filter((it) => it.priority >= 1 || kept.has(it));
  }

  return items;
}
