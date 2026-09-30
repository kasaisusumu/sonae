import OpenAI from "openai";
import { prisma } from "@/lib/prisma";
import {
  parseStrArray,
  parseGenreKeywords,
  stringifyStrArray,
} from "@/lib/future-messages";

const MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";

/** メッセージ本体の編集可能な中身（確定カードの「最終結果」はこの形）。 */
export interface MessageFields {
  body: string;
  keywords: string[];
  genres: string[];
  categoryIds: string[];
  scope: string; // "keyword" | "similar" | "once"
}

export interface ProposalFields extends MessageFields {
  /** 各項目の根拠（平易な日本語・1行）。無い項目は省略可。 */
  reasons: Partial<
    Record<"body" | "keywords" | "genres" | "categoryIds" | "scope", string>
  >;
  /** 今回の予定から新しく作る価値のあるメッセージの提案（0〜2件）。 */
  newMessageSuggestions: { body: string; keywords: string[] }[];
}

function fieldsEqual(a: MessageFields, b: MessageFields): boolean {
  const norm = (arr: string[]) => [...arr].sort().join("|");
  return (
    a.body === b.body &&
    norm(a.keywords) === norm(b.keywords) &&
    norm(a.genres) === norm(b.genres) &&
    norm(a.categoryIds) === norm(b.categoryIds) &&
    a.scope === b.scope
  );
}

/** ユーザー自身の過去の「提案→最終」の実例（直近5件・差分の要点のみ）。他ユーザーは一切参照しない。 */
async function loadOwnPriorExamples(
  userId: string,
): Promise<{ fieldChanged: Record<string, boolean>; acceptedAsIs: boolean }[]> {
  const rows = await prisma.messageProposalRecord.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take: 5,
    select: { fieldChanged: true, acceptedAsIs: true },
  });
  return rows.map((r) => ({
    fieldChanged: (() => {
      try {
        return JSON.parse(r.fieldChanged) as Record<string, boolean>;
      } catch {
        return {};
      }
    })(),
    acceptedAsIs: r.acceptedAsIs,
  }));
}

/** 項目ごとの「そのまま確定した割合」。低いほど、その項目は毎回直されている＝提案は控えめに。 */
function acceptanceRateByField(
  examples: { fieldChanged: Record<string, boolean> }[],
): Record<string, number> {
  const fields = ["body", "keywords", "genres", "categoryIds", "scope"];
  const out: Record<string, number> = {};
  for (const f of fields) {
    if (examples.length === 0) {
      out[f] = 1;
      continue;
    }
    const changed = examples.filter((e) => e.fieldChanged[f]).length;
    out[f] = Number((1 - changed / examples.length).toFixed(2));
  }
  return out;
}

const SYSTEM = `あなたは「未来の自分へのメッセージ」アプリのアシスタントです。
終わった予定を振り返り、次回への引き継ぎとして残すメッセージの内容を提案します。

方針:
- 事実を捏造しない。予定のタイトル・メモ・既存のメッセージ本文だけから考える。
- 本文への追記は「〜を確認する」「〜の結果を聞く」のような、次回に向けた短い一文。
  追記する必要が無いと判断したら、既存の本文をそのまま返す（無理に足さない）。
- キーワード・ジャンルは、次回も同じ種類の予定に一致させるために有効そうなものだけ提案する。
- 迷ったら変更しない（既存の値をそのまま返す）。
- 出力は必ず次の JSON のみ:
{"body":"...","keywords":["..."],"genres":["..."],"categoryIds":["..."],
 "scope":"keyword|similar|once","reasons":{"body":"...","keywords":"...","genres":"...",
 "categoryIds":"...","scope":"..."},"newMessageSuggestions":[{"body":"...","keywords":["..."]}]}`;

