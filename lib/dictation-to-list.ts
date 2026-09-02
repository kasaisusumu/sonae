import OpenAI from "openai";

const MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";

export interface DictationSection {
  name: string; // 枠の表示名（例「買うもの」「連絡すること」）
  items: string[];
}
export interface DictationResult {
  task: string[]; // 準備すること（行動）
  belonging: string[]; // 持ち物（物の名前）
  sections: DictationSection[]; // task/belonging に入らない独自の枠
  failures: string[]; // 考えられる失敗（うっかり・ミス）
}

const SYSTEM_PROMPT = `あなたは、段取りが苦手な人（ADHD傾向）を支える日本語アシスタントです。
ユーザーがスマホの音声入力で思いつくまま話した「準備メモ」を受け取り、準備リストに整理します。

分け方:
- task（準備すること）: これからやる行動。「〜を確認する」「〜を予約する」のように動詞で終える短い文。
- belonging（持ち物）: 当日持っていく物の名前だけ。短い名詞（例「充電器」「保険証」「折りたたみ傘」）。行動は書かない。
- sections: task にも belonging にも当てはまらない、ユーザー固有のまとまり。
  例:「買うもの」（弁当・お茶）、「連絡すること」（上司に遅れる旨）、「渡すもの」「持って帰るもの」など。
  name は 2〜6 文字の短い日本語。無理に作らない（該当が無ければ空配列）。
- failures（考えられる失敗）: 「前回◯◯を忘れた」「◯◯し忘れそう」「◯◯に遅刻しがち」など、
  この予定で起こりうる うっかり・ミス。過去形／心配ごととして語られたもの。
  一言の短い文（例「保険証を忘れた」「集合時間に遅刻した」）。準備の行動は task に入れ、
  ここには入れない。該当が無ければ空配列。

ルール:
- ユーザーが言っていないことは足さない。推測で水増ししない。
- 1つの発言が複数項目なら分割する（「着替えと充電器」→ belonging に2つ）。
- 重複はまとめる。丁寧すぎる言い換えはしない。ユーザーの言葉を尊重する。
- 各配列は最大 20 件、sections は最大 4 個。
- 出力は必ず次の JSON のみ:
{"task":["..."],"belonging":["..."],"sections":[{"name":"買うもの","items":["弁当","お茶"]}],"failures":["..."]}`;

const norm = (s: string) => s.trim().replace(/\s+/g, " ");
function strList(v: unknown, cap = 20): string[] {
  if (!Array.isArray(v)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const x of v) {
    if (typeof x !== "string") continue;
    const t = norm(x).slice(0, 120);
    if (!t) continue;
    const k = t.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(t);
    if (out.length >= cap) break;
  }
  return out;
}

/** OpenAI 不使用時の素朴な振り分け（改行・読点・「と」で割り、行動か物か失敗かを推測）。 */
function fallback(text: string): DictationResult {
  const parts = text
    .split(/[\n、,，。・]|(?:\s+と\s+)|(?:\s*および\s*)/g)
    .map((s) => norm(s))
    .filter((s) => s.length > 0 && s.length < 120);

  const task: string[] = [];
  const belonging: string[] = [];
  const failures: string[] = [];
  const seen = new Set<string>();
  for (const p of parts) {
    const k = p.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    const looksFailure =
      /(忘れ|忘れた|し忘れ|寝坊|遅刻|遅れた|遅れがち|なくし|失くし|無くし|ミス|うっかり|しくじ|間に合わな|見落と|勘違い)/.test(
        p,
      );
    if (looksFailure) {
      failures.push(p);
      continue;
    }
    const looksAction =
      /(する|して|しとく|しておく|確認|予約|連絡|準備|買う|買っ|調べ|決め|申し込|払|出す|送る|作る|チェック|手続き)/.test(
        p,
      ) || p.length > 16;
    (looksAction ? task : belonging).push(p);
  }
  return {
    task: strList(task),
    belonging: strList(belonging),
    sections: [],
    failures: strList(failures),
  };
}

/**
 * 音声入力（キーボードのマイク）で話した自由文を、準備すること・持ち物・
 * 必要な枠 に AI で振り分ける。OpenAI キーが無ければ素朴なルールで振り分ける。
 */
export async function splitDictationIntoList(
  text: string,
  ctx: { title: string; categoryName: string },
): Promise<DictationResult> {
  const trimmed = text.trim().slice(0, 4000);
  if (!trimmed) return { task: [], belonging: [], sections: [], failures: [] };

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
        max_tokens: 900,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          {
            role: "user",
            content: `予定: ${ctx.title}（${ctx.categoryName}）\n\n話した内容:\n${trimmed}`,
          },
        ],
      });
      const raw = JSON.parse(
        completion.choices[0]?.message?.content ?? "{}",
      ) as {
        task?: unknown;
        belonging?: unknown;
        sections?: unknown;
        failures?: unknown;
      };
      const sections: DictationSection[] = Array.isArray(raw.sections)
        ? (raw.sections as unknown[])
            .map((s) => {
              const o = (s ?? {}) as { name?: unknown; items?: unknown };
              const name =
                typeof o.name === "string" ? norm(o.name).slice(0, 24) : "";
              return { name, items: strList(o.items) };
            })
            .filter((s) => s.name && s.items.length > 0)
            .slice(0, 4)
        : [];
      const result: DictationResult = {
        task: strList(raw.task),
        belonging: strList(raw.belonging),
        sections,
        failures: strList(raw.failures),
      };
      if (
        result.task.length ||
        result.belonging.length ||
        result.sections.length ||
        result.failures.length
      ) {
        return result;
      }
    } catch (err) {
      console.error("[splitDictationIntoList] OpenAI 失敗", err);
    }
  }
  return fallback(trimmed);
}
