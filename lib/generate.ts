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

const MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";

const SYSTEM_PROMPT = `あなたは、段取りが苦手な人（ADHD傾向）の準備をやさしく支える日本語のアシスタントです。
予定の情報から、その予定に向けて必要な「準備タスク」のチェックリストを作ります。

ルール:
- 3〜7 個。多すぎると圧になるので絞る。一般的で確実に役立つものだけ。
- 各タスクは具体的な行動 1 つ。「〜を確認する」「〜を準備する」「〜を予約する」のように動詞で終える短い文。
- timing は準備を始める目安。「1週間前」「3日前」「前日夜」「当日朝」「出発1時間前」など短いラベル。
- 責める表現・急かす表現は使わない。淡々と、実行しやすい粒度で。
- 与えられた予定の性質（海外/国内、宿泊数など）に合った内容にする。推測が過ぎる項目は入れない。
- 出力は必ず次の JSON のみ: {"items":[{"title":"...","timing":"..."}]}`;

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
        ? "これは日帰りの予定です（宿泊関連の準備は不要）。"
        : `これは ${input.durationNights} 泊の予定です。`,
    );
  }
  return lines.join("\n");
}

interface RawItem {
  title?: unknown;
  timing?: unknown;
}

function coerceItems(raw: unknown): GeneratedItem[] {
  const arr =
    raw && typeof raw === "object" && Array.isArray((raw as { items?: unknown }).items)
      ? ((raw as { items: RawItem[] }).items)
      : [];
  return arr
    .map((it) => ({
      title: typeof it.title === "string" ? it.title.trim() : "",
      timingLabel:
        typeof it.timing === "string" && it.timing.trim() ? it.timing.trim() : null,
    }))
    .filter((it) => it.title.length > 0)
    .slice(0, 10);
}

// OpenAI キー未設定でもデモできるよう、カテゴリ別の最低限テンプレート。
function fallbackItems(input: GenerateInput): GeneratedItem[] {
  const base: Record<string, GeneratedItem[]> = {
    "旅行・出張": [
      { title: "行程と宿泊先を確認する", timingLabel: "1週間前" },
      { title: "交通機関のチケットを予約・確認する", timingLabel: "1週間前" },
      { title: "持ち物リストを作る", timingLabel: "3日前" },
      { title: "着替えと洗面用具をまとめる", timingLabel: "前日夜" },
      { title: "スマホと充電器・モバイルバッテリーを準備する", timingLabel: "前日夜" },
      { title: "家の戸締まりと家電の電源を確認する", timingLabel: "当日朝" },
    ],
    通院: [
      { title: "予約日時と診察券・保険証を確認する", timingLabel: "前日" },
      { title: "症状や聞きたいことをメモにまとめる", timingLabel: "前日夜" },
      { title: "お薬手帳と現在の薬を用意する", timingLabel: "前日夜" },
      { title: "受診料の現金を財布に入れる", timingLabel: "当日朝" },
      { title: "受付時間に間に合うよう出発する", timingLabel: "当日" },
    ],
    来客対応: [
      { title: "来客の人数・時間・目的を確認する", timingLabel: "前日" },
      { title: "部屋を片付け、必要な席を用意する", timingLabel: "前日夜" },
      { title: "お茶・お菓子など飲み物を準備する", timingLabel: "当日朝" },
      { title: "開始30分前に最終確認をする", timingLabel: "30分前" },
    ],
    "契約・手続き": [
      { title: "必要書類の一覧を確認する", timingLabel: "1週間前" },
      { title: "本人確認書類・印鑑を用意する", timingLabel: "前日" },
      { title: "記入が必要な書類を先に埋めておく", timingLabel: "前日夜" },
      { title: "手数料の現金を用意する", timingLabel: "当日朝" },
    ],
  };
  return (
    base[input.categoryName] ?? [
      { title: "この予定に必要な持ち物を書き出す", timingLabel: "3日前" },
      { title: "場所・時間・相手を確認する", timingLabel: "前日" },
      { title: "前日の夜に持ち物をまとめる", timingLabel: "前日夜" },
      { title: "当日の朝に最終確認をする", timingLabel: "当日朝" },
    ]
  );
}

/**
 * 一般的な準備リスト（ベース）を生成する。学習は一切注入しない。
 * OpenAI 失敗時はテンプレートにフォールバック。
 */
export async function generateBaseChecklist(
  input: GenerateInput,
): Promise<{ items: GeneratedItem[]; source: "openai" | "template" }> {
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
      const content = completion.choices[0]?.message?.content ?? "{}";
      const items = coerceItems(JSON.parse(content));
      if (items.length > 0) return { items, source: "openai" };
    } catch (err) {
      console.error("[generate] OpenAI 生成に失敗、テンプレートにフォールバック:", err);
    }
  }
  return { items: fallbackItems(input), source: "template" };
}
