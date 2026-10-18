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
import { inferCategoriesFromText } from "@/lib/item-categories";

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
  /** scope="similar" 専用。事前定義語彙から選んだカテゴリ（JSON配列、最大5個）。 */
  categories: string;
  signature: string | null;
  updatedAt: Date;
}

export interface ScopeContext {
  /**
   * 一致判定の対象テキスト。呼び出し元（lib/suggest.ts）が、予定タイトル＋説明欄の元メモ
   * （自アプリのブロックは除く）に、組み立て済みの準備リストの項目名も連結して渡す
   * （キーワードが予定名に出ず、項目名にだけ出ることがあるため、2026-10〜）。
   */
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
    // 「似た予定」は「この名前」の拡張版という位置づけなので、項目名そのものが
    // 本文に出てくる（＝キーワード一致と同じ条件）ときも必ず当てる
    // （ユーザー指摘により2026-10-19追加。これが無いと、言い換え語が項目名の
    // 直接一致より狭くなり、同じ名前がそのまま来たときに外れることがあった）。
    if (includesNorm(ctx.text, rule.title)) {
      return `似た予定（項目名「${rule.title}」に一致）`;
    }
    // 2026-10-19〜: カテゴリ方式。「似た予定」に設定したタイミングで事前に決めた
    // カテゴリ（最大5個）と、新しい予定からルールベースで推定したカテゴリを照合する
    // （AI は呼ばない）。複数（2つ以上）重なったときだけ一致とみなす。単一の
    // カテゴリしか重ならない場合は、たまたま広いカテゴリに触れただけの可能性が
    // 高いため当てない。
    const savedCategories = parseStrArray(rule.categories);
    if (savedCategories.length > 0) {
      const eventCategories = inferCategoriesFromText(ctx.text);
      const overlap = savedCategories.filter((c) => eventCategories.includes(c));
      if (overlap.length >= 2) {
        return `似た予定（カテゴリ「${overlap.join("」「")}」が一致）`;
      }
      return null;
    }
    // カテゴリ未分類の旧データ（このカテゴリ方式の導入前に作られたルール）は、
    // 以前の言い換え語・日時特徴の判定にフォールバックする。
    for (const g of parseGenreKeywords(rule.genreKeywords)) {
      for (const term of g.terms) {
        if (includesNorm(ctx.text, term)) {
          return `似た予定（同じ種類「${g.genre}」の「${term}」に一致）`;
        }
      }
    }
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
  /** 当てたルール自身の範囲（genre/keyword/similar）とID。次に出すときの「次回の出し方」
   * の初期状態を、このルールの状態のまま引き継ぐために使う（lib/suggest.ts 参照）。 */
  scope: string;
  ruleId: string;
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
        scope: r.scope,
        ruleId: r.id,
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
