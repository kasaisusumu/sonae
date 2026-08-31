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

// ── 「学習内容の確認」画面用: カテゴリ → 予定名の樹形図 → 予定ごとの「どのリストになるか」 ──

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
  /** このルールの署名（どの場合か）の日本語ラベル */
  situationLabel: string;
}

export type EditChangeKind = "added" | "removed" | "retimed" | "renotified";

export interface EditChangeView {
  kind: EditChangeKind;
  itemKind: ItemKind | null;
  title: string;
  detail: string | null;
}

export interface EditRecordView {
  id: string;
  when: Date;
  changes: EditChangeView[];
}

export interface LeafListItem {
  title: string;
  timingLabel: string | null;
  notifyLeadMinutes: number | null;
  isUserAdded: boolean;
}

/** 樹形図の葉 = 実際に学習した 1 つの予定 */
export interface NameTreeLeaf {
  eventId: string;
  title: string;
  /** "国内・日帰り・平日・午前" など。予定の性質 */
  situationLabel: string;
  keywords: string[];
  editCount: number;
  /** この予定名のときの「リスト」 */
  list: { task: LeafListItem[]; belonging: LeafListItem[] };
  edits: EditRecordView[];
  /** この予定に効いている学習ルール（署名ラベル付き） */
  rules: LearnedRuleView[];
}

/** 樹形図の枝 = 予定名の語による分岐 */
export interface NameTreeNode {
  path: string; // ルートからここまでの語をつないだもの（id 生成用）
  label: string; // この枝の語（例: "旅行"）
  count: number; // この枝以下の予定数
  children: NameTreeNode[];
  leaves: NameTreeLeaf[];
}

export interface NameCategoryTree {
  categoryId: string;
  categoryName: string;
  eventCount: number;
  ruleCount: number;
  node: NameTreeNode; // 直下の children / leaves が名前の樹形図のトップ
}

export interface LearningSearchEntry {
  eventId: string;
  title: string;
  crumb: string; // "旅行・出張 › 旅行 › ハワイ"
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
    return Array.isArray(a)
      ? [...new Set(a.map((x) => String(x)).filter((x) => x.length >= 2))]
      : [];
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
  featureSignature: string;
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
    situationLabel: describeSignature(r.featureSignature).text,
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
        out.push({ kind: "removed", itemKind: null, title: String(r), detail: null });
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

// ── 予定名の樹形図を組む ──────────────────────────────

type RawNode = { children: Map<string, RawNode>; leaves: NameTreeLeaf[] };

function orderKeywords(kws: string[], freq: Map<string, number>): string[] {
  return [...kws].sort(
    (a, b) => (freq.get(b) ?? 0) - (freq.get(a) ?? 0) || (a < b ? -1 : 1),
  );
}

function toNode(raw: RawNode, label: string, parentPath: string): NameTreeNode {
  const path = parentPath ? `${parentPath}/${label}` : label;
  let children = [...raw.children.entries()].map(([k, v]) => toNode(v, k, path));
  let leaves = raw.leaves;

  // 1 子・0 葉 の連なりは畳んでラベルをつなぐ（"旅行" ▸ "ハワイ" → "旅行・ハワイ"）
  let mergedLabel = label;
  while (children.length === 1 && leaves.length === 0) {
    const only = children[0];
    mergedLabel = `${mergedLabel}・${only.label}`;
    children = only.children;
    leaves = only.leaves;
  }

  children.sort((a, b) => b.count - a.count || (a.label < b.label ? -1 : 1));
  leaves = [...leaves].sort((a, b) => (a.title < b.title ? -1 : 1));

  const count =
    leaves.length + children.reduce((s, c) => s + c.count, 0);
  return { path, label: mergedLabel, count, children, leaves };
}

export async function getLearningNameTree(userId: string): Promise<{
  categories: NameCategoryTree[];
  searchIndex: LearningSearchEntry[];
}> {
  const categories = await prisma.category.findMany({
    where: { userId },
    orderBy: { createdAt: "asc" },
    include: {
      learnedRules: true,
      events: {
        where: {
          OR: [
            { checklistItems: { some: { isSuggested: false } } },
            { editRecords: { some: {} } },
          ],
        },
        orderBy: { eventDatetime: "desc" },
        take: 300,
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
          checklistItems: {
            where: { isSuggested: false },
            orderBy: { sortOrder: "asc" },
            select: {
              kind: true,
              title: true,
              timingLabel: true,
              notifyLeadMinutes: true,
              isUserAdded: true,
            },
          },
          editRecords: {
            orderBy: { createdAt: "desc" },
            select: {
              id: true,
              createdAt: true,
              addedItems: true,
              removedItems: true,
              timingChanges: true,
              notifyChanges: true,
            },
          },
        },
      },
    },
  });

