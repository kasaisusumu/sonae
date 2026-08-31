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

// ── 「学習内容」画面用: カテゴリ → 予定名の樹形図 → その予定で出てくるリスト ──
// 同じ名前・同じ内容で、時間帯や長さだけが違う予定は 1 つの葉にまとめる。

export interface LeafListItem {
  id: string;
  title: string;
  comment: string | null;
  isDone: boolean;
  isUserAdded: boolean;
  notifyLeadMinutes: number | null;
}

export interface LeafFailure {
  id: string;
  description: string; // 全文（切らない）
  occurredAt: Date;
  estimatedLossYen: number;
  outcome: string | null; // "prevented" | "not_prevented" | null
}

/** 樹形図の葉 = 実際に学習した予定（内容が同じものはまとめて 1 つ） */
export interface NameTreeLeaf {
  eventId: string; // 代表（最新）の予定
  siblingEventIds: string[]; // まとめられた他の予定
  mergedCount: number;
  title: string;
  /** "国内・日帰り・平日・午前" など。まとめた場合は件数表示 */
  situationLabel: string;
  keywords: string[];
  list: { task: LeafListItem[]; belonging: LeafListItem[] };
  failures: LeafFailure[];
}

/** 樹形図の枝 = 予定名の語による分岐 */
export interface NameTreeNode {
  path: string;
  label: string;
  count: number; // この枝以下の葉（まとめ後）の数
  children: NameTreeNode[];
  leaves: NameTreeLeaf[];
}

export interface NameCategoryTree {
  categoryId: string;
  categoryName: string;
  eventCount: number;
  node: NameTreeNode;
}

export interface LearningSearchEntry {
  eventId: string;
  title: string;
  crumb: string; // "旅行・出張 › 旅行 › ハワイ"
  keywords: string[];
  items: string[]; // リストの項目名（準備すること＋持ち物）
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

// ── 予定名の樹形図を組む ──────────────────────────────

interface RawLeaf {
  eventId: string;
  title: string;
  sig: string;
  customized: boolean; // 個別編集で同名グループから切り離されたか
  keywords: string[];
  list: { task: LeafListItem[]; belonging: LeafListItem[] };
  failures: LeafFailure[];
}

type RawNode = { children: Map<string, RawNode>; leaves: RawLeaf[] };

function orderKeywords(kws: string[], freq: Map<string, number>): string[] {
  return [...kws].sort(
    (a, b) => (freq.get(b) ?? 0) - (freq.get(a) ?? 0) || (a < b ? -1 : 1),
  );
}

/**
 * 葉をまとめる。
 * - 同名で「未編集（listCustomized=false）」の予定は、内容の細かな差に関わらず 1 つにまとめる。
 * - 個別編集で切り離した予定は、それぞれ独立した葉にする（＝編集で分かれたときだけ分かれる）。
 */
function mergeLeaves(raw: RawLeaf[]): NameTreeLeaf[] {
  const groups = new Map<string, RawLeaf[]>();
  for (const l of raw) {
    const key = l.customized
      ? `${norm(l.title)}#${l.eventId}`
      : `${norm(l.title)}#shared`;
    const arr = groups.get(key);
    if (arr) arr.push(l);
    else groups.set(key, [l]);
  }
  return [...groups.values()]
    .map((g) => {
      const rep = g[0];
      const seen = new Set<string>();
      const failures = g
        .flatMap((x) => x.failures)
        .filter((f) => (seen.has(f.id) ? false : (seen.add(f.id), true)))
        .sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime());
      return {
        eventId: rep.eventId,
        siblingEventIds: g.slice(1).map((x) => x.eventId),
        mergedCount: g.length,
        title: rep.title,
        situationLabel:
          g.length > 1
            ? `同じ名前の未編集 ${g.length}件`
            : rep.customized
              ? `${describeSignature(rep.sig).text}（個別編集）`
              : describeSignature(rep.sig).text,
        keywords: rep.keywords,
        list: rep.list,
        failures,
      } satisfies NameTreeLeaf;
    })
    .sort((a, b) => (a.title < b.title ? -1 : a.title > b.title ? 1 : 0));
}

