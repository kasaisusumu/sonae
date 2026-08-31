import { prisma } from "@/lib/prisma";
import type { EventFeatureData, TimeBucket } from "@/lib/features";
import {
  describeSignature,
  featureSignature,
  signatureMatches,
  signatureSpecificity,
  WILDCARD_SIGNATURE,
} from "@/lib/signature";

export type RuleType =
  | "exclude_item"
  | "fixed_item"
  | "timing_override"
  | "notify_override"; // value = 予定開始の何分前に通知するか（分）／"off" = 通知しない
export type ItemKind = "task" | "belonging";

export const CONFIDENCE_THRESHOLD = 0.7;

export interface GeneratedItem {
  title: string;
  timingLabel: string | null;
  notifyLeadMinutes?: number | null;
}

export function norm(s: string): string {
  return s.toLowerCase().replace(/\s+/g, "").trim();
}

// ── confidence の数式 ───────────────────────────────
// streak: 連続確認回数（作成時 1、矛盾でリセット 0）
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
  itemKind: ItemKind;
  ruleType: RuleType;
  target: string;
  value: string | null;
  confidence: number;
  effectiveConfidence: number;
  specificity: number;
  signatureMatch: boolean;
  forced: boolean;
  isUserLocked: boolean;
  confirmedCount: number;
  contradictedCount: number;
  lastConfirmedAt: Date;
}

/** 対象イベントの特徴に当てはまる、そのカテゴリ・種別の学習ルール。具体的な署名を優先。 */
export async function getApplicableRules(
  categoryId: string | null,
  feature: EventFeatureData,
  itemKind: ItemKind = "task",
  opts: { broad?: boolean } = {},
): Promise<ApplicableRule[]> {
  if (!categoryId) return [];
  const rows = await prisma.learnedRule.findMany({
    where: { categoryId, itemKind },
  });
  return rows
    .map((r) => ({ r, match: signatureMatches(r.featureSignature, feature) }))
    // 通常はシグネチャ一致のみ。broad（似た予定を思い出したとき）は全部拾う。
    .filter(({ match }) => opts.broad || match)
    .map(({ r, match }) => {
      const eff = r.isUserLocked
        ? 1
        : r.confidence * decayMultiplier(r.lastConfirmedAt);
      return {
        id: r.id,
        itemKind: r.itemKind as ItemKind,
        ruleType: r.ruleType as RuleType,
        target: r.target,
        value: r.value,
        confidence: r.confidence,
        effectiveConfidence: Number(eff.toFixed(3)),
        specificity: signatureSpecificity(r.featureSignature),
        signatureMatch: match,
        forced: r.isUserLocked || eff >= CONFIDENCE_THRESHOLD,
        isUserLocked: r.isUserLocked,
        confirmedCount: r.confirmedCount,
        contradictedCount: r.contradictedCount,
        lastConfirmedAt: r.lastConfirmedAt,
      };
    })
    // シグネチャ一致を優先 → 具体的な署名 → 確信度
    .sort(
      (a, b) =>
        Number(b.signatureMatch) - Number(a.signatureMatch) ||
        b.specificity - a.specificity ||
        b.effectiveConfidence - a.effectiveConfidence,
    );
}

/**
 * 準備の目安ラベルから、通知リード時間（分）を素直に提案する。
 * 学習が無くても「時間も自動提案」するための初期値。
 */
