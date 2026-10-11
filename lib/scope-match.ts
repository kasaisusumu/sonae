/**
 * 準備リストの項目の「次回いつ出すか」（範囲つきルール）の一致判定。
 * 「未来の自分へ」の一致判定と同じ正規化・関連語展開（lib/future-messages.ts）を使い、
 * ここでは「どのルールが、どの予定に当てはまり、どれが勝つか」だけを決める。
 *
 * 優先順位（同じ項目に複数当たったとき）: キーワード ＞ ジャンル／カテゴリ ＞ 似た予定。
 * 同じ優先度なら、より新しく更新されたルールが勝つ。
 */
import type { EventFeatureData } from "@/lib/features";
import { signatureMatches } from "@/lib/signature";
import {
  includesNorm,
  parseGenreKeywords,
  parseStrArray,
} from "@/lib/future-messages";
import { normTitle } from "@/lib/text-norm";

export interface ScopeRuleRow {
  id: string;
  action: string; // include | exclude
  kind: string;
  normTitle: string;
  title: string;
  scope: string; // genre | keyword | similar
  genreKeywords: string;
  keywords: string;
  categoryIds: string;
  signature: string | null;
  updatedAt: Date;
}

export interface ScopeContext {
  /** 一致判定の対象テキスト（予定タイトル＋説明欄の元メモ。自アプリのブロックは除く）。 */
  text: string;
  categoryId: string | null;
  feature: EventFeatureData;
}

const PRIORITY: Record<string, number> = { keyword: 3, genre: 2, similar: 1 };

/** 1 ルールが、この予定に当てはまるか。当たれば理由（一言）を返す。 */
export function matchScopeRule(rule: ScopeRuleRow, ctx: ScopeContext): string | null {
  if (rule.scope === "keyword") {
    for (const kw of parseStrArray(rule.keywords)) {
      if (includesNorm(ctx.text, kw)) return `キーワード「${kw}」に一致`;
    }
    return null;
  }
  if (rule.scope === "genre") {
    for (const g of parseGenreKeywords(rule.genreKeywords)) {
      for (const term of g.terms) {
        if (includesNorm(ctx.text, term)) {
          return `ジャンル「${g.genre}」の関連語「${term}」に一致`;
        }
      }
    }
    if (ctx.categoryId && parseStrArray(rule.categoryIds).includes(ctx.categoryId)) {
      return "同じカテゴリの予定";
    }
    return null;
  }
  if (rule.scope === "similar") {
    // 2026-10〜: 日時・長さ（featureSignature）ではなく、AI が判断した「同じ種類」
    // （例: バスと新幹線はどちらも「移動」）で当てる。genre と同じ、言い換え語の一致判定。
    for (const g of parseGenreKeywords(rule.genreKeywords)) {
      for (const term of g.terms) {
        if (includesNorm(ctx.text, term)) {
          return `似た予定（同じ種類「${g.genre}」の「${term}」に一致）`;
        }
      }
    }
    // 言い換え語が無い旧データ（AI 未設定時に作られたルールなど）は、
    // 従来の日時・長さの一致にフォールバックする。
    if (rule.signature && signatureMatches(rule.signature, ctx.feature)) {
      return "似た予定（日時・長さなどの特徴が一致）";
    }
    return null;
  }
  return null;
}

export interface ScopeDecision {
  action: "include" | "exclude";
  kind: string;
  title: string;
  reason: string;
}

/** 当たったルールを「項目（枠＋正規化タイトル）」ごとに 1 つに絞る。キーは `kind:normTitle`。 */
export function resolveScopeRules(
  rules: ScopeRuleRow[],
  ctx: ScopeContext,
): Map<string, ScopeDecision> {
  const sorted = [...rules].sort(
    (a, b) =>
      (PRIORITY[b.scope] ?? 0) - (PRIORITY[a.scope] ?? 0) ||
      b.updatedAt.getTime() - a.updatedAt.getTime(),
  );
  const best = new Map<string, ScopeDecision>();
  for (const r of sorted) {
    const key = `${r.kind}:${r.normTitle}`;
    if (best.has(key)) continue;
    const reason = matchScopeRule(r, ctx);
    if (reason) {
      best.set(key, {
        action: r.action === "exclude" ? "exclude" : "include",
        kind: r.kind,
        title: r.title,
        reason,
      });
    }
  }
  return best;
}

/** 組み立て済みの項目（BuiltItem 相当）に範囲ルールを当てる。除外は外し、追加は足す（重複させない）。 */
export function applyScopeDecisions<
  T extends { kind: string; title: string },
>(items: T[], decisions: Map<string, ScopeDecision>, make: (d: ScopeDecision) => T): T[] {
  const present = new Set(items.map((i) => `${i.kind}:${normTitle(i.title)}`));
  const out = items.filter(
    (i) => decisions.get(`${i.kind}:${normTitle(i.title)}`)?.action !== "exclude",
  );
  for (const [key, d] of decisions) {
    if (d.action === "include" && !present.has(key)) out.push(make(d));
  }
  return out;
}
