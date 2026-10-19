import { prisma } from "@/lib/prisma";

/**
 * OpenAI の公開料金表（$/100万トークン、Standard tier）。
 * 2026-10-14 に https://developers.openai.com/api/docs/pricing で確認済み
 * （gpt-4o-mini: input $0.15 / output $0.60 / cached input $0.075 — いずれも
 * 2026-10 時点の値と一致、変更なし）。正確な請求額は OpenAI 側の管理画面でしか
 * 分からない（このアプリの集計はあくまで概算）。モデルを変えたら、ここにも追記すること。
 * `cachedInput` を省略したモデルは、キャッシュ割引価格が未確認という意味で
 * `input`（通常価格）のまま計算する（過小に見積もらない安全側）。
 */
const PRICING_USD_PER_1M: Record<
  string,
  { input: number; output: number; cachedInput?: number }
> = {
  "gpt-4o-mini": { input: 0.15, output: 0.6, cachedInput: 0.075 },
};
const FALLBACK_PRICING = PRICING_USD_PER_1M["gpt-4o-mini"];
// 概算の固定レート（為替変動は追わない。管理画面の金額はあくまで目安）。
const USD_TO_JPY = 155;

export interface TokenUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  /** プロンプトキャッシュで再利用された入力トークン数（OpenAI SDKのCompletionUsage.prompt_tokens_details）。 */
  prompt_tokens_details?: { cached_tokens?: number } | null;
}

/**
 * 入力トークンのうちキャッシュ分は半額（cachedInput）、残りは通常価格（input）で計算する。
 * 2026-10-14 までの実績（scripts/reconcile-ai-usage.mjs での照合）ではキャッシュ利用は
 * ほぼ0件だったため金額への影響は無いが、プロンプトが長くなりキャッシュが効くようになると
 * 効いてくる。
 */
export function estimateCostYen(model: string, usage: TokenUsage | null | undefined): number {
  if (!usage) return 0;
  const price = PRICING_USD_PER_1M[model] ?? FALLBACK_PRICING;
  const promptTokens = usage.prompt_tokens ?? 0;
  const cachedTokens = Math.min(usage.prompt_tokens_details?.cached_tokens ?? 0, promptTokens);
  const uncachedTokens = promptTokens - cachedTokens;
  const cachedPrice = price.cachedInput ?? price.input;
  const inputCostUsd =
    (uncachedTokens / 1_000_000) * price.input + (cachedTokens / 1_000_000) * cachedPrice;
  const outputCostUsd = ((usage.completion_tokens ?? 0) / 1_000_000) * price.output;
  return (inputCostUsd + outputCostUsd) * USD_TO_JPY;
}

/**
 * AI利用の「操作」（recordAiUsage の feature 引数）ごとの表示名と、
 * どちらの機能モード（lib/feature-mode.ts）に属するか。管理画面の内訳表示用
 * （ユーザー指摘により2026-10-19: 「全体でどの操作がどのくらいの金額消費したか」
 * 「それがver1,2どっちなのかもわかるように」）。
 * 新しく recordAiUsage を呼ぶ箇所を足したら、ここにも追記すること。
 */
export const AI_FEATURE_INFO: Record<string, { label: string; mode: "ver1" | "ver2" | "共通" }> = {
  "checklist-generate": { label: "準備リスト生成", mode: "共通" },
  categorize: { label: "カテゴリ分類", mode: "共通" },
  "categorize-batch": { label: "カテゴリ分類（まとめて）", mode: "共通" },
  "dictation-to-list": { label: "音声入力（準備リスト）", mode: "共通" },
  "tidy-list": { label: "一括貼り付けの整形", mode: "共通" },
  "pattern-classify-item": { label: "カテゴリ横断パターン分類（項目）", mode: "ver1" },
  "pattern-classify-event": { label: "カテゴリ横断パターン分類（予定）", mode: "ver1" },
  "dictation-to-failure": { label: "音声入力（失敗ログ）", mode: "ver1" },
  "tidy-countermeasure": { label: "対策の整形", mode: "ver1" },
  "item-scope-recommend": { label: "次回の出し方の推奨", mode: "ver2" },
  "item-scope-categories": { label: "似た予定のカテゴリ分類", mode: "ver2" },
  "dictation-to-message": { label: "音声入力（未来の自分へ）", mode: "ver2" },
  "message-genre-expand": { label: "ジャンル関連語の展開", mode: "ver2" },
  "message-proposal": { label: "振り返りメッセージ提案", mode: "ver2" },
};
export function aiFeatureLabel(feature: string): string {
  return AI_FEATURE_INFO[feature]?.label ?? feature;
}
export function aiFeatureMode(feature: string): "ver1" | "ver2" | "共通" {
  return AI_FEATURE_INFO[feature]?.mode ?? "共通";
}

/**
 * OpenAI 呼び出し1回ぶんの利用量を記録する（管理画面「AI利用金額」の元データ）。
 * 金額はトークン数からの概算で、実際の請求額と厳密には一致しない。
 * 集計用の副次記録のため、失敗しても本編の処理は止めない（await しない）。
 */
export function recordAiUsage(
  userId: string | null | undefined,
  feature: string,
  model: string,
  usage: TokenUsage | null | undefined,
): void {
  if (!userId || !usage) return;
  const inputTokens = usage.prompt_tokens ?? 0;
  const outputTokens = usage.completion_tokens ?? 0;
  const estimatedCostYen = estimateCostYen(model, usage);
  void prisma.aiUsageEvent
    .create({ data: { userId, feature, model, inputTokens, outputTokens, estimatedCostYen } })
    .catch(() => {});
}