export function suggestNotifyLead(
  timingLabel: string | null,
  kind: ItemKind,
): number {
  const CAP = 168 * 60; // 1 週間
  const t = (timingLabel ?? "").replace(/\s/g, "");
  let m = t.match(/(\d+)\s*週間?前/);
  if (m) return Math.min(Number(m[1]) * 10080, CAP);
  m = t.match(/(\d+)\s*日前/);
  if (m) return Math.min(Number(m[1]) * 1440, CAP);
  m = t.match(/(\d+)\s*時間前/);
  if (m) return Math.min(Number(m[1]) * 60, CAP);
  m = t.match(/(\d+)\s*分前/);
  if (m) return Math.min(Number(m[1]), CAP);
  if (/1週間前|一週間前/.test(t)) return 10080;
  if (/3日前|三日前/.test(t)) return 4320;
  if (/前日夜|前夜/.test(t)) return 15 * 60;
  if (/前日/.test(t)) return 1440;
  if (/当日朝|朝一/.test(t)) return 180;
  if (/当日/.test(t)) return 120;
  if (/直前|出発前/.test(t)) return 30;
  return kind === "belonging" ? 15 * 60 : 180;
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
        confirmedCount: 0,
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
  itemKind: ItemKind,
  ruleType: RuleType,
  target: string,
  featureSig: string,
  value: string | null,
): Promise<void> {
  const t = target.trim();
  if (!t) return;
  const existing = await prisma.learnedRule.findUnique({
    where: {
      categoryId_itemKind_ruleType_target_featureSignature: {
        categoryId,
        itemKind,
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
        itemKind,
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

  if (
    (ruleType === "timing_override" || ruleType === "notify_override") &&
    value &&
    existing.value !== value
  ) {
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

/** 同カテゴリ・種別で、指定タイプ・ターゲットの既存ルールすべてに矛盾を記録（署名は問わない）。 */
async function contradictAll(
  categoryId: string,
  itemKind: ItemKind,
  ruleType: RuleType,
  target: string,
): Promise<void> {
  const rows = await prisma.learnedRule.findMany({
    where: { categoryId, itemKind, ruleType, target: target.trim() },
  });
  for (const r of rows) await contradictRule(r.id);
}

export interface EditForLearning {
  eventId: string;
  categoryId: string;
  feature: EventFeatureData;
  itemKind: ItemKind;
  removed: string[];
  added: GeneratedItem[];
  retimed: { title: string; timingLabel: string }[];
  // 通知リード時間の変更（分。null = 通知しない）。内容とセットで学習する。
  renotified?: { title: string; leadMinutes: number | null }[];
}

/** 通知リード時間（分 or null）を LearnedRule.value の文字列に。 */
export function notifyValue(leadMinutes: number | null): string {
  return leadMinutes === null ? "off" : String(leadMinutes);
}

/** LearnedRule.value（"off" or 数字文字列）を分 or null に戻す。 */
export function parseNotifyValue(value: string | null): number | null {
  if (!value || value === "off") return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : null;
}

/**
 * ユーザーの編集を EditRecord に記録し、LearnedRule を更新する（種別ごと）。
 */
export async function recordEdit(input: EditForLearning): Promise<void> {
  const { categoryId, feature, itemKind } = input;
  const sig = featureSignature(feature);

  await prisma.editRecord.create({
    data: {
      eventId: input.eventId,
      categoryId,
      addedItems: JSON.stringify(
        input.added.map((a) => ({
          title: a.title,
          timingLabel: a.timingLabel,
          kind: itemKind,
        })),
      ),
      removedItems: JSON.stringify(input.removed),
      timingChanges: JSON.stringify(
        Object.fromEntries(input.retimed.map((r) => [r.title, r.timingLabel])),
      ),
      notifyChanges: JSON.stringify(
        Object.fromEntries(
          (input.renotified ?? []).map((r) => [r.title, r.leadMinutes]),
        ),
      ),
    },
  });

  for (const r of input.removed) {
    if (!r.trim()) continue;
    await upsertAndConfirm(categoryId, itemKind, "exclude_item", r, sig, null);
    await contradictAll(categoryId, itemKind, "fixed_item", r);
  }
  for (const a of input.added) {
    if (!a.title.trim()) continue;
    await upsertAndConfirm(
      categoryId,
      itemKind,
      "fixed_item",
      a.title,
      sig,
      a.timingLabel,
    );
    await contradictAll(categoryId, itemKind, "exclude_item", a.title);
  }
  for (const rt of input.retimed) {
    if (!rt.title.trim() || !rt.timingLabel.trim()) continue;
    await upsertAndConfirm(
      categoryId,
      itemKind,
      "timing_override",
      rt.title,
      sig,
      rt.timingLabel,
    );
  }
  for (const rn of input.renotified ?? []) {
    if (!rn.title.trim()) continue;
    await upsertAndConfirm(
      categoryId,
      itemKind,
      "notify_override",
      rn.title,
      sig,
      notifyValue(rn.leadMinutes),
    );
  }
}

// ── 「学習内容の確認」画面用: カテゴリ → どの場合(特徴シグネチャ) → 予定名 → 学習内容 の樹形図 ──

export interface LearnedRuleView {
  id: string;
  itemKind: ItemKind;
  ruleType: RuleType;
  target: string;
  value: string | null;
  confidence: number;
  effectiveConfidence: number;
  confirmedCount: number;
  contradictedCount: number;
  lastConfirmedAt: Date;
  isUserLocked: boolean;
  forced: boolean;
  /** このルールを裏付けた予定名（編集ログ由来） */
  supportedBy: string[];
}

export interface LearningKindGroup {
  kind: ItemKind;
  fixed: LearnedRuleView[];
  excluded: LearnedRuleView[];
  timing: LearnedRuleView[];
  notify: LearnedRuleView[];
  tentative: LearnedRuleView[];
}

export type EditChangeKind = "added" | "removed" | "retimed" | "renotified";

export interface EditChangeView {
  kind: EditChangeKind;
  itemKind: ItemKind | null;
  title: string;
  detail: string | null; // タイミングラベル / リード時間ラベル
}

export interface EditRecordView {
  id: string;
  when: Date;
  changes: EditChangeView[];
}

export interface SituationEventView {
  eventId: string | null;
  title: string;
  keywords: string[];
  editCount: number;
  edits: EditRecordView[];
}

export interface LearningSituation {
  signature: string;
  /** "海外・3泊以上・平日・午前"、共通なら "すべての予定に共通" */
  label: string;
  parts: string[];
  ruleCount: number;
  editCount: number;
  /** この状況で見た予定名の語（union） */
  keywords: string[];
  kinds: LearningKindGroup[];
  /** この状況に当てはまった予定と、その編集ログ */
  events: SituationEventView[];
}

export interface LearningCategoryTree {
  categoryId: string;
  categoryName: string;
  ruleCount: number;
  editCount: number;
  situations: LearningSituation[];
}

function leadMinutesLabel(m: number | null): string {
  if (m === null) return "通知なし";
  if (m > 0 && m % 1440 === 0) return `${m / 1440}日前`;
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return `${h ? `${h}時間` : ""}${mm ? `${mm}分` : ""}前`;
}

function parseKeywords(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const a = JSON.parse(raw);
    return Array.isArray(a) ? a.map((x) => String(x)).filter(Boolean) : [];
  } catch {
    return [];
  }
}

type FeatureRow = {
  isOverseas: boolean | null;
  durationNights: number | null;
  isWeekday: boolean;
  timeBucket: string | null;
  keywords: string;
} | null;

function signatureFromFeatureRow(f: FeatureRow): string {
  if (!f || !f.timeBucket) return WILDCARD_SIGNATURE;
  return featureSignature({
    isOverseas: f.isOverseas,
    durationNights: f.durationNights,
    isWeekday: f.isWeekday,
    timeBucket: f.timeBucket as TimeBucket,
    keywords: [],
  });
}

function ruleView(r: {
  id: string;
  itemKind: string;
  ruleType: string;
  target: string;
  value: string | null;
  confidence: number;
  confirmedCount: number;
  contradictedCount: number;
  lastConfirmedAt: Date;
  isUserLocked: boolean;
}): LearnedRuleView {
  const eff = r.isUserLocked
    ? 1
    : r.confidence * decayMultiplier(r.lastConfirmedAt);
  return {
    id: r.id,
    itemKind: r.itemKind as ItemKind,
    ruleType: r.ruleType as RuleType,
    target: r.target,
    value: r.value,
    confidence: r.confidence,
    effectiveConfidence: Number(eff.toFixed(3)),
    confirmedCount: r.confirmedCount,
    contradictedCount: r.contradictedCount,
    lastConfirmedAt: r.lastConfirmedAt,
    isUserLocked: r.isUserLocked,
    forced: r.isUserLocked || eff >= CONFIDENCE_THRESHOLD,
    supportedBy: [],
  };
}

function parseEditChanges(e: {
  addedItems: string;
  removedItems: string;
  timingChanges: string;
  notifyChanges: string;
}): EditChangeView[] {
  const out: EditChangeView[] = [];
  try {
    const added = JSON.parse(e.addedItems);
    if (Array.isArray(added)) {
      for (const a of added) {
        if (!a?.title) continue;
        out.push({
          kind: "added",
          itemKind: a.kind === "belonging" ? "belonging" : "task",
          title: String(a.title),
          detail: a.timingLabel ? String(a.timingLabel) : null,
        });
      }
    }
  } catch {
    /* ignore */
  }
  try {
    const removed = JSON.parse(e.removedItems);
    if (Array.isArray(removed)) {
      for (const r of removed) {
        if (!r) continue;
        out.push({
          kind: "removed",
          itemKind: null,
          title: String(r),
          detail: null,
        });
      }
    }
  } catch {
    /* ignore */
  }
  try {
    const timing = JSON.parse(e.timingChanges);
    if (timing && typeof timing === "object") {
      for (const [title, label] of Object.entries(timing)) {
        out.push({
          kind: "retimed",
          itemKind: null,
          title,
          detail: label == null ? null : String(label),
        });
      }
    }
  } catch {
    /* ignore */
  }
  try {
    const notify = JSON.parse(e.notifyChanges);
    if (notify && typeof notify === "object") {
      for (const [title, mins] of Object.entries(notify)) {
        out.push({
          kind: "renotified",
          itemKind: null,
          title,
          detail: leadMinutesLabel(
            mins === null || mins === undefined ? null : Number(mins),
          ),
        });
      }
    }
  } catch {
    /* ignore */
  }
  return out;
}

export async function getLearningTree(
  userId: string,
): Promise<LearningCategoryTree[]> {
  const categories = await prisma.category.findMany({
    where: { userId },
    orderBy: { createdAt: "asc" },
    include: {
      learnedRules: true,
      _count: { select: { editRecords: true } },
    },
  });
  if (categories.length === 0) return [];

  const catIds = categories.map((c) => c.id);
  const editRecords = await prisma.editRecord.findMany({
    where: { categoryId: { in: catIds } },
    orderBy: { createdAt: "desc" },
    include: {
      event: {
        select: {
          id: true,
          title: true,
          feature: {
            select: {
              isOverseas: true,
              durationNights: true,
              isWeekday: true,
              timeBucket: true,
              keywords: true,
            },
          },
        },
      },
    },
  });

  // categoryId -> signature -> eventKey -> SituationEventView
  const editsByCatSig = new Map<
    string,
    Map<string, Map<string, SituationEventView>>
  >();
  for (const e of editRecords) {
    if (!e.categoryId) continue;
    const sig = signatureFromFeatureRow(e.event?.feature ?? null);
    const changes = parseEditChanges(e);
    if (changes.length === 0) continue;

    let sigMap = editsByCatSig.get(e.categoryId);
    if (!sigMap) {
      sigMap = new Map();
      editsByCatSig.set(e.categoryId, sigMap);
    }
    let evMap = sigMap.get(sig);
    if (!evMap) {
      evMap = new Map();
      sigMap.set(sig, evMap);
    }
    const key = e.event?.id ?? `t:${e.event?.title ?? "?"}`;
    let ev = evMap.get(key);
    if (!ev) {
      ev = {
        eventId: e.event?.id ?? null,
        title: e.event?.title ?? "(削除された予定)",
        keywords: parseKeywords(e.event?.feature?.keywords),
        editCount: 0,
        edits: [],
      };
      evMap.set(key, ev);
    }
    ev.editCount += 1;
    ev.edits.push({ id: e.id, when: e.createdAt, changes });
  }

  return categories
    .map((c) => {
      const bySig = new Map<string, LearnedRuleView[]>();
      for (const r of c.learnedRules) {
        const arr = bySig.get(r.featureSignature) ?? [];
        arr.push(ruleView(r));
        bySig.set(r.featureSignature, arr);
      }

      const sigEvents = editsByCatSig.get(c.id) ?? new Map();
      // ルールがある署名 ∪ 編集ログがある署名
      const allSigs = new Set<string>([...bySig.keys(), ...sigEvents.keys()]);

      const situations: LearningSituation[] = [...allSigs]
        .map((signature) => {
          const rules = bySig.get(signature) ?? [];
          const d = describeSignature(signature);

          const events: SituationEventView[] = [
            ...((sigEvents.get(signature) as
              | Map<string, SituationEventView>
              | undefined) ?? new Map()
            ).values(),
          ].sort((a, b) => b.editCount - a.editCount);

          // ルールを裏付けた予定名を、編集ログから拾って添える
          const supporters = (rt: RuleType, target: string): string[] => {
            const want =
              rt === "fixed_item"
                ? "added"
                : rt === "exclude_item"
                  ? "removed"
                  : rt === "timing_override"
                    ? "retimed"
                    : "renotified";
            const t = norm(target);
            const names = new Set<string>();
            for (const ev of events) {
              for (const rec of ev.edits) {
                if (rec.changes.some((ch) => ch.kind === want && norm(ch.title) === t)) {
                  names.add(ev.title);
                }
              }
            }
            return [...names];
          };
          for (const r of rules) r.supportedBy = supporters(r.ruleType, r.target);

          const kinds: LearningKindGroup[] = (
            ["task", "belonging"] as ItemKind[]
          )
            .map((kind) => {
              const rs = rules
                .filter((r) => r.itemKind === kind)
                .sort(
                  (a, b) =>
                    Number(b.forced) - Number(a.forced) ||
                    b.effectiveConfidence - a.effectiveConfidence,
                );
              return {
                kind,
                fixed: rs.filter((r) => r.ruleType === "fixed_item" && r.forced),
                excluded: rs.filter(
                  (r) => r.ruleType === "exclude_item" && r.forced,
                ),
                timing: rs.filter(
                  (r) => r.ruleType === "timing_override" && r.forced,
                ),
                notify: rs.filter(
                  (r) => r.ruleType === "notify_override" && r.forced,
                ),
                tentative: rs.filter((r) => !r.forced),
              } satisfies LearningKindGroup;
            })
            .filter(
              (k) =>
                k.fixed.length +
                  k.excluded.length +
                  k.timing.length +
                  k.notify.length +
                  k.tentative.length >
                0,
            );

          const kw = new Set<string>();
          for (const ev of events) for (const w of ev.keywords) kw.add(w);

          return {
            signature,
            label: d.text,
            parts: d.parts,
            ruleCount: rules.length,
            editCount: events.reduce((s, e) => s + e.editCount, 0),
            keywords: [...kw],
            kinds,
            events,
          };
        })
        .filter((s) => s.ruleCount > 0 || s.editCount > 0)
        // 具体的な状況を先に、"すべて共通" を後ろに。次に学習件数の多い順。
        .sort(
          (a, b) =>
            b.parts.length - a.parts.length ||
            b.ruleCount - a.ruleCount ||
            b.editCount - a.editCount,
        );

      return {
        categoryId: c.id,
        categoryName: c.name,
        ruleCount: c.learnedRules.length,
        editCount: c._count.editRecords,
        situations,
      };
    })
    .filter((c) => c.ruleCount > 0 || c.editCount > 0);
}
