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
      max_tokens: 120,
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

/**
 * 複数の予定をまとめて 1 回の呼び出しで分類する（AI 呼び出し回数の最小化）。
 * 入力と同じ順で結果を返す。要素は分類できなければ null。
 */
export async function classifyEventCategoriesBatch(
  items: { title: string; description?: string | null }[],
  existingCategories: string[],
): Promise<(string | null)[]> {
  if (items.length === 0) return [];
  if (!process.env.OPENAI_API_KEY) return items.map(() => null);
  if (items.length === 1) {
    return [await classifyEventCategory({ ...items[0], existingCategories })];
  }

  try {
    const client = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
      timeout: 15000,
      maxRetries: 0,
    });
    const list = items
      .map(
        (it, i) =>
          `${i + 1}. ${it.title}${
            it.description ? `（${it.description.slice(0, 120)}）` : ""
          }`,
      )
      .join("\n");
    const completion = await client.chat.completions.create({
      model: MODEL,
      temperature: 0,
      max_tokens: 400,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: `あなたは予定を分類するアシスタントです。
番号付きの予定リストを受け取り、各予定に最も合うカテゴリ名を割り当てます。
- 既存カテゴリ一覧に合うものがあればその名前をそのまま使う。
- 無ければ簡潔な日本語のカテゴリ名を作る（2〜8文字程度、"・"可、「の予定」等は付けない）。
- 「その他」はできるだけ避け、内容を表す名前にする。同種の予定は同じ名前にそろえる。
出力は必ず {"categories":["名前1","名前2",...]} の JSON のみ。要素数は入力の予定数と同じ。`,
        },
        {
          role: "user",
          content: `既存カテゴリ一覧: ${
            existingCategories.join(" / ") || "(なし)"
          }\n\n予定:\n${list}`,
        },
      ],
    });

    const raw = completion.choices[0]?.message?.content ?? "{}";
    const parsed = JSON.parse(raw) as { categories?: unknown };
    const arr = Array.isArray(parsed.categories) ? parsed.categories : [];
    return items.map((_, i) => {
      const v = arr[i];
      const name = typeof v === "string" ? v.trim() : "";
      return name && name.length <= 20 ? name : null;
    });
  } catch (err) {
    console.error("[categorize-ai] batch 失敗:", err);
    return items.map(() => null);
  }
}
