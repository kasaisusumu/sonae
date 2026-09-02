/**
 * 準備リストの「枠」（セクション）。
 * 内部キーは文字列。組み込みの 2 枠だけ英語キー（task / belonging）で、
 * 表示名に変換する。ユーザーが足した枠はキー＝表示名（日本語可）。
 */

export const BUILTIN_SECTIONS = ["task", "belonging"] as const;

/**
 * 「リスト枠として並べ替えできるが、準備項目の枠ではない」特別キー。
 * 先頭が "@" のキーは実データの枠ではない目印。sectionOrder には保存されるが、
 * 説明欄・学習など実枠を扱う所では isRealSection で除外する。
 */
export const FAILURE_LOG_KEY = "@faillog";
export function isRealSection(key: string): boolean {
  return !!key && !key.startsWith("@");
}
const BUILTIN_LABEL: Record<string, string> = {
  task: "準備すること",
  belonging: "持ち物",
};
const LABEL_TO_KEY: Record<string, string> = {
  準備すること: "task",
  持ち物: "belonging",
};

export function isBuiltinSection(key: string): boolean {
  return key === "task" || key === "belonging";
}

/** キー → 見出しの表示名。 */
export function sectionLabel(key: string): string {
  return BUILTIN_LABEL[key] ?? key;
}

/** 説明欄の見出し文字列 → 内部キー（組み込みは英語キーへ、他はそのまま）。 */
export function sectionKeyFromLabel(label: string): string {
  const t = label.trim();
  return LABEL_TO_KEY[t] ?? t;
}

/** JSON 文字列を string[] にパース。壊れていたら既定の 2 枠。 */
export function parseSectionOrder(raw: string | null | undefined): string[] {
  try {
    const a = JSON.parse(raw ?? "[]");
    if (Array.isArray(a)) {
      const out = a.filter((x): x is string => typeof x === "string" && !!x);
      if (out.length > 0) return dedupe(out);
    }
  } catch {
    /* ignore */
  }
  return ["task", "belonging"];
}

export function stringifySectionOrder(order: string[]): string {
  return JSON.stringify(dedupe(order.filter((x) => !!x)));
}

function dedupe(arr: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const x of arr) {
    if (!seen.has(x)) {
      seen.add(x);
      out.push(x);
    }
  }
  return out;
}

/**
 * 表示に使う枠の並び。sectionOrder を基本に、
 * それに無いが項目が存在するキーを末尾に足す。空なら組み込み 2 枠。
 */
export function resolveSections(
  order: string[] | string | null | undefined,
  usedKinds: Iterable<string>,
): string[] {
  const base = Array.isArray(order) ? order : parseSectionOrder(order);
  const merged = dedupe([...base, ...Array.from(usedKinds).filter(Boolean)]);
  return merged.length > 0 ? merged : ["task", "belonging"];
}
