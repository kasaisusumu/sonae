import OpenAI from "openai";
import { parseBulkTitles } from "@/lib/bulk";

const MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";

const SYSTEM = `あなたは、段取りが苦手な人を支える日本語アシスタントです。
ユーザーが音声入力などで思いつくまま話した「準備リストのメモ」を受け取り、
準備リストの項目に整えます。

ルール:
- 1 項目 1 要素。短い名詞（持ち物）または「〜する」で終える短い文（行動）。
- ユーザーが言っていないことは足さない。水増ししない。
- 「〜と〜」「、」などで区切られていれば分割する。
- 重複はまとめる。丁寧すぎる言い換えはしない。
- 最大 30 項目。
- 出力は必ず次の JSON のみ: {"items":["...","..."]}`;

/**
 * 自由文（音声入力を含む）を、準備リストの項目配列に整える。
 * OpenAI 未設定・失敗時は、記号や番号を落とす素朴な行分割にフォールバックする。
 */
export async function tidyListItems(text: string): Promise<string[]> {
  const trimmed = text.trim().slice(0, 4000);
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
      if (Array.isArray(raw.items)) {
        const seen = new Set<string>();
        const out: string[] = [];
        for (const x of raw.items) {
          if (typeof x !== "string") continue;
          const t = x.trim().replace(/\s+/g, " ").slice(0, 120);
          const k = t.toLowerCase();
          if (!t || seen.has(k)) continue;
          seen.add(k);
          out.push(t);
          if (out.length >= 30) break;
        }
        if (out.length > 0) return out;
      }
    } catch (e) {
      console.error("[tidyListItems] OpenAI 失敗", e);
    }
  }
  return parseBulkTitles(trimmed);
}
