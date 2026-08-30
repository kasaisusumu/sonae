import { prisma } from "@/lib/prisma";
import type { EventFeatureData } from "@/lib/features";
import { featureSignature, signatureMatches } from "@/lib/signature";

export type RuleType = "exclude_item" | "fixed_item" | "timing_override";

export const CONFIDENCE_THRESHOLD = 0.7;

export interface GeneratedItem {
  title: string;
  timingLabel: string | null;
}

export function norm(s: string): string {
  return s.toLowerCase().replace(/\s+/g, "").trim();
}

// ── confidence の数式 ───────────────────────────────
// streak: 連続確認回数（作成時 1、矛盾でリセット 0）
// contra: 矛盾の累計
export function computeConfidence(streak: number, contra: number): number {
  const v = 0.28 + 0.2 * streak - 0.18 * Math.min(contra, 3);
  return Math.max(0.05, Math.min(0.95, Number(v.toFixed(3))));
}

/** 半年ほど更新がないルールの重みを徐々に下げる係数（0.35〜1）。 */
export function decayMultiplier(lastConfirmedAt: Date): number {
  const ageDays = (Date.now() - lastConfirmedAt.getTime()) / 86_400_000;
  if (ageDays <= 90) return 1;
  const m = 1 - (ageDays - 90) / 540;
  return Math.max(0.35, Math.min(1, m));
}

export interface ApplicableRule {
  id: string;
  ruleType: RuleType;
  target: string;
  value: string | null;
  confidence: number;
  effectiveConfidence: number;
  forced: boolean;
  isUserLocked: boolean;
  confirmedCount: number;
  contradictedCount: number;
  lastConfirmedAt: Date;
}

/** 対象イベントの特徴に当てはまる、そのカテゴリの学習ルール。 */
export async function getApplicableRules(
  categoryId: string | null,
  feature: EventFeatureData,
): Promise<ApplicableRule[]> {
  if (!categoryId) return [];
  const rows = await prisma.learnedRule.findMany({ where: { categoryId } });
  return rows
    .filter((r) => signatureMatches(r.featureSignature, feature))
    .map((r) => {
      const eff = r.isUserLocked
        ? 1
        : r.confidence * decayMultiplier(r.lastConfirmedAt);
      return {
        id: r.id,
        ruleType: r.ruleType as RuleType,
        target: r.target,
        value: r.value,
        confidence: r.confidence,
        effectiveConfidence: Number(eff.toFixed(3)),
        forced: r.isUserLocked || eff >= CONFIDENCE_THRESHOLD,
        isUserLocked: r.isUserLocked,
        confirmedCount: r.confirmedCount,
        contradictedCount: r.contradictedCount,
        lastConfirmedAt: r.lastConfirmedAt,
      };
    });
}

// ── ルールの確認 / 矛盾 ─────────────────────────────

async function bumpRule(
  ruleId: string,
  kind: "confirm" | "contradict",
): Promise<void> {
  const rule = await prisma.learnedRule.findUnique({ where: { id: ruleId } });
  if (!rule) return;
  if (kind === "confirm") {
    const streak = rule.confirmedCount + 1;
    await prisma.learnedRule.update({
      where: { id: ruleId },
      data: {
        confirmedCount: streak,
        lastConfirmedAt: new Date(),
        confidence: computeConfidence(streak, rule.contradictedCount),
      },
    });
  } else {
    const contra = rule.contradictedCount + 1;
    await prisma.learnedRule.update({
      where: { id: ruleId },
      data: {
        confirmedCount: 0, // 連続を切る
        contradictedCount: contra,
        lastConfirmedAt: new Date(),
        confidence: computeConfidence(0, contra),
      },
    });
  }
}

export const confirmRule = (id: string) => bumpRule(id, "confirm");
export const contradictRule = (id: string) => bumpRule(id, "contradict");

async function upsertAndConfirm(
  categoryId: string,
  ruleType: RuleType,
  target: string,
  featureSig: string,
  value: string | null,
): Promise<void> {
  const t = target.trim();
  if (!t) return;
  const existing = await prisma.learnedRule.findUnique({
    where: {
      categoryId_ruleType_target_featureSignature: {
        categoryId,
        ruleType,
        target: t,
        featureSignature: featureSig,
      },
    },
  });
  if (!existing) {
    await prisma.learnedRule.create({
      data: {
        categoryId,
        ruleType,
        target: t,
        featureSignature: featureSig,
        value,
        confirmedCount: 1,
        contradictedCount: 0,
        confidence: computeConfidence(1, 0),
        lastConfirmedAt: new Date(),
      },
    });
    return;
  }

  // timing_override で値が変わった＝矛盾
  if (ruleType === "timing_override" && value && existing.value !== value) {
    const contra = existing.contradictedCount + 1;
    await prisma.learnedRule.update({
      where: { id: existing.id },
      data: {
        value,
        confirmedCount: 0,
        contradictedCount: contra,
        lastConfirmedAt: new Date(),
        confidence: computeConfidence(0, contra),
      },
    });
    return;
  }

  const streak = existing.confirmedCount + 1;
  await prisma.learnedRule.update({
    where: { id: existing.id },
    data: {
      confirmedCount: streak,
      lastConfirmedAt: new Date(),
      confidence: computeConfidence(streak, existing.contradictedCount),
      ...(value ? { value } : {}),
    },
  });
}