/** 予定後の確定カード用の提案一式を作る（AI 未設定時は「変更なし」を返す）。 */
export async function buildMessageProposal(input: {
  userId: string;
  eventTitle: string;
  eventMemo: string | null;
  categoryId: string | null;
  current: {
    body: string;
    keywords: string[];
    genres: string[];
    categoryIds: string[];
    scope: string;
  };
}): Promise<ProposalFields> {
  const fallback: ProposalFields = {
    body: input.current.body,
    keywords: input.current.keywords,
    genres: input.current.genres,
    categoryIds: input.current.categoryIds,
    scope: input.current.scope,
    reasons: {},
    newMessageSuggestions: [],
  };
  if (!process.env.OPENAI_API_KEY) return fallback;

  const examples = await loadOwnPriorExamples(input.userId);
  const acceptance = acceptanceRateByField(examples);
  // 修正が続いている項目（そのまま確定率が低い）は、変更提案を控えめにする根拠として
  // プロンプトに渡す（強い指示にはせず、判断材料として渡すだけ）。
  const cautionNote = Object.entries(acceptance)
    .filter(([, rate]) => rate < 0.4)
    .map(([f]) => f)
    .join("、");

  try {
    const client = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
      timeout: 15000,
      maxRetries: 0,
    });
    const completion = await client.chat.completions.create({
      model: MODEL,
      temperature: 0.3,
      max_tokens: 500,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM },
        {
          role: "user",
          content: JSON.stringify({
            eventTitle: input.eventTitle,
            eventMemo: input.eventMemo ?? "",
            current: input.current,
            note: cautionNote
              ? `このユーザーは過去、${cautionNote} をよく修正しています。変更提案は特に慎重に。`
              : undefined,
          }),
        },
      ],
    });
    const raw = JSON.parse(completion.choices[0]?.message?.content ?? "{}") as {
      body?: unknown;
      keywords?: unknown;
      genres?: unknown;
      categoryIds?: unknown;
      scope?: unknown;
      reasons?: unknown;
      newMessageSuggestions?: unknown;
    };
    const strList = (v: unknown, cap = 10): string[] =>
      Array.isArray(v)
        ? [...new Set(v.map((x) => String(x).trim()).filter(Boolean))].slice(0, cap)
        : [];
    const scope =
      raw.scope === "similar" || raw.scope === "once" ? raw.scope : "keyword";
    const reasonsObj = (raw.reasons ?? {}) as Record<string, unknown>;
    const reasons: ProposalFields["reasons"] = {};
    for (const k of ["body", "keywords", "genres", "categoryIds", "scope"] as const) {
      const v = reasonsObj[k];
      if (typeof v === "string" && v.trim()) reasons[k] = v.trim().slice(0, 80);
    }
    const newMessageSuggestions = Array.isArray(raw.newMessageSuggestions)
      ? raw.newMessageSuggestions
          .map((s) => {
            const o = (s ?? {}) as { body?: unknown; keywords?: unknown };
            const body = typeof o.body === "string" ? o.body.trim().slice(0, 500) : "";
            return { body, keywords: strList(o.keywords, 5) };
          })
          .filter((s) => s.body)
          .slice(0, 2)
      : [];

    return {
      body:
        typeof raw.body === "string" && raw.body.trim()
          ? raw.body.trim().slice(0, 2000)
          : input.current.body,
      keywords: strList(raw.keywords),
      genres: strList(raw.genres, 5),
      categoryIds: strList(raw.categoryIds),
      scope,
      reasons,
      newMessageSuggestions,
    };
  } catch (e) {
    console.error("[message-proposal] buildMessageProposal 失敗", e);
    return fallback;
  }
}

/** 確定ボタンを押した時点で、提案と最終結果の差分を記録する（学習用）。 */
export async function recordProposalOutcome(input: {
  userId: string;
  messageId: string;
  eventId: string;
  proposed: ProposalFields;
  final: MessageFields;
}): Promise<void> {
  const fieldChanged = {
    body: input.proposed.body !== input.final.body,
    keywords:
      stringifyStrArray(input.proposed.keywords) !==
      stringifyStrArray(input.final.keywords),
    genres:
      stringifyStrArray(input.proposed.genres) !== stringifyStrArray(input.final.genres),
    categoryIds:
      stringifyStrArray(input.proposed.categoryIds) !==
      stringifyStrArray(input.final.categoryIds),
    scope: input.proposed.scope !== input.final.scope,
  };
  const acceptedAsIs = fieldsEqual(input.proposed, input.final);
  await prisma.messageProposalRecord.create({
    data: {
      userId: input.userId,
      messageId: input.messageId,
      eventId: input.eventId,
      proposed: JSON.stringify(input.proposed),
      final: JSON.stringify(input.final),
      fieldChanged: JSON.stringify(fieldChanged),
      acceptedAsIs,
    },
  });
}

export { parseStrArray, parseGenreKeywords };
