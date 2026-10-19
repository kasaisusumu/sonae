/**
 * 準備リストの項目ごとの「次回いつ出すか」（範囲）の提案・保存・切り替え。
 *
 * - 項目を追加・削除したとき、範囲を推奨する。新規項目の既定値は「似た予定」
 *   （ユーザー指摘により2026-10-19: 画面の初期表示と保存時の実際の決定が
 *   食い違い、保存すると「今回だけ」に勝手に変わってしまうバグがあったため、
 *   AIには判定させず画面の既定値と同じ「似た予定」に揃えた）。日付・番号・時刻
 *   などを含む明らかに一度きりの内容だけは「今回だけ」に決める（looksTooSpecific）。
 * - 推奨は「提案のまま適用中」（status=proposed）。ユーザーが選び直すと「選んだ」（status=chosen）。
 * - 範囲の一致判定は lib/scope-match.ts に任せる（ここは保存と提案だけ）。
 */
import { prisma } from "@/lib/prisma";
import { looksTooSpecific, normTitle, pickKeyword } from "@/lib/text-norm";
import type { EventFeatureData } from "@/lib/features";
import { featureSignature } from "@/lib/signature";
import {
  expandGenreKeywords,
  stringifyGenreKeywords,
  stringifyStrArray,
} from "@/lib/future-messages";
import { stripSonaeBlock } from "@/lib/description";
import { classifyItemCategories } from "@/lib/item-categories";

export const ITEM_SCOPES = ["auto", "event_only", "genre", "keyword", "similar"] as const;
export type ItemScope = (typeof ITEM_SCOPES)[number];

interface Recommendation {
  scope: ItemScope;
  keyword: string | null;
  genre: string | null;
  reason: string;
  source: "default";
}

const DEFAULT_REASON = "自動で覚えます（従来どおり）";
const SIMILAR_DEFAULT_REASON = "似た予定でも出せるよう、まず「似た予定」にしています";

export { pickKeyword };

export interface EventScopeInput {
  userId: string;
  eventId: string;
  eventTitle: string;
  eventMemo: string | null;
  categoryId: string | null;
  categoryName: string;
  feature: EventFeatureData;
}

function eventTextOf(input: EventScopeInput): string {
  return `${input.eventTitle}\n${stripSonaeBlock(input.eventMemo)}`;
}

/** 範囲ルール 1 件ぶんの作成データ（scope 別）。auto と event_only は作らない（null）。 */
async function buildRuleData(
  input: EventScopeInput,
  action: "include" | "exclude",
  kind: string,
  title: string,
  scope: ItemScope,
  rec: { keyword: string | null; genre: string | null; reason: string },
  /**
   * 既に「似た予定」として同じ項目に当たっていたルール（選び直す前のもの）。
   * 同じ項目を「似た予定」のまま選び直しただけ（ボタンの二度押し等）なら、
   * カテゴリ分類を AI に聞き直さずそのまま使い回す（一度決めたカテゴリは再利用し、
   * 予定が追加されるたびに再生成しない。ユーザー指摘により2026-10-19）。
   */
  previousSimilarRule?: { categories: string } | null,
) {
  const base = {
    userId: input.userId,
    action,
    kind,
    normTitle: normTitle(title),
    title,
    reason: rec.reason,
    sourceEventId: input.eventId,
    sourceEventTitle: input.eventTitle,
  };
  if (scope === "keyword") {
    const kw = rec.keyword ?? pickKeyword(input.eventTitle);
    return {
      ...base,
      scope,
      keywords: stringifyStrArray([kw]),
      genres: "[]",
      genreKeywords: "[]",
      categoryIds: "[]",
      signature: null,
    };
  }
  if (scope === "genre") {
    const genre = rec.genre ?? input.categoryName;
    const expanded = await expandGenreKeywords([genre], [], input.userId).catch(() => []);
    return {
      ...base,
      scope,
      keywords: "[]",
      genres: stringifyStrArray([genre]),
      genreKeywords: stringifyGenreKeywords(expanded),
      categoryIds: stringifyStrArray(input.categoryId ? [input.categoryId] : []),
      signature: null,
    };
  }
  if (scope === "similar") {
    if (previousSimilarRule && previousSimilarRule.categories !== "[]") {
      return {
        ...base,
        scope,
        keywords: "[]",
        genres: "[]",
        genreKeywords: "[]",
        categoryIds: "[]",
        categories: previousSimilarRule.categories,
        signature: null,
      };
    }
    // 「似た予定」に設定したこの瞬間に、AI を1回だけ呼んでカテゴリ（事前定義語彙から
    // 最大5個）を決める。以後、新しい予定との照合はこのカテゴリとのルールベース
    // 照合のみで行い、AI は呼ばない（lib/item-categories.ts / lib/scope-match.ts）。
    const categories = await classifyItemCategories(
      title,
      eventTextOf(input),
      input.userId,
    );
    return {
      ...base,
      scope,
      keywords: "[]",
      genres: "[]",
      genreKeywords: "[]",
      categoryIds: "[]",
      categories: stringifyStrArray(categories),
      // カテゴリが1つも決まらなかった（AI未設定・失敗）ときだけ、旧来の日時・長さの
      // 一致にフォールバックする（lib/scope-match.ts 参照）。
      signature: categories.length > 0 ? null : featureSignature(input.feature),
    };
  }
  return null;
}