  const searchIndex: LearningSearchEntry[] = [];

  const out: NameCategoryTree[] = categories
    .filter((c) => c.events.length > 0)
    .map((c) => {
      // このカテゴリの予定のキーワード頻度
      const freq = new Map<string, number>();
      const evKw = new Map<string, string[]>();
      for (const ev of c.events) {
        const kws = parseKeywords(ev.feature?.keywords);
        evKw.set(ev.id, kws);
        for (const w of kws) freq.set(w, (freq.get(w) ?? 0) + 1);
      }

      const root: RawNode = { children: new Map(), leaves: [] };

      for (const ev of c.events) {
        const sig = signatureFromFeatureRow(ev.feature ?? null);
        const feat = featureFromRow(ev.feature ?? null);
        // この予定の特徴に当てはまる学習ルール（署名不問で当たるものを全部）
        const applied = c.learnedRules
          .filter((lr) => signatureMatches(lr.featureSignature, feat))
          .map(ruleView)
          .sort(
            (a, b) =>
              Number(b.forced) - Number(a.forced) ||
              b.effectiveConfidence - a.effectiveConfidence,
          );

        const leaf: NameTreeLeaf = {
          eventId: ev.id,
          title: ev.title,
          situationLabel: describeSignature(sig).text,
          keywords: evKw.get(ev.id) ?? [],
          editCount: ev.editRecords.length,
          list: {
            task: ev.checklistItems
              .filter((i) => i.kind !== "belonging")
              .map((i) => ({
                title: i.title,
                timingLabel: i.timingLabel,
                notifyLeadMinutes: i.notifyLeadMinutes,
                isUserAdded: i.isUserAdded,
              })),
            belonging: ev.checklistItems
              .filter((i) => i.kind === "belonging")
              .map((i) => ({
                title: i.title,
                timingLabel: i.timingLabel,
                notifyLeadMinutes: i.notifyLeadMinutes,
                isUserAdded: i.isUserAdded,
              })),
          },
          edits: ev.editRecords.map((e) => ({
            id: e.id,
            when: e.createdAt,
            changes: parseEditChanges(e),
          })),
          rules: applied,
        };

        const path = orderKeywords(evKw.get(ev.id) ?? [], freq);
        let cur = root;
        for (const k of path) {
          if (!cur.children.has(k)) {
            cur.children.set(k, { children: new Map(), leaves: [] });
          }
          cur = cur.children.get(k)!;
        }
        cur.leaves.push(leaf);

        searchIndex.push({
          eventId: ev.id,
          title: ev.title,
          crumb: [c.name, ...path].join(" › "),
        });
      }

      const node = toNode(root, "", "");
      node.label = c.name;
      node.path = c.id;

      return {
        categoryId: c.id,
        categoryName: c.name,
        eventCount: c.events.length,
        ruleCount: c.learnedRules.length,
        node,
      };
    });

  return { categories: out, searchIndex };
}

/** 保存済み EventFeature 行を EventFeatureData に戻す（署名照合用。keywords は不要）。 */
function featureFromRow(f: FeatureRow): EventFeatureData {
  return {
    isOverseas: f?.isOverseas ?? null,
    durationNights: f?.durationNights ?? null,
    isWeekday: f?.isWeekday ?? true,
    timeBucket: (f?.timeBucket ?? "allday") as TimeBucket,
    keywords: [],
  };
}
