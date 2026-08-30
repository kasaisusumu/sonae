import OpenAI from "openai";

const MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";

/**
 * 予定タイトル・説明文から、既存カテゴリのどれか、または新しい簡潔なカテゴリ名を返す。
 * キーワード規則で決まらなかったときだけ呼ぶ想定。OpenAI 未設定・失敗時は null。
 */
export async function classifyEventCategory(input: {
  title: string;
  description?: string | null;
  existingCategories: string[];
}): Promise<string | null> {
  if (!process.env.OPENAI_API_KEY) return null;

  try {
    const client = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
      timeout: 12000,
      maxRetries: 0,
    });
    const completion = await client.chat.completions.create({
      model: MODEL,
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: `あなたは予定を分類するアシスタントです。
与えられた予定に最も合うカテゴリ名を1つだけ選びます。
- 既存カテゴリ一覧に適切なものがあればその名前をそのまま使う。
- 無ければ、新しく簡潔な日本語のカテゴリ名を作る（2〜8文字程度、"・"は可、末尾に「の予定」等は付けない）。
- 「その他」はできるだけ避け、内容を表す具体的な名前にする。
出力は必ず {"category":"カテゴリ名"} の JSON のみ。`,
        },
        {
          role: "user",
          content: `既存カテゴリ一覧: ${input.existingCategories.join(" / ") || "(なし)"}
予定タイトル: ${input.title}
説明: ${input.description?.slice(0, 500) || "(なし)"}`,
        },
      ],
    });

    const raw = completion.choices[0]?.message?.content ?? "{}";
    const parsed = JSON.parse(raw) as { category?: unknown };
    const name =
      typeof parsed.category === "string" ? parsed.category.trim() : "";
    if (!name || name.length > 20) return null;
    return name;
  } catch (err) {
    console.error("[categorize-ai] 失敗:", err);
    return null;
  }
}
