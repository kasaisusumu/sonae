import OpenAI from "openai";
import type { GeneratedItem } from "@/lib/learning";

export interface GenerateInput {
  title: string;
  categoryName: string;
  eventDatetime: Date;
  memo?: string | null;
  isOverseas?: boolean | null;
  durationNights?: number | null;
}

export interface GeneratedBase {
  tasks: GeneratedItem[];
  belongings: GeneratedItem[];
  source: "openai" | "template";
}

const MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";

const SYSTEM_PROMPT = `あなたは、段取りが苦手な人（ADHD傾向）の準備をやさしく支える日本語のアシスタントです。
予定の情報から「準備すること(tasks)」と「持ち物(belongings)」を分けて作ります。

ルール:
- tasks は 3〜6 個。行動を1つずつ。「〜を確認する」「〜を予約する」のように動詞で終える短い文。
- belongings は 2〜6 個。物の名前だけの短い名詞（例「充電器」「保険証」「折りたたみ傘」）。行動は書かない。
- timing は準備を始める目安。「1週間前」「3日前」「前日夜」「当日朝」「出発1時間前」など短いラベル。belongings の timing は「前日夜」「当日朝」中心。
- 予定の性質（海外/国内・宿泊数）に合った内容にする。推測が過ぎる項目は入れない。多すぎない。
- 責める・急かす表現は使わない。
- 出力は必ず次の JSON のみ:
  {"tasks":[{"title":"...","timing":"..."}],"belongings":[{"title":"...","timing":"..."}]}`;

function buildUserPrompt(input: GenerateInput): string {
  const dt = input.eventDatetime.toLocaleString("ja-JP", {
    dateStyle: "full",
    timeStyle: "short",
  });
  const lines = [
    `予定タイトル: ${input.title}`,
    `カテゴリ: ${input.categoryName}`,
    `予定日時: ${dt}`,
  ];
  if (input.memo) lines.push(`メモ: ${input.memo}`);
  if (input.isOverseas === true) {
    lines.push("これは海外の予定です（パスポート・ビザ・両替・海外通信などが関係しうる）。");
  } else if (input.isOverseas === false) {
    lines.push("これは国内の予定です（海外特有の準備は不要）。");
  }
  if (typeof input.durationNights === "number") {
    lines.push(
      input.durationNights <= 0
        ? "これは日帰りの予定です（宿泊関連の準備・持ち物は不要）。"
        : `これは ${input.durationNights} 泊の予定です。`,
    );
  }
  return lines.join("\n");
}

interface RawItem {
  title?: unknown;
  timing?: unknown;
}

function coerce(arr: unknown, cap: number): GeneratedItem[] {
  const list = Array.isArray(arr) ? (arr as RawItem[]) : [];
  return list
    .map((it) => ({
      title: typeof it.title === "string" ? it.title.trim() : "",
      timingLabel:
        typeof it.timing === "string" && it.timing.trim() ? it.timing.trim() : null,
    }))
    .filter((it) => it.title.length > 0)
    .slice(0, cap);
}

interface Templates {
  tasks: GeneratedItem[];
  belongings: GeneratedItem[];
}

// OpenAI キー未設定でもデモできるよう、カテゴリ別の最低限テンプレート。
function fallback(input: GenerateInput): Templates {
  const base: Record<string, Templates> = {
    "旅行・出張": {
      tasks: [
        { title: "行程と宿泊先を確認する", timingLabel: "1週間前" },
        { title: "交通機関のチケットを予約・確認する", timingLabel: "1週間前" },
        { title: "持ち物リストを作る", timingLabel: "3日前" },
        { title: "家の戸締まりと家電の電源を確認する", timingLabel: "当日朝" },
      ],
      belongings: [
        { title: "着替え", timingLabel: "前日夜" },
        { title: "洗面用具", timingLabel: "前日夜" },
        { title: "充電器・モバイルバッテリー", timingLabel: "前日夜" },
        { title: "常備薬", timingLabel: "前日夜" },
      ],
    },
    通院: {
      tasks: [
        { title: "予約日時と受付時間を確認する", timingLabel: "前日" },
        { title: "症状や聞きたいことをメモにまとめる", timingLabel: "前日夜" },
      ],
      belongings: [
        { title: "診察券", timingLabel: "前日夜" },
        { title: "保険証", timingLabel: "前日夜" },
        { title: "お薬手帳", timingLabel: "前日夜" },
        { title: "現金（受診料）", timingLabel: "当日朝" },
      ],
    },
    来客対応: {
      tasks: [
        { title: "来客の人数・時間・目的を確認する", timingLabel: "前日" },
        { title: "部屋を片付け、席を用意する", timingLabel: "前日夜" },
        { title: "開始30分前に最終確認をする", timingLabel: "30分前" },
      ],
      belongings: [
        { title: "お茶・飲み物", timingLabel: "当日朝" },
        { title: "お茶菓子", timingLabel: "当日朝" },
      ],
    },
    "契約・手続き": {
      tasks: [
        { title: "必要書類の一覧を確認する", timingLabel: "1週間前" },
        { title: "記入が必要な書類を先に埋めておく", timingLabel: "前日夜" },
        { title: "窓口の受付時間と場所を確認する", timingLabel: "前日夜" },
      ],
      belongings: [
        { title: "本人確認書類", timingLabel: "前日夜" },
        { title: "印鑑", timingLabel: "前日夜" },
        { title: "手数料の現金", timingLabel: "当日朝" },
      ],
    },
  };
  return (
    base[input.categoryName] ?? {
      tasks: [
        { title: "場所・時間・相手を確認する", timingLabel: "前日" },
        { title: "当日の朝に最終確認をする", timingLabel: "当日朝" },
      ],
      belongings: [
        { title: "スマホ・財布・鍵", timingLabel: "当日朝" },
        { title: "必要な資料", timingLabel: "前日夜" },
      ],
    }
  );
}

/** 一般的な準備リスト（準備すること＋持ち物）を生成。学習は注入しない。 */
export async function generateBaseChecklist(
  input: GenerateInput,
): Promise<GeneratedBase> {
  if (process.env.OPENAI_API_KEY) {
    try {
      const client = new OpenAI({
        apiKey: process.env.OPENAI_API_KEY,
        timeout: 20000,
        maxRetries: 1,
      });
      const completion = await client.chat.completions.create({
        model: MODEL,
        temperature: 0.4,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: buildUserPrompt(input) },
        ],
      });
      const raw = JSON.parse(completion.choices[0]?.message?.content ?? "{}") as {
        tasks?: unknown;
        belongings?: unknown;
        items?: unknown;
      };
      const tasks = coerce(raw.tasks ?? raw.items, 8);
      const belongings = coerce(raw.belongings, 8);
      if (tasks.length > 0) {
        return { tasks, belongings, source: "openai" };
      }
    } catch (err) {
      console.error("[generate] OpenAI 生成に失敗、テンプレートにフォールバック:", err);
    }
  }
  const t = fallback(input);
  return { tasks: t.tasks, belongings: t.belongings, source: "template" };
}
