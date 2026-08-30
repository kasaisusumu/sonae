import type { EventFeatureData, TimeBucket } from "@/lib/features";

export type DurationBucket = "day" | "short" | "multi" | "unknown";

export function durationBucket(nights: number | null): DurationBucket {
  if (nights === null || nights === undefined) return "unknown";
  if (nights <= 0) return "day";
  if (nights <= 2) return "short";
  return "multi";
}

interface Sig {
  d?: DurationBucket;
  o?: boolean | null;
  w?: boolean;
  t?: TimeBucket;
}

/**
 * EventFeature を粗いバケットに落として、キー順を固定した JSON 文字列にする。
 * 4 次元（期間・海外・平日・時間帯）で、以前より細かく分ける。
 */
export function featureSignature(f: EventFeatureData): string {
  return JSON.stringify({
    d: durationBucket(f.durationNights),
    o: f.isOverseas ?? null,
    w: f.isWeekday,
    t: f.timeBucket,
  });
}

/** 移行データや汎用ルール用のワイルドカード署名。 */
export const WILDCARD_SIGNATURE = "{}";

function parseSig(raw: string): Sig {
  try {
    const v = JSON.parse(raw);
    return typeof v === "object" && v !== null ? v : {};
  } catch {
    return {};
  }
}

/**
 * ルールの署名が、対象イベントの特徴に当てはまるか。
 * - "{}"（ワイルドカード）は何にでも当たる
 * - ルール側で指定されている次元だけを見る（未指定はワイルドカード）
 * - unknown / null は「どちらでも可」
 * カテゴリまたぎは呼び出し側で担保する。
 */
export function signatureMatches(
  ruleSignature: string,
  feature: EventFeatureData,
): boolean {
  if (!ruleSignature || ruleSignature === WILDCARD_SIGNATURE) return true;
  const sig = parseSig(ruleSignature);

  if (
    sig.d !== undefined &&
    sig.d !== "unknown" &&
    durationBucket(feature.durationNights) !== "unknown" &&
    sig.d !== durationBucket(feature.durationNights)
  ) {
    return false;
  }
  if (
    sig.o !== undefined &&
    sig.o !== null &&
    feature.isOverseas !== null &&
    sig.o !== feature.isOverseas
  ) {
    return false;
  }
  if (sig.w !== undefined && sig.w !== feature.isWeekday) return false;
  if (sig.t !== undefined && sig.t !== feature.timeBucket) return false;
  return true;
}

/** 署名の細かさ（当たったルールの中でより具体的なものを優先するため）。 */
export function signatureSpecificity(ruleSignature: string): number {
  if (!ruleSignature || ruleSignature === WILDCARD_SIGNATURE) return 0;
  const sig = parseSig(ruleSignature);
  let n = 0;
  if (sig.d !== undefined && sig.d !== "unknown") n++;
  if (sig.o !== undefined && sig.o !== null) n++;
  if (sig.w !== undefined) n++;
  if (sig.t !== undefined) n++;
  return n;
}