async function archiveRule(ruleId: string | null): Promise<void> {
  if (!ruleId) return;
  await prisma.checklistScopeRule.updateMany({
    where: { id: ruleId, archivedAt: null },
    data: { archivedAt: new Date() },
  });
}

/**
 * 1 項目ぶんの範囲を保存する。ユーザーが「選んだ」（chosen）行は、提案では上書きしない。
 * 既存の提案は、新しい推奨で置き換える（古いルールは archive）。
 */
async function saveScopeForItem(
  input: EventScopeInput,
  action: "include" | "exclude",
  kind: string,
  title: string,
  scope: ItemScope,
  source: "ai" | "default" | "user",
  rec: { keyword: string | null; genre: string | null; reason: string },
  status: "proposed" | "chosen",
): Promise<void> {
  const nt = normTitle(title);
  const where = {
    eventId_kind_normTitle: { eventId: input.eventId, kind, normTitle: nt },
  };
  const existing = await prisma.eventChecklistScope.findUnique({
    where,
    include: { rule: true },
  });
  if (existing?.status === "chosen" && status === "proposed") return;

  // 「似た予定」のまま選び直しただけなら、カテゴリを AI に聞き直さず前回の結果を使い回す
  // （ボタンの二度押し等で毎回 AI を呼ぶ無駄・待ち時間を避ける。一度保存したカテゴリは
  // 再利用し、予定が追加されるたびに再生成しない、というユーザー指摘どおり）。
  const previousSimilarRule =
    scope === "similar" && existing?.scope === "similar" && existing.rule
      ? { categories: existing.rule.categories }
      : null;

  await archiveRule(existing?.ruleId ?? null);
  const ruleData = await buildRuleData(
    input,
    action,
    kind,
    title,
    scope,
    rec,
    previousSimilarRule,
  );
  const rule = ruleData
    ? await prisma.checklistScopeRule.create({ data: ruleData })
    : null;

  const row = {
    userId: input.userId,
    eventId: input.eventId,
    kind,
    normTitle: nt,
    title,
    action,
    scope,
    ruleId: rule?.id ?? null,
    reason: rec.reason,
    source,
    status,
  };
  await prisma.eventChecklistScope.upsert({ where, create: row, update: row });
}

/**
 * 保存のたびに呼ぶ。追加・削除された項目の範囲を推奨（AI）して保存し、
 * 打ち直しで消えた追加の提案を畳み、戻ってきた項目の除外の提案を外す。
 * 返り値は「action:正規化タイトル → 決まった範囲」（学習 recordEdit に渡す対象を絞るのに使う）。
 */