/** 対象カテゴリで、指定タイプ・ターゲットの既存ルールすべてに矛盾を記録する（署名を問わない）。 */
async function contradictAll(
  categoryId: string,
  ruleType: RuleType,
  target: string,
): Promise<void> {
  const t = target.trim();
  const rows = await prisma.learnedRule.findMany({
    where: { categoryId, ruleType, target: t },
  });
  for (const r of rows) await contradictRule(r.id);
}

export interface EditForLearning {
  eventId: string;
  categoryId: string;
  feature: EventFeatureData;
  removed: string[];
  added: GeneratedItem[];
  retimed: { title: string; timingLabel: string }[];
}

/**
 * ユーザーの編集を EditRecord に記録し、LearnedRule を更新する。
 * - 項目の有無（exclude/fixed）とタイミング（timing_override）は別ルールとして扱う
 * - 反復確認で confidence 上昇、矛盾で低下（連続リセット）
 */
export async function recordEdit(input: EditForLearning): Promise<void> {
  const { categoryId, feature } = input;
  const sig = featureSignature(feature);

  await prisma.editRecord.create({
    data: {
      eventId: input.eventId,
      categoryId,
      addedItems: JSON.stringify(
        input.added.map((a) => ({ title: a.title, timingLabel: a.timingLabel })),
      ),
      removedItems: JSON.stringify(input.removed),
      timingChanges: JSON.stringify(
        Object.fromEntries(input.retimed.map((r) => [r.title, r.timingLabel])),
      ),
    },
  });

  for (const r of input.removed) {
    if (!r.trim()) continue;
    await upsertAndConfirm(categoryId, "exclude_item", r, sig, null);
    await contradictAll(categoryId, "fixed_item", r); // 「固定」の信念と矛盾
  }

  for (const a of input.added) {
    if (!a.title.trim()) continue;
    await upsertAndConfirm(
      categoryId,
      "fixed_item",
      a.title,
      sig,
      a.timingLabel,
    );
    await contradictAll(categoryId, "exclude_item", a.title); // 「除外」の信念と矛盾
  }

  for (const rt of input.retimed) {
    if (!rt.title.trim() || !rt.timingLabel.trim()) continue;
    // タイミングだけを更新。exclude/fixed には触れない。
    await upsertAndConfirm(
      categoryId,
      "timing_override",
      rt.title,
      sig,
      rt.timingLabel,
    );
  }
}

// ── 「学習内容の確認」画面用 ─────────────────────────

export async function getLearningOverview(userId: string) {
  const categories = await prisma.category.findMany({
    where: { userId },
    orderBy: { createdAt: "asc" },
    include: {
      learnedRules: { orderBy: { confidence: "desc" } },
    },
  });

  return categories
    .map((c) => {
      const rules = c.learnedRules.map((r) => {
        const eff = r.isUserLocked
          ? 1
          : r.confidence * decayMultiplier(r.lastConfirmedAt);
        return {
          id: r.id,
          ruleType: r.ruleType as RuleType,
          target: r.target,
          value: r.value,
          effectiveConfidence: Number(eff.toFixed(3)),
          isUserLocked: r.isUserLocked,
          confirmedCount: r.confirmedCount,
          contradictedCount: r.contradictedCount,
          lastConfirmedAt: r.lastConfirmedAt,
          forced: r.isUserLocked || eff >= CONFIDENCE_THRESHOLD,
        };
      });
      return {
        categoryId: c.id,
        categoryName: c.name,
        fixed: rules.filter((r) => r.ruleType === "fixed_item" && r.forced),
        excluded: rules.filter(
          (r) => r.ruleType === "exclude_item" && r.forced,
        ),
        timing: rules.filter((r) => r.ruleType === "timing_override" && r.forced),
        tentative: rules.filter((r) => !r.forced),
      };
    })
    .filter(
      (g) =>
        g.fixed.length + g.excluded.length + g.timing.length + g.tentative.length >
        0,
    );
}
