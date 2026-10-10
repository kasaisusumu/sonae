/**
 * 準備リストの項目ごとの「次回いつ出すか」（範囲）の提案・保存・切り替え。
 *
 * - 項目を追加・削除したとき、AI（OpenAI）が範囲を推奨する（OpenAI 未設定なら「自動」＝従来どおり）。
 * - 推奨は「提案のまま適用中」（status=proposed）。ユーザーが選び直すと「選んだ」（status=chosen）。
 * - 同じ予定で AI に聞く回数は上限つき（AI_JUDGE_CAP_PER_EVENT）。打ち直しで増えないよう、
 *   打ち直して消えた提案は削除せず status=dropped にして、回数の計算に残す。
 * - 範囲の一致判定は lib/scope-match.ts に任せる（ここは保存と提案だけ）。
 */
import OpenAI from "openai";
import { prisma } from "@/lib/prisma";
import { normTitle } from "@/lib/text-norm";
import type { EventFeatureData } from "@/lib/features";
import { featureSignature } from "@/lib/signature";
import {
  expandGenreKeywords,
  stringifyGenreKeywords,
  stringifyStrArray,
} from "@/lib/future-messages";
import { stripSonaeBlock } from "@/lib/description";

export const ITEM_SCOPES = ["auto", "event_only", "genre", "keyword", "similar"] as const;
export type ItemScope = (typeof ITEM_SCOPES)[number];

export const AI_JUDGE_CAP_PER_EVENT = 8;
const MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";

interface Recommendation {
  scope: ItemScope;
  keyword: string | null;
  genre: string | null;
  reason: string;
  source: "ai" | "default";
}

const DEFAULT_REASON = "自動で覚えます（従来どおり）";

// AI の推奨は「今回のみ」「似たような予定で提案」の2択だけ（2026-10〜）。
// キーワード指定は、詳細を開いたときの任意のオプション（手動のみ・AI は提案しない）。
const SYSTEM = `あなたは準備リストの項目の「次回の出し方」を決めます。
ユーザーが項目を追加または削除した理由を推測し、次のどちらかを選びます。
- event_only: 今回の予定だけの内容（特定の場所・人・案件に依存する／一度きりの内容）
- similar: 似た日時・長さの予定でも出したい、汎用的な内容
出力は必ず次の JSON のみ:
{"scope":"event_only|similar","reason":"1行の理由（ユーザーに見せる）"}`;

async function recommend(input: {
  action: "include" | "exclude";
  title: string;
  eventTitle: string;
  eventText: string;
  categoryName: string;
}): Promise<Recommendation> {
  const fallback: Recommendation = {
    scope: "auto",
    keyword: null,
    genre: null,
    reason: DEFAULT_REASON,
    source: "default",
  };
  if (!process.env.OPENAI_API_KEY) return fallback;
  try {
    const client = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
      timeout: 8000,
      maxRetries: 0,
    });
    const completion = await client.chat.completions.create({
      model: MODEL,
      temperature: 0.2,
      max_tokens: 200,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM },
        {
          role: "user",
          content: JSON.stringify({
            操作: input.action === "include" ? "追加" : "削除",
            項目: input.title,
            予定名: input.eventTitle,
            予定の説明: input.eventText.slice(0, 300),
            カテゴリ: input.categoryName,
          }),
        },
      ],
    });
    const raw = JSON.parse(completion.choices[0]?.message?.content ?? "{}") as {
      scope?: unknown;
      reason?: unknown;
    };
    const scope = String(raw.scope) === "similar" ? "similar" : "event_only";
    const reason = String(raw.reason ?? "").trim().slice(0, 120) || DEFAULT_REASON;
    return { scope, keyword: null, genre: null, reason, source: "ai" };
  } catch (e) {
    console.error("[recommendItemScope] AI 失敗（自動に戻す）", e);
    return fallback;
  }
}

/** 予定名から、キーワード候補を 1 つ選ぶ（区切りで分けた最初の 2 文字以上）。 */
export function pickKeyword(eventTitle: string): string {
  const parts = eventTitle
    .split(/[\s　・／/（）()「」【】『』,、]+/)
    .map((p) => p.trim())
    .filter((p) => p.length >= 2);
  return (parts[0] ?? eventTitle.trim()).slice(0, 30);
}

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
    const expanded = await expandGenreKeywords([genre], []).catch(() => []);
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
    return {
      ...base,
      scope,
      keywords: "[]",
      genres: "[]",
      genreKeywords: "[]",
      categoryIds: "[]",
      signature: featureSignature(input.feature),
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
  const existing = await prisma.eventChecklistScope.findUnique({ where });
  if (existing?.status === "chosen" && status === "proposed") return;

  await archiveRule(existing?.ruleId ?? null);
  const ruleData = await buildRuleData(input, action, kind, title, scope, rec);
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

  // 2) 新しく現れた項目・消えた項目に、範囲を推奨する（AI の上限つき）
  const aiUsed = await prisma.eventChecklistScope.count({
    where: { eventId: scope.eventId, source: "ai" },
  });
  let aiLeft = Math.max(0, AI_JUDGE_CAP_PER_EVENT - aiUsed);
  const text = eventTextOf(scope);

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
    if (aiLeft > 0 && process.env.OPENAI_API_KEY) {
      aiLeft -= 1;
      rec = await recommend({
        action: t.action,
        title: t.title,
        eventTitle: scope.eventTitle,
        eventText: text,
        categoryName: scope.categoryName,
      });
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
 * 項目の範囲を「キーワード」にする（詳細を開いたときの、文章形式の任意オプション）。
 * 2択（event_only/similar）とは別の、手動だけの設定（AI は提案しない）。
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

/** 範囲ルールを外す（ルールは残すが適用しない）。自分のルールだけ扱う。 */
export async function archiveScopeRule(userId: string, ruleId: string): Promise<boolean> {
  const rule = await prisma.checklistScopeRule.findFirst({
    where: { id: ruleId, userId, archivedAt: null },
    select: { id: true },
  });
  if (!rule) return false;
  await prisma.checklistScopeRule.update({
    where: { id: ruleId },
    data: { archivedAt: new Date() },
  });
  // 紐づく予定側の行は「自動」に戻す（チップの表示と、実際に効いている範囲を揃える）
  await prisma.eventChecklistScope.updateMany({
    where: { userId, ruleId },
    data: { ruleId: null, scope: "auto", status: "chosen" },
  });
  return true;
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

/** 範囲ルールを 1 行の文章にする（学習内容の一覧用）。例:「玉姫殿」の予定のとき：名刺を出す */
export function describeScopeRule(rule: {
  action: string;
  title: string;
  scope: string;
  keywords: string;
  genres: string;
}): string {
  const verb = rule.action === "exclude" ? "出さない" : "出す";
  let when = "";
  if (rule.scope === "keyword") {
    const kws = parseJsonArray(rule.keywords);
    when = `「${kws.join("」「")}」を含む予定のとき`;
  } else if (rule.scope === "genre") {
    const gs = parseJsonArray(rule.genres);
    when = gs.length > 0 ? `「${gs.join("」「")}」の予定のとき` : "同じカテゴリの予定のとき";
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
