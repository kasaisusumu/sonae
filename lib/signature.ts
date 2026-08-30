import type { EventFeatureData } from "@/lib/features";

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
}

/** EventFeature を粗いバケットに落として、キー順を固定した JSON 文字列にする。 */
export function featureSignature(f: EventFeatureData): string {
  const sig: Sig = { d: durationBucket(f.durationNights), o: f.isOverseas };
  return JSON.stringify({ d: sig.d, o: sig.o ?? null });
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
 * - d が一致（unknown はどちらでも可）
 * - o が一致（null はどちらでも可）
 * カテゴリまたぎは呼び出し側で担保する（署名だけでは判定しない）。
 */
export function signatureMatches(
  ruleSignature: string,
  feature: EventFeatureData,
): boolean {
  if (!ruleSignature || ruleSignature === WILDCARD_SIGNATURE) return true;
  const sig = parseSig(ruleSignature);
  const evtBucket = durationBucket(feature.durationNights);

  if (
    sig.d !== undefined &&
    sig.d !== "unknown" &&
    evtBucket !== "unknown" &&
    sig.d !== evtBucket
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
  return true;
}
