import OpenAI from "openai";

const MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";

export interface FailureDictationItem {
  description: string;
  /** 対策が話の中に含まれていなければ null（無理に作らない）。 */
  countermeasure: string | null;
}

const norm = (s: string) => s.trim().replace(/\s+/g, " ");

const SYSTEM = `あなたは、段取りが苦手な人を支える日本語アシスタントです。
ユーザーが音声入力で話した「うっかり失敗の報告」を受け取り、1件ずつの配列に整えます。
**複数の失敗が話されていたら、それぞれ別の要素に分けてください**（1つだけなら要素は1つ）。

各要素:
- description: 何が起きたか（短い一文。例「集合時間に遅刻した」）
- countermeasure: その失敗について次に向けて考えた対策（話の中で言っていれば。無ければ null）

ルール:
- ユーザーが言っていないことは足さない・推測で水増ししない。
- 対策は、直前に話された失敗に対応するものだけを当てはめる。関係ない失敗には付けない。
- 対策への言及が無ければ countermeasure は null にする（無理に作らない）。
- 最大 10 件。
- 出力は必ず次の JSON のみ:
{"items":[{"description":"...","countermeasure":"..." または null}, ...]}`;

function parseItems(raw: unknown, cap = 10): FailureDictationItem[] {
  if (!Array.isArray(raw)) return [];
  const out: FailureDictationItem[] = [];
  for (const x of raw) {
    const o = (x ?? {}) as { description?: unknown; countermeasure?: unknown };
    const description =
      typeof o.description === "string" ? norm(o.description).slice(0, 200) : "";
    if (!description) continue;
    const countermeasure =
      typeof o.countermeasure === "string" && o.countermeasure.trim()
        ? norm(o.countermeasure).slice(0, 200)
        : null;
    out.push({ description, countermeasure });
    if (out.length >= cap) break;
  }
  return out;
}

/**
 * OpenAI 不使用時の素朴な分割。「、」「。」「あと」「それと」「それから」などで
 * 複数の失敗に分け、最後の要素だけ「次は/対策は」などを境目に対策を切り出す
 * （対策は基本、話の一番最後にまとめて言われることが多いため）。
 */
function fallback(text: string): FailureDictationItem[] {
  const t = norm(text);
  const COUNTERMEASURE_CUE =
    /[。、]?\s*(?:次(?:から|は)|今度は|対策は|これからは)\s*(.+)$/;
  const cueMatch = t.match(COUNTERMEASURE_CUE);
  const countermeasure = cueMatch ? norm(cueMatch[1]).slice(0, 200) : null;
  const body = cueMatch ? t.slice(0, cueMatch.index) : t;

  const parts = body
    .split(/[\n、,，。・]|(?:\s+と\s+)|(?:\s*あと\s*)|(?:\s*それと\s*)|(?:\s*それから\s*)/g)
    .map((s) => norm(s))
    .filter((s) => s.length > 0 && s.length < 200)
    .slice(0, 10);

  if (parts.length === 0) return [];
  return parts.map((description, i) => ({
    description,
    // 対策は最後の失敗に対応すると仮定して、最後の要素だけに付ける。
    countermeasure: i === parts.length - 1 ? countermeasure : null,
  }));
}

/**
 * 音声入力（キーボードのマイク）で話した自由文を、失敗ログの
 * 「何が起きたか」と「有効だった対策」の配列に AI で整える。複数の失敗を
 * まとめて話しても、それぞれ別々の要素に分ける。
 * OpenAI キーが無い・失敗時は素朴なルールで分割する。
 */
export async function splitDictationIntoFailures(
  text: string,
): Promise<FailureDictationItem[]> {
  const trimmed = text.trim().slice(0, 2000);
  if (!trimmed) return [];

  if (process.env.OPENAI_API_KEY) {
    try {
      const client = new OpenAI({
        apiKey: process.env.OPENAI_API_KEY,
        timeout: 20000,
        maxRetries: 1,
      });
      const completion = await client.chat.completions.create({
        model: MODEL,
        temperature: 0.2,
        max_tokens: 600,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content: trimmed },
        ],
      });
      const raw = JSON.parse(
        completion.choices[0]?.message?.content ?? "{}",
      ) as { items?: unknown };
      const items = parseItems(raw.items);
      if (items.length > 0) return items;
    } catch (e) {
      console.error("[splitDictationIntoFailures] OpenAI 失敗", e);
    }
  }
  return fallback(trimmed);
}

const COUNTERMEASURE_SYSTEM = `あなたは日本語アシスタントです。
ユーザーが音声入力で話した「うっかり失敗を防ぐための対策」を、短い一文に整えます。

ルール:
- 言っていないことを足さない・内容を変えない。話し言葉を短い書き言葉にするだけ。
- 出力は整えた文だけ（前置き・記号・引用符なし）。`;

/**
 * 対策の自由文（音声入力）を短い一文に整える。内容の追加・削除はしない。
 * OpenAI 未設定・失敗時は、前後の空白を整えただけの元の文を返す。
 */
export async function tidyCountermeasureText(text: string): Promise<string> {
  const trimmed = text.trim().slice(0, 1000);
  if (!trimmed) return "";

  if (process.env.OPENAI_API_KEY) {
    try {
      const client = new OpenAI({
        apiKey: process.env.OPENAI_API_KEY,
        timeout: 20000,
        maxRetries: 1,
      });
      const completion = await client.chat.completions.create({
        model: MODEL,
        temperature: 0.2,
        max_tokens: 150,
        messages: [
          { role: "system", content: COUNTERMEASURE_SYSTEM },
          { role: "user", content: trimmed },
        ],
      });
      const out = completion.choices[0]?.message?.content?.trim();
      if (out) return norm(out).slice(0, 200);
    } catch (e) {
      console.error("[tidyCountermeasureText] OpenAI 失敗", e);
    }
  }
  return norm(trimmed).slice(0, 200);
}
