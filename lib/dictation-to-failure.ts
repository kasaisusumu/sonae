import OpenAI from "openai";

const MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";

export interface FailureDictationResult {
  description: string;
  /** 対策が話の中に含まれていなければ null（無理に作らない）。 */
  countermeasure: string | null;
}

const norm = (s: string) => s.trim().replace(/\s+/g, " ");

const SYSTEM = `あなたは、段取りが苦手な人を支える日本語アシスタントです。
ユーザーが音声入力で話した「うっかり失敗の報告」を受け取り、次の2つに整えます。

- description: 何が起きたか（短い一文。例「集合時間に遅刻した」）
- countermeasure: 次に向けて考えた対策（話の中で言っていれば。言っていなければ null）

ルール:
- ユーザーが言っていないことは足さない・推測で水増ししない。
- 対策への言及が無ければ countermeasure は null にする（無理に作らない）。
- 出力は必ず次の JSON のみ: {"description":"...","countermeasure":"..." または null}`;

/** OpenAI 不使用時の素朴な分割（「次は」「今度は」「対策は」などを境目に前後で分ける）。 */
function fallback(text: string): FailureDictationResult {
  const t = norm(text);
  const m = t.match(
    /^(.*?)[。、]?\s*(?:次(?:から|は)|今度は|対策は|これからは)\s*(.+)$/,
  );
  if (m && m[1].trim() && m[2].trim()) {
    return {
      description: norm(m[1]).slice(0, 200),
      countermeasure: norm(m[2]).slice(0, 200),
    };
  }
  return { description: t.slice(0, 200), countermeasure: null };
}

/**
 * 音声入力（キーボードのマイク）で話した自由文を、失敗ログの
 * 「何が起きたか」と「有効だった対策」に AI で整える。
 * OpenAI キーが無い・失敗時は素朴なルールで分割する。
 */
export async function splitDictationIntoFailure(
  text: string,
): Promise<FailureDictationResult> {
  const trimmed = text.trim().slice(0, 2000);
  if (!trimmed) return { description: "", countermeasure: null };

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
        max_tokens: 300,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content: trimmed },
        ],
      });
      const raw = JSON.parse(
        completion.choices[0]?.message?.content ?? "{}",
      ) as { description?: unknown; countermeasure?: unknown };
      const description =
        typeof raw.description === "string"
          ? norm(raw.description).slice(0, 200)
          : "";
      const countermeasure =
        typeof raw.countermeasure === "string" && raw.countermeasure.trim()
          ? norm(raw.countermeasure).slice(0, 200)
          : null;
      if (description) return { description, countermeasure };
    } catch (e) {
      console.error("[splitDictationIntoFailure] OpenAI 失敗", e);
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
