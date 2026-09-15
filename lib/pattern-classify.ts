import OpenAI from "openai";

const MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";

export interface PatternClassification {
  isPattern: boolean;
  slotType?: string;
  /** 一般化テンプレート。プレースホルダは常にリテラルの "{slot}"。 */
  patternTemplate?: string;
  aiConfidence?: number;
}

const norm = (s: string) => s.trim().replace(/\s+/g, " ");

// 明らかに日付・番号・時刻などを含む項目は、その予定固有の内容である可能性が高い。
// AI を呼ぶまでもなく除外する（呼び出し回数を減らすための足切り。判定の主体はAI）。
function looksTooSpecific(title: string): boolean {
  return /\d{1,4}\s*(年|月|日|時|号|番|階)/.test(title);
}

const SYSTEM = `あなたは、予定の準備リストの項目が「別カテゴリの予定でも意味的に
転用できる汎用パターン」かどうかを判定するアシスタントです。

判定基準:
- 特定の固有名詞（人名・会社名・場所の固有名詞・書類の具体名など）を、一般的な
  スロット（例: 交通手段、宿泊先、持ち物の種類など）に置き換えても意味が通る、
  短く定型的な内容だけを isPattern=true とする。
  例: 「新幹線の時間を確認する」→ スロット「交通手段」に一般化できる → true
- その予定・その人に固有の内容は isPattern=false にする。
  例: 「田中さんに連絡する」「渋谷オフィスの鍵を返す」「〇〇契約書を提出する」→ false
- 判断に自信が持てないときは isPattern=false にする
  （外れる提案を出すくらいなら出さない方針）。

isPattern=true のときだけ、以下も返す:
- slotType: 一般化した対象の種類（2〜10文字程度の短い日本語。例: "交通手段"）
- patternTemplate: 元の項目を一般化したテンプレート。プレースホルダは必ず
  リテラルの "{slot}" を使う（例: "{slot}の時間を確認する"）
- aiConfidence: 0.0〜1.0 の確信度（自信があるときだけ 0.8 以上にする）

出力は必ず次の JSON のみ:
{"isPattern":true,"slotType":"...","patternTemplate":"...","aiConfidence":0.8}
または
{"isPattern":false}`;

/**
 * 準備リストに追加された項目が、別カテゴリでも転用できる汎用パターンかどうかを判定する。
 * OpenAI 未設定・失敗時・自信が持てないときは isPattern:false（何もしない）。
 */
export async function classifyItemPattern(input: {
  title: string;
  categoryName: string;
  keywords: string[];
}): Promise<PatternClassification> {
  const title = input.title.trim();
  if (!title) return { isPattern: false };
  if (looksTooSpecific(title)) return { isPattern: false };
  if (!process.env.OPENAI_API_KEY) return { isPattern: false };

  try {
    const client = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
      timeout: 12000,
      maxRetries: 0,
    });
    const completion = await client.chat.completions.create({
      model: MODEL,
      temperature: 0,
      max_tokens: 150,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM },
        {
          role: "user",
          content: `項目: ${title}\nカテゴリ: ${input.categoryName}\nキーワード: ${
            input.keywords.join(", ") || "(なし)"
          }`,
        },
      ],
    });
    const raw = JSON.parse(completion.choices[0]?.message?.content ?? "{}") as {
      isPattern?: unknown;
      slotType?: unknown;
      patternTemplate?: unknown;
      aiConfidence?: unknown;
    };
    if (raw.isPattern !== true) return { isPattern: false };

    const slotType =
      typeof raw.slotType === "string" ? norm(raw.slotType).slice(0, 20) : "";
    const patternTemplate =
      typeof raw.patternTemplate === "string"
        ? norm(raw.patternTemplate).slice(0, 60)
        : "";
    const aiConfidence =
      typeof raw.aiConfidence === "number" && Number.isFinite(raw.aiConfidence)
        ? Math.max(0, Math.min(1, raw.aiConfidence))
        : 0.5;

    // テンプレートに "{slot}" が無ければ埋め込みようがないので不採用。
    if (!slotType || !patternTemplate || !patternTemplate.includes("{slot}")) {
      return { isPattern: false };
    }
    return { isPattern: true, slotType, patternTemplate, aiConfidence };
  } catch (e) {
    console.error("[pattern-classify] classifyItemPattern 失敗", e);
    return { isPattern: false };
  }
}

// 予定のタイトル・キーワードに既知のスロット語が含まれていれば、AI を呼ばずに決める
// （呼び出し回数を減らすための素朴な辞書。決まらなければ AI に任せる）。
const SLOT_KEYWORDS: [string, string[]][] = [
  ["交通手段", ["新幹線", "電車", "バス", "飛行機", "タクシー", "レンタカー", "フェリー", "地下鉄"]],
  ["宿泊先", ["ホテル", "旅館", "民宿", "宿"]],
];

function findKeywordSlotMatch(
  title: string,
  keywords: string[],
  knownSlotTypes: Set<string>,
): { slotType: string; value: string } | null {
  const text = `${title} ${keywords.join(" ")}`;
  for (const [slotType, words] of SLOT_KEYWORDS) {
    if (!knownSlotTypes.has(slotType)) continue;
    for (const w of words) {
      if (text.includes(w)) return { slotType, value: w };
    }
  }
  return null;
}

/**
 * 新しい予定のタイトル・キーワードが、ユーザーが既に学習しているパターンの
 * いずれかの slotType に当てはまるか判定する（当てはまれば、当てはめる具体的な
 * 語＝ value も返す。例: slotType="交通手段", value="新幹線"）。
 * knownSlotTypes が空（＝pattern_item ルールが1件も無い）なら AI を呼ぶまでもない。
 */
export async function matchEventToSlotType(
  event: { title: string; keywords: string[] },
  knownSlotTypes: string[],
): Promise<{ slotType: string; value: string } | null> {
  if (knownSlotTypes.length === 0) return null;
  const known = new Set(knownSlotTypes);

  const byKeyword = findKeywordSlotMatch(event.title, event.keywords, known);
  if (byKeyword) return byKeyword;

  if (!process.env.OPENAI_API_KEY) return null;
  try {
    const client = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
      timeout: 10000,
      maxRetries: 0,
    });
    const completion = await client.chat.completions.create({
      model: MODEL,
      temperature: 0,
      max_tokens: 100,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: `予定のタイトル・キーワードが、次のスロットの種類のどれかに
当てはまるか判定します: ${knownSlotTypes.join(" / ")}
当てはまる場合、そのスロットに入る具体的な語（予定の中の言葉そのまま）も返します。
当てはまらなければ null にします（自信が無いときも null）。
出力は必ず次の JSON のみ: {"slotType":"..." または null,"value":"..." または null}`,
        },
        {
          role: "user",
          content: `タイトル: ${event.title}\nキーワード: ${
            event.keywords.join(", ") || "(なし)"
          }`,
        },
      ],
    });
    const raw = JSON.parse(completion.choices[0]?.message?.content ?? "{}") as {
      slotType?: unknown;
      value?: unknown;
    };
    const slotType =
      typeof raw.slotType === "string" ? norm(raw.slotType).slice(0, 20) : "";
    const value = typeof raw.value === "string" ? norm(raw.value).slice(0, 20) : "";
    if (!slotType || !value || !known.has(slotType)) return null;
    return { slotType, value };
  } catch (e) {
    console.error("[pattern-classify] matchEventToSlotType 失敗", e);
    return null;
  }
}
