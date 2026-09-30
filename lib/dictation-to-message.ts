import OpenAI from "openai";

const MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";

export interface MessageDictationItem {
  body: string;
  keywords: string[];
  genres: string[];
}

const norm = (s: string) => s.trim().replace(/\s+/g, " ");

const SYSTEM = `あなたは「未来の自分へのメッセージ」アプリのアシスタントです。
ユーザーが音声入力で話した「いつか思い出したいこと」を受け取り、1件ずつの配列に整えます。
**複数の話題が話されていたら、それぞれ別の要素に分けてください**（1つだけなら要素は1つ）。

各要素:
- body: メッセージの本文（次に読む自分への短い一文。例「前回のギブアンドテイクを忘れない」）
- keywords: 本文から、次に同じ種類の予定を見分けるのに使えそうな固有名詞（人名・会社名など）
- genres: 本文から、当てはまりそうな予定の種類（「〇〇系」の形。無理に作らなくてよい）

ルール:
- ユーザーが言っていないことは足さない・推測で水増ししない。
- keywords・genres は該当が無ければ空配列でよい。
- 最大 10 件。
- 出力は必ず次の JSON のみ:
{"items":[{"body":"...","keywords":["..."],"genres":["..."]}, ...]}`;

function parseItems(raw: unknown, cap = 10): MessageDictationItem[] {
  if (!Array.isArray(raw)) return [];
  const out: MessageDictationItem[] = [];
  for (const x of raw) {
    const o = (x ?? {}) as {
      body?: unknown;
      keywords?: unknown;
      genres?: unknown;
    };
    const body = typeof o.body === "string" ? norm(o.body).slice(0, 500) : "";
    if (!body) continue;
    const strList = (v: unknown): string[] =>
      Array.isArray(v)
        ? [...new Set(v.map((s) => String(s).trim()).filter(Boolean))].slice(0, 8)
        : [];
    out.push({ body, keywords: strList(o.keywords), genres: strList(o.genres) });
    if (out.length >= cap) break;
  }
  return out;
}

/** OpenAI 不使用時の素朴な分割（句読点・接続語で区切るだけ。keywords/genres は空）。 */
function fallback(text: string): MessageDictationItem[] {
  const parts = norm(text)
    .split(/[\n、,，。・]|(?:\s+と\s+)|(?:\s*あと\s*)|(?:\s*それと\s*)|(?:\s*それから\s*)/g)
    .map((s) => norm(s))
    .filter((s) => s.length > 0 && s.length < 500)
    .slice(0, 10);
  return parts.map((body) => ({ body, keywords: [], genres: [] }));
}

/**
 * 音声入力（キーボードのマイク）で話した自由文を、「未来の自分へのメッセージ」の
 * 本文・キーワード・ジャンル候補に AI で整える。複数話しても要素ごとに分ける。
 * OpenAI キーが無い・失敗時は素朴な分割にフォールバックする。
 */
export async function splitDictationIntoMessages(
  text: string,
): Promise<MessageDictationItem[]> {
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
        max_tokens: 700,
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
      console.error("[splitDictationIntoMessages] OpenAI 失敗", e);
    }
  }
  return fallback(trimmed);
}
