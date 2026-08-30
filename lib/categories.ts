import { prisma } from "@/lib/prisma";
import { classifyEventCategory } from "@/lib/categorize-ai";

// 仕様書のカテゴリ例。ユーザーは後から自由に追加・変更できる。
export const DEFAULT_CATEGORIES = [
  "旅行・出張",
  "通院",
  "来客対応",
  "契約・手続き",
  "その他",
] as const;

export const FALLBACK_CATEGORY = "その他";

/** キーワード規則で予定タイトル・説明文からカテゴリ名を推定する（凝った判定はしない）。 */
const RULES: { category: string; keywords: string[] }[] = [
  {
    category: "旅行・出張",
    keywords: [
      "旅行", "出張", "宿泊", "ホテル", "旅館", "フライト", "飛行機", "空港",
      "新幹線", "特急", "レンタカー", "ツアー", "帰省", "遠征", "合宿",
      "travel", "trip", "flight", "hotel", "airport",
    ],
  },
  {
    category: "通院",
    keywords: [
      "通院", "病院", "クリニック", "医院", "診察", "受診", "診療", "外来",
      "歯科", "歯医者", "健診", "健康診断", "人間ドック", "検査", "予防接種", "ワクチン",
      "hospital", "clinic", "doctor", "dental",
    ],
  },
  {
    category: "来客対応",
    keywords: [
      "来客", "来訪", "訪問", "お客様", "客先", "ご来社", "ゲスト", "内見",
      "面談", "打ち合わせ", "打合せ", "ミーティング", "商談", "接客",
      "guest", "visitor", "meeting",
    ],
  },
  {
    category: "契約・手続き",
    keywords: [
      "契約", "手続き", "手続", "申請", "提出", "更新", "解約", "登録",
      "役所", "市役所", "区役所", "銀行", "保険", "確定申告", "税務", "年金",
      "免許", "パスポート", "引っ越し", "引越", "面接", "説明会",
      "contract", "renewal", "application",
    ],
  },
];

export function inferCategoryName(
  title: string | null | undefined,
  description?: string | null,
): string {
  const haystack = `${title ?? ""}\n${description ?? ""}`.toLowerCase();
  for (const rule of RULES) {
    if (rule.keywords.some((kw) => haystack.includes(kw.toLowerCase()))) {
      return rule.category;
    }
  }
  return FALLBACK_CATEGORY;
}

/** ユーザーに初期カテゴリを用意する（既にあれば何もしない）。 */
export async function ensureDefaultCategories(userId: string): Promise<void> {
  const count = await prisma.category.count({ where: { userId } });
  if (count > 0) return;
  await prisma.category.createMany({
    data: DEFAULT_CATEGORIES.map((name) => ({ userId, name })),
  });
}

/**
 * 予定に対するカテゴリを決めて、そのカテゴリ行を返す（無ければ作成）。
 * 1) キーワード規則で決まればそれを使う（高速）
 * 2) 決まらなければ OpenAI で既存カテゴリから選ぶ or 新カテゴリ名を作る
 *    → カテゴリが内容に応じて自動で増えていく
 * 3) それも駄目なら「その他」
 */
export async function resolveCategoryForEvent(
  userId: string,
  title: string | null | undefined,
  description?: string | null,
  useAi = true,
) {
  const byRule = inferCategoryName(title, description);
  if (byRule !== FALLBACK_CATEGORY) {
    return getOrCreateCategory(userId, byRule);
  }
  if (!useAi) {
    return getOrCreateCategory(userId, FALLBACK_CATEGORY);
  }

  const existing = await prisma.category.findMany({
    where: { userId },
    select: { name: true },
  });
  const aiName = await classifyEventCategory({
    title: title ?? "(タイトルなし)",
    description,
    existingCategories: existing.map((c) => c.name),
  });

  return getOrCreateCategory(userId, aiName || FALLBACK_CATEGORY);
}

/** 名前でカテゴリを取得。なければ作成して返す。 */
export async function getOrCreateCategory(userId: string, name: string) {
  const trimmed = name.trim() || FALLBACK_CATEGORY;
  return prisma.category.upsert({
    where: { userId_name: { userId, name: trimmed } },
    update: {},
    create: { userId, name: trimmed },
  });
}