export async function proposeScopesForSave(input: {
  scope: EventScopeInput;
  kind: string;
  /** 今の保存で残っている項目タイトル（すべて） */
  present: string[];
  /** 今の保存で新しく現れた項目（追加） */
  added: string[];
  /** 今の保存で消えた項目（削除） */
  removed: string[];
}): Promise<Map<string, ItemScope>> {
  const { scope, kind } = input;
  const presentNorm = new Set(input.present.map(normTitle));
  const decided = new Map<string, ItemScope>();

  // 1) 打ち直し・削除で、もう無い「追加の提案」を畳む（除外の提案は、項目が戻るまで残す）
  const rows = await prisma.eventChecklistScope.findMany({
    where: { eventId: scope.eventId, kind },
  });
  for (const r of rows) {
    if (r.status === "dropped") continue;
    const stillPresent = presentNorm.has(r.normTitle);
    const drop =
      (r.action === "include" && !stillPresent) ||
      (r.action === "exclude" && stillPresent);
    if (!drop) continue;
    await archiveRule(r.ruleId);
    await prisma.eventChecklistScope.update({
      where: { id: r.id },
      data: { status: "dropped", ruleId: null },
    });
  }

  // 2) 新しく現れた項目・消えた項目に、範囲を推奨する
  const targets: { action: "include" | "exclude"; title: string }[] = [
    ...input.added.map((t) => ({ action: "include" as const, title: t })),
    ...input.removed.map((t) => ({ action: "exclude" as const, title: t })),
  ];
  for (const t of targets) {
    const nt = normTitle(t.title);
    if (!nt) continue;
    const key = `${t.action}:${nt}`;
    const existing = await prisma.eventChecklistScope.findUnique({
      where: {
        eventId_kind_normTitle: { eventId: scope.eventId, kind, normTitle: nt },
      },
    });
    // 既に提案・選択がある行は触らない（AI を毎回呼ばない）。打ち直しで dropped だった行は作り直す。
    if (existing && existing.status !== "dropped") {
      decided.set(key, existing.scope as ItemScope);
      continue;
    }
    let rec: Recommendation = {
      scope: "auto",
      keyword: null,
      genre: null,
      reason: DEFAULT_REASON,
      source: "default",
    };
    // すでに同じ名前の項目で範囲を決めたこと（ルール）があれば、AIに聞き直さず
    // その範囲のまま引き継ぐ（ユーザー指摘により2026-10-14追加。「次回の出し方」は
    // 前回その名前で決めた状態を毎回引き継ぐ、という原則）。
    const priorRule = await prisma.checklistScopeRule.findFirst({
      where: { userId: scope.userId ?? undefined, kind, normTitle: nt, action: t.action, archivedAt: null },
      orderBy: { updatedAt: "desc" },
    });
    // 明らかに今回限定の項目は、AI 枠（aiLeft）を使わずに event_only へ即決める
    // （recommend 内にも同じ足切りがあるが、ここで止めれば AI 枠を消費しない分、
    // 他の本当に判断が要る項目に枠を残せる）。
    if (priorRule && (priorRule.scope === "genre" || priorRule.scope === "keyword" || priorRule.scope === "similar")) {
      rec = {
        scope: priorRule.scope,
        keyword: priorRule.scope === "keyword" ? firstRuleKeyword(priorRule.keywords) : null,
        genre: priorRule.scope !== "keyword" ? (parseJsonArray(priorRule.genres)[0] ?? null) : null,
        reason: "前回この名前で決めた範囲のまま",
        source: "default",
      };
    } else if (looksTooSpecific(t.title)) {
      rec = {
        scope: "event_only",
        keyword: null,
        genre: null,
        reason: DEFAULT_REASON,
        source: "default",
      };
    } else {
      // 既定値は「似た予定」（ユーザー指摘により2026-10-19）。画面の初期表示
      // （checklist-editor.tsx の shownScope）と必ず揃える。AIには判定させない
      // （以前はAIに判定させていたが、画面の既定値と食い違い、保存すると
      // 勝手に「今回だけ」に変わってしまうことがあった）。
      rec = {
        scope: "similar",
        keyword: null,
        genre: null,
        reason: SIMILAR_DEFAULT_REASON,
        source: "default",
      };
    }
    await saveScopeForItem(
      scope,
      t.action,
      kind,
      t.title,
      rec.scope,
      rec.source,
      rec,
      "proposed",
    );
    decided.set(key, rec.scope);
  }
  return decided;
}

/** 項目の範囲を、ユーザーが選び直す（チップから）。「選んだ」として保存し、ルールを作り直す。 */
export async function setItemScope(input: {
  scope: EventScopeInput;
  kind: string;
  title: string;
  chosen: ItemScope;
}): Promise<void> {
  const { scope } = input;
  await saveScopeForItem(
    scope,
    "include",
    input.kind,
    input.title,
    input.chosen,
    "user",
    {
      keyword: pickKeyword(scope.eventTitle),
      genre: scope.categoryName || null,
      reason: "あなたが選びました",
    },
    "chosen",
  );
}