function toNode(raw: RawNode, label: string, parentPath: string): NameTreeNode {
  const path = parentPath ? `${parentPath}/${label}` : label;
  let children = [...raw.children.entries()].map(([k, v]) => toNode(v, k, path));
  let leaves = mergeLeaves(raw.leaves);

  // 1 子・0 葉 の連なりは畳んでラベルをつなぐ（"旅行" ▸ "ハワイ" → "旅行・ハワイ"）
  let mergedLabel = label;
  while (children.length === 1 && leaves.length === 0) {
    const only = children[0];
    mergedLabel = `${mergedLabel}・${only.label}`;
    children = only.children;
    leaves = only.leaves;
  }

  children.sort((a, b) => b.count - a.count || (a.label < b.label ? -1 : 1));
  const count = leaves.length + children.reduce((s, c) => s + c.count, 0);
  return { path, label: mergedLabel, count, children, leaves };
}

function collectSearch(
  node: NameTreeNode,
  crumbParts: string[],
  acc: LearningSearchEntry[],
): void {
  const parts = [...crumbParts, node.label];
  for (const leaf of node.leaves) {
    acc.push({
      eventId: leaf.eventId,
      title: leaf.title,
      crumb: parts.join(" › "),
      keywords: leaf.keywords,
      items: [...leaf.list.task, ...leaf.list.belonging].map((i) => i.title),
    });
  }
  for (const child of node.children) collectSearch(child, parts, acc);
}

export async function getLearningNameTree(userId: string): Promise<{
  categories: NameCategoryTree[];
  searchIndex: LearningSearchEntry[];
}> {
  const categories = await prisma.category.findMany({
    where: { userId },
    orderBy: { createdAt: "asc" },
    include: {
      events: {
        where: {
          OR: [
            // 準備リストがあり、かつユーザーが確認 or 編集した予定だけを学習内容として出す。
            // 生成しただけ・未確認・未編集のものは学習には使わない。
            {
              AND: [
                { checklistItems: { some: { isSuggested: false } } },
                {
                  OR: [
                    { editRecords: { some: {} } },
                    { listCustomized: true },
                    { listReviewedAt: { not: null } },
                  ],
                },
              ],
            },
            { failureLogs: { some: {} } },
          ],
        },
        orderBy: { eventDatetime: "desc" },
        take: 400,
        select: {
          id: true,
          title: true,
          listCustomized: true,
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
              id: true,
              kind: true,
              title: true,
              comment: true,
              isDone: true,
              notifyLeadMinutes: true,
              isUserAdded: true,
            },
          },
          failureLogs: {
            orderBy: { occurredAt: "desc" },
            select: {
              id: true,
              description: true,
              occurredAt: true,
              estimatedLossYen: true,
              outcome: true,
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
      const freq = new Map<string, number>();
      const evKw = new Map<string, string[]>();
      for (const ev of c.events) {
        const kws = parseKeywords(ev.feature?.keywords);
        evKw.set(ev.id, kws);
        for (const w of kws) freq.set(w, (freq.get(w) ?? 0) + 1);
      }

      const root: RawNode = { children: new Map(), leaves: [] };

      for (const ev of c.events) {
        const toItem = (i: {
          id: string;
          title: string;
          comment: string | null;
          isDone: boolean;
          isUserAdded: boolean;
          notifyLeadMinutes: number | null;
        }): LeafListItem => ({
          id: i.id,
          title: i.title,
          comment: i.comment,
          isDone: i.isDone,
          isUserAdded: i.isUserAdded,
          notifyLeadMinutes: i.notifyLeadMinutes,
        });

        const rawLeaf: RawLeaf = {
          eventId: ev.id,
          title: ev.title,
          sig: signatureFromFeatureRow(ev.feature ?? null),
          customized: ev.listCustomized,
          keywords: evKw.get(ev.id) ?? [],
          list: {
            task: ev.checklistItems
              .filter((i) => i.kind !== "belonging")
              .map(toItem),
            belonging: ev.checklistItems
              .filter((i) => i.kind === "belonging")
              .map(toItem),
          },
          failures: ev.failureLogs.map((f) => ({
            id: f.id,
            description: f.description,
            occurredAt: f.occurredAt,
            estimatedLossYen: f.estimatedLossYen,
            outcome: f.outcome,
          })),
        };

        const path = orderKeywords(evKw.get(ev.id) ?? [], freq);
        let cur = root;
        for (const k of path) {
          if (!cur.children.has(k)) {
            cur.children.set(k, { children: new Map(), leaves: [] });
          }
          cur = cur.children.get(k)!;
        }
        cur.leaves.push(rawLeaf);
      }

      const node = toNode(root, "", "");
      node.label = c.name;
      node.path = c.id;
      collectSearch(node, [], searchIndex);

      return {
        categoryId: c.id,
        categoryName: c.name,
        eventCount: c.events.length,
        node,
      };
    });

  return { categories: out, searchIndex };
}
