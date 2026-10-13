import { prisma } from "@/lib/prisma";

/**
 * OpenAI の公開料金表（$/100万トークン）。2026-10 時点の目安で、正確な請求額は
 * OpenAI 側の管理画面でしか分からない（このアプリの集計はあくまで概算）。
 * モデルを変えたら、ここにも追記すること。
 */
const PRICING_USD_PER_1M: Record<string, { input: number; output: number }> = {
  "gpt-4o-mini": { input: 0.15, output: 0.6 },
};
const FALLBACK_PRICING = PRICING_USD_PER_1M["gpt-4o-mini"];
// 概算の固定レート（為替変動は追わない。管理画面の金額はあくまで目安）。
const USD_TO_JPY = 155;

export interface TokenUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
}

export function estimateCostYen(model: string, usage: TokenUsage | null | undefined): number {
  if (!usage) return 0;
  const price = PRICING_USD_PER_1M[model] ?? FALLBACK_PRICING;
  const inputCostUsd = ((usage.prompt_tokens ?? 0) / 1_000_000) * price.input;
  const outputCostUsd = ((usage.completion_tokens ?? 0) / 1_000_000) * price.output;
  return (inputCostUsd + outputCostUsd) * USD_TO_JPY;
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