/**
 * 項目の範囲をキーワード（カスタム）にする。詳細を開いたときの、文章形式の任意オプション。
 * クイック選択の3番目（「この名前の予定だけ」＝予定名から自動）とは別に、
 * 任意の語に差し替えたいときに使う。手動だけの設定（AI は提案しない）。
 */
export async function setItemKeywordScope(input: {
  scope: EventScopeInput;
  kind: string;
  title: string;
  keyword: string;
}): Promise<void> {
  const keyword = input.keyword.trim().slice(0, 60);
  if (!keyword) return;
  await saveScopeForItem(
    input.scope,
    "include",
    input.kind,
    input.title,
    "keyword",
    "user",
    { keyword, genre: null, reason: `「${keyword}」を含む予定のときに出すよう設定しました` },
    "chosen",
  );
}

/** 適用中の範囲ルール（ユーザー単位・未アーカイブのみ）。 */
export async function loadActiveScopeRules(userId: string) {
  return prisma.checklistScopeRule.findMany({
    where: { userId, archivedAt: null },
  });
}

export interface EventScopeEntry {
  scope: ItemScope;
  status: string;
  reason: string | null;
  /** scope が "keyword" のときの、現在のキーワード（文章欄の初期値用）。 */
  keyword: string | null;
}

/** 予定ごとの範囲（画面のチップ用）。キーは `kind:normTitle`。dropped と削除の印（exclude）は含めない。 */
export async function loadEventScopeMap(
  userId: string,
  eventId: string,
): Promise<Map<string, EventScopeEntry>> {
  const rows = await prisma.eventChecklistScope.findMany({
    where: { userId, eventId, status: { not: "dropped" }, action: "include" },
    include: { rule: { select: { keywords: true } } },
  });
  return new Map(
    rows.map((r) => [
      `${r.kind}:${r.normTitle}`,
      {
        scope: r.scope as ItemScope,
        status: r.status,
        reason: r.reason,
        keyword: r.rule ? firstRuleKeyword(r.rule.keywords) : null,
      },
    ]),
  );
}

/** 保存結果（proposeScopesForSave の返り値）で、この項目が「自動学習の対象」か。範囲が決まっていれば対象外。 */
export function isAutoScopeDecision(
  decided: Map<string, ItemScope>,
  action: "include" | "exclude",
  title: string,
): boolean {
  const s = decided.get(`${action}:${normTitle(title)}`);
  return !s || s === "auto";
}

/** 範囲ルールを 1 行の文章にする（学習内容の一覧用）。例:「ホテル」の予定のとき：名刺を出す */
export function describeScopeRule(rule: {
  action: string;
  title: string;
  scope: string;
  keywords: string;
  genres: string;
  categories?: string;
}): string {
  const verb = rule.action === "exclude" ? "出さない" : "出す";
  let when = "";
  if (rule.scope === "keyword") {
    const kws = parseJsonArray(rule.keywords);
    when = `「${kws.join("」「")}」を含む予定のとき`;
  } else if (rule.scope === "genre") {
    const gs = parseJsonArray(rule.genres);
    when = gs.length > 0 ? `「${gs.join("」「")}」の予定のとき` : "同じカテゴリの予定のとき";
  } else if (rule.scope === "similar") {
    const cats = parseJsonArray(rule.categories ?? "[]");
    const gs = parseJsonArray(rule.genres);
    when =
      cats.length > 0
        ? `「${cats.join("」「")}」に関係する予定のとき`
        : gs.length > 0
          ? `「${gs[0]}」と同じ種類の予定のとき`
          : "似た予定のとき";
  } else {
    when = "似た予定のとき";
  }
  return `${when}：${rule.title}を${verb}`;
}

/** ルールの keywords（JSON文字列）の先頭1件。文章欄の初期値に使う。 */
export function firstRuleKeyword(raw: string): string | null {
  return parseJsonArray(raw)[0] ?? null;
}

function parseJsonArray(raw: string): string[] {
  try {
    const a = JSON.parse(raw);
    return Array.isArray(a) ? a.map((x) => String(x)) : [];
  } catch {
    return [];
  }
}
