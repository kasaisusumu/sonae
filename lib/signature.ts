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

const DURATION_JP: Record<string, string> = {
  day: "日帰り",
  short: "1〜2泊",
  multi: "3泊以上",
};
const TIMEBUCKET_JP: Record<string, string> = {
  morning: "午前",
  afternoon: "午後",
  evening: "夕方以降",
  allday: "終日",
};

export interface SignatureDescription {
  parts: string[]; // 例: ["海外", "3泊以上", "平日", "午前"]
  text: string; // 例: "海外・3泊以上・平日・午前"、空なら "すべての予定に共通"
}

/** 特徴シグネチャを日本語の「どの場合」ラベルに変換する（学習内容の樹形図表示用）。 */
export function describeSignature(raw: string): SignatureDescription {
  const sig = parseSig(raw);
  const parts: string[] = [];
  if (sig.o === true) parts.push("海外");
  else if (sig.o === false) parts.push("国内");
  if (sig.d && sig.d !== "unknown" && DURATION_JP[sig.d]) {
    parts.push(DURATION_JP[sig.d]);
  }
  if (sig.w === true) parts.push("平日");
  else if (sig.w === false) parts.push("休日");
  if (sig.t && TIMEBUCKET_JP[sig.t]) parts.push(TIMEBUCKET_JP[sig.t]);
  return { parts, text: parts.length ? parts.join("・") : "すべての予定に共通" };
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
