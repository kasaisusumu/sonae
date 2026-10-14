import { prisma } from "@/lib/prisma";

/**
 * OpenAI の公開料金表（$/100万トークン、Standard tier）。
 * 2026-10-14 に https://developers.openai.com/api/docs/pricing で確認済み
 * （gpt-4o-mini: input $0.15 / output $0.60 / cached input $0.075 — いずれも
 * 2026-10 時点の値と一致、変更なし）。正確な請求額は OpenAI 側の管理画面でしか
 * 分からない（このアプリの集計はあくまで概算）。モデルを変えたら、ここにも追記すること。
 *
 * 既知の精度の限界: キャッシュされた入力トークン（prompt caching）は本来 input の
 * 半額（$0.075/1M）だが、`recordAiUsage` が受け取る `usage` には
 * `prompt_tokens_details.cached_tokens` が含まれておらず、現状すべての入力トークンを
 * フルプライスで計算している（実際の請求額より概算が高くなりうる）。この影響は、
 * OpenAI の実績CSVとの照合で `input_cached_tokens` が実質 0 であることを確認済みの
 * 期間では無視できる（scripts/reconcile-ai-usage.mjs 参照）。プロンプトが長くなり
 * キャッシュが効くようになったら、この関数の対応が必要になる。
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
