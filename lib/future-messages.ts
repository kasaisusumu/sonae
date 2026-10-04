import OpenAI from "openai";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma";
import { stripSonaeBlock } from "@/lib/description";
import { sendPushToUser } from "@/lib/push";

const MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";

// ── JSON 配列ヘルパー（FutureMessage の keywords/genres/categoryIds は
//   既存 schema の他モデル―EventFeature.keywords 等―に合わせて JSON 文字列で持つ）──

export function parseStrArray(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const a = JSON.parse(raw);
    return Array.isArray(a)
      ? [...new Set(a.map((x) => String(x).trim()).filter(Boolean))]
      : [];
  } catch {
    return [];
  }
}
export function stringifyStrArray(arr: string[]): string {
  return JSON.stringify([...new Set(arr.map((x) => x.trim()).filter(Boolean))]);
}

export interface GenreKeywordEntry {
  genre: string;
  terms: string[];
}
export function parseGenreKeywords(
  raw: string | null | undefined,
): GenreKeywordEntry[] {
  if (!raw) return [];
  try {
    const a = JSON.parse(raw);
    if (!Array.isArray(a)) return [];
    return a
      .map((x) => {
        const o = (x ?? {}) as { genre?: unknown; terms?: unknown };
        const genre = typeof o.genre === "string" ? o.genre.trim() : "";
        const terms = Array.isArray(o.terms)
          ? [...new Set(o.terms.map((t) => String(t).trim()).filter(Boolean))]
          : [];
        return { genre, terms };
      })
      .filter((x) => x.genre);
  } catch {
    return [];
  }
}
export function stringifyGenreKeywords(entries: GenreKeywordEntry[]): string {
  return JSON.stringify(
    entries
      .map((e) => ({ genre: e.genre.trim(), terms: e.terms.filter(Boolean) }))
      .filter((e) => e.genre),
  );
}

// ── テキスト正規化（NFKC・大文字小文字・ひらがな/カタカナ同一視）──

function toHiragana(s: string): string {
  return s.replace(/[ァ-ヶ]/g, (c) =>
    String.fromCharCode(c.charCodeAt(0) - 0x60),
  );
}
export function normalizeMatchText(s: string): string {
  return toHiragana(s.normalize("NFKC").toLowerCase());
}
function includesNorm(haystack: string, needle: string): boolean {
  const n = needle.trim();
  if (!n) return false;
  return normalizeMatchText(haystack).includes(normalizeMatchText(n));
}

/** 一致判定の対象テキスト（予定タイトル＋説明欄の元メモ。自アプリのブロックは除く＝自己一致防止）。 */
function matchTextOf(event: { title: string; memo?: string | null }): string {
  return `${event.title}\n${stripSonaeBlock(event.memo)}`;
}

// ── 型 ──

export type MatchedBy =
  | "keyword"
  | "genre_keyword"
  | "category"
  | "genre_ai"
  | "similar_ai"
  | "manual";

export interface FutureMessageRow {
  id: string;
  body: string;
  keywords: string[];
  genres: string[];
  genreKeywords: GenreKeywordEntry[];
  categoryIds: string[];
  scope: string;
  archivedAt: Date | null;
  contextSummary: string | null;
  sourceEventTitle: string | null;
  confirmedCount: number;
  lastConfirmedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

function toRow(m: {
  id: string;
  body: string;
  keywords: string;
  genres: string;
  genreKeywords: string;
  categoryIds: string;
  scope: string;
  archivedAt: Date | null;
  contextSummary: string | null;
  sourceEventTitle: string | null;
  confirmedCount: number;
  lastConfirmedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}): FutureMessageRow {
  return {
    id: m.id,
    body: m.body,
    keywords: parseStrArray(m.keywords),
    genres: parseStrArray(m.genres),
    genreKeywords: parseGenreKeywords(m.genreKeywords),
    categoryIds: parseStrArray(m.categoryIds),
    scope: m.scope,
    archivedAt: m.archivedAt,
    contextSummary: m.contextSummary,
    sourceEventTitle: m.sourceEventTitle,
    confirmedCount: m.confirmedCount,
    lastConfirmedAt: m.lastConfirmedAt,
    createdAt: m.createdAt,
    updatedAt: m.updatedAt,
  };
}

// ── ジャンル → 関連語の AI 展開（保存時に一度だけ）──

const GENRE_SYSTEM = `あなたは日本語アシスタントです。ユーザーが指定した「〇〇系」という
予定のジャンルから、同じ種類の予定のタイトルに出てきそうな関連語を展開します。
- 元のジャンル語そのもの（「系」を除いた形）も含めてよい。
- 6〜12個程度、短い日本語の単語で。
- 出力は必ず次の JSON のみ: {"terms":["...", "..."]}`;

async function expandOneGenre(genre: string): Promise<string[]> {
  const base = genre.replace(/系$|関連$/, "").trim() || genre;
  if (!process.env.OPENAI_API_KEY) return [base];
  try {
    const client = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
      timeout: 12000,
      maxRetries: 0,
    });
    const completion = await client.chat.completions.create({
      model: MODEL,
      temperature: 0.3,
      max_tokens: 200,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: GENRE_SYSTEM },
        { role: "user", content: `ジャンル: ${genre}` },
      ],
    });
    const raw = JSON.parse(completion.choices[0]?.message?.content ?? "{}") as {
      terms?: unknown;
    };
    const terms = Array.isArray(raw.terms)
      ? [...new Set(raw.terms.map((t) => String(t).trim()).filter(Boolean))].slice(
          0,
          12,
        )
      : [];
    return terms.length > 0 ? [...new Set([base, ...terms])] : [base];
  } catch (e) {
    console.error("[future-messages] expandOneGenre 失敗", e);
    return [base];
  }
}

/** ジャンルの配列から genreKeywords（関連語）を作る。既存分は保持し、新しいジャンルだけ展開する。 */
export async function expandGenreKeywords(
  genres: string[],
  existing: GenreKeywordEntry[],
): Promise<GenreKeywordEntry[]> {
  const byGenre = new Map(existing.map((e) => [e.genre, e]));
  const out: GenreKeywordEntry[] = [];
  for (const g of genres) {
    const g2 = g.trim();
    if (!g2) continue;
    const prev = byGenre.get(g2);
    if (prev) {
      out.push(prev);
      continue;
    }
    const terms = await expandOneGenre(g2);
    out.push({ genre: g2, terms });
  }
  return out;
}

// ── CRUD ──

export async function listFutureMessages(userId: string) {
  const [rows, links] = await Promise.all([
    prisma.futureMessage.findMany({
      where: { userId },
      orderBy: [{ archivedAt: "asc" }, { updatedAt: "desc" }],
    }),
    prisma.eventFutureMessage.findMany({
      where: { userId, status: "shown" },
      select: {
        messageId: true,
        eventId: true,
        event: { select: { title: true, eventDatetime: true, endDatetime: true } },
      },
    }),
  ]);
  const upcomingByMessage = new Map<
    string,
    { eventId: string; title: string; eventDatetime: Date }[]
  >();
  const now = new Date();
  for (const l of links) {
    if (!l.event) continue;
    const ended = (l.event.endDatetime ?? l.event.eventDatetime) <= now;
    if (ended) continue;
    const arr = upcomingByMessage.get(l.messageId) ?? [];
    arr.push({
      eventId: l.eventId,
      title: l.event.title,
      eventDatetime: l.event.eventDatetime,
    });
    upcomingByMessage.set(l.messageId, arr);
  }
  return rows.map((r) => ({
    ...toRow(r),
    upcomingEvents: upcomingByMessage.get(r.id) ?? [],
  }));
}

export async function createFutureMessage(
  userId: string,
  input: {
    body: string;
    keywords?: string[];
    genres?: string[];
    categoryIds?: string[];
    scope?: string;
    sourceEventTitle?: string | null;
    sourceCategoryId?: string | null;
    contextSummary?: string | null;
  },
): Promise<string | null> {
  const body = input.body.trim().slice(0, 2000);
  if (!body) return null;
  const genres = (input.genres ?? []).slice(0, 5);
  const genreKeywords = await expandGenreKeywords(genres, []);
  const created = await prisma.futureMessage.create({
    data: {
      userId,
      body,
      keywords: stringifyStrArray(input.keywords ?? []),
      genres: stringifyStrArray(genres),
      genreKeywords: stringifyGenreKeywords(genreKeywords),
      categoryIds: stringifyStrArray(input.categoryIds ?? []),
      scope: input.scope === "similar" || input.scope === "once" ? input.scope : "keyword",
      sourceEventTitle: input.sourceEventTitle ?? null,
      sourceCategoryId: input.sourceCategoryId ?? null,
      contextSummary: input.contextSummary ?? null,
    },
  });
  return created.id;
}

export async function updateFutureMessage(
  userId: string,
  id: string,
  patch: {
    body?: string;
    keywords?: string[];
    genres?: string[];
    categoryIds?: string[];
    scope?: string;
    archived?: boolean;
  },
): Promise<boolean> {
  const existing = await prisma.futureMessage.findFirst({ where: { id, userId } });
  if (!existing) return false;

  const data: Record<string, unknown> = {};
  if (patch.body !== undefined) {
    const b = patch.body.trim().slice(0, 2000);
    if (b) data.body = b;
  }
  if (patch.keywords !== undefined) {
    data.keywords = stringifyStrArray(patch.keywords);
  }
  if (patch.genres !== undefined) {
    const genres = patch.genres.slice(0, 5);
    const genreKeywords = await expandGenreKeywords(
      genres,
      parseGenreKeywords(existing.genreKeywords),
    );
    data.genres = stringifyStrArray(genres);
    data.genreKeywords = stringifyGenreKeywords(genreKeywords);
  }
  if (patch.categoryIds !== undefined) {
    data.categoryIds = stringifyStrArray(patch.categoryIds);
  }
  if (patch.scope !== undefined) {
    data.scope =
      patch.scope === "similar" || patch.scope === "once" ? patch.scope : "keyword";
  }
  if (patch.archived !== undefined) {
    data.archivedAt = patch.archived ? new Date() : null;
  }
  if (Object.keys(data).length === 0) return true;

  await prisma.futureMessage.update({ where: { id }, data });

  // 条件を変えても、すでに出している予定からは外さない（ユーザーの目の前で
  // 行が消える体験を避ける方針）。今後の一致にだけ反映する。
  if (patch.keywords !== undefined || patch.genres !== undefined || patch.categoryIds !== undefined) {
    await rematchMessageAgainstUpcomingEvents(userId, id);
  }
  return true;
}

export async function deleteFutureMessage(userId: string, id: string): Promise<void> {
  await prisma.futureMessage.deleteMany({ where: { id, userId } });
}

// ── 予定 × メッセージ の一致判定 ──

const FUTURE_MATCH_LIMIT_MS = 1000 * 60 * 60 * 24 * 120; // 先 120 日まで（sync.ts の取り込み窓と揃える）

function cheapMatch(
  m: FutureMessageRow,
  text: string,
  categoryId: string | null,
): { matchedBy: MatchedBy; matchReason: string } | null {
  for (const kw of m.keywords) {
    if (includesNorm(text, kw)) {
      return { matchedBy: "keyword", matchReason: `キーワード「${kw}」に一致` };
    }
  }
  for (const g of m.genreKeywords) {
    for (const term of g.terms) {
      if (includesNorm(text, term)) {
        return {
          matchedBy: "genre_keyword",
          matchReason: `ジャンル「${g.genre}」の関連語「${term}」に一致`,
        };
      }
    }
  }
  if (categoryId && m.categoryIds.includes(categoryId)) {
    return { matchedBy: "category", matchReason: "指定したカテゴリの予定" };
  }
  return null;
}

interface EventForMatch {
  id: string;
  userId: string;
  title: string;
  memo: string | null;
  categoryId: string | null;
  eventDatetime: Date;
  endDatetime: Date | null;
}

interface NewLink {
  eventId: string;
  eventTitle: string;
  messageId: string;
  matchedBy: MatchedBy;
  matchReason: string;
  genres: string[];
}

async function upsertLink(
  event: EventForMatch,
  messageId: string,
  matchedBy: MatchedBy,
  matchReason: string,
  genres: string[] = [],
): Promise<NewLink | null> {
  const existing = await prisma.eventFutureMessage.findUnique({
    where: { eventId_messageId: { eventId: event.id, messageId } },
  });
  // 一度「この予定から外した」ものは、同じ条件のままなら再結びつけしない
  // （ユーザーが明示的に外した判断を尊重する）。
  if (existing) return null;
  await prisma.eventFutureMessage.create({
    data: {
      eventId: event.id,
      messageId,
      userId: event.userId,
      status: "shown",
      matchedBy,
      matchReason,
    },
  });
  return { eventId: event.id, eventTitle: event.title, messageId, matchedBy, matchReason, genres };
}

/** 一致時のプッシュ（1予定1メッセージにつき1回）。matchedBy に応じて文面を変える。 */
async function notifyNewLinks(userId: string, links: NewLink[]): Promise<void> {
  if (links.length === 0) return;
  await Promise.all(
    links.map((l) => {
      const body =
        l.matchedBy === "genre_ai" || l.matchedBy === "genre_keyword"
          ? `「${l.genres[0] ?? "その種類"}」の予定のため、メッセージがあります`
          : l.matchedBy === "similar_ai"
            ? "似た予定だったため、メッセージがあります"
            : `「${l.eventTitle}」に、未来の自分からのメッセージがあります`;
      return sendPushToUser(userId, {
        title: "未来の自分へのメッセージ",
        body,
        url: `/events/${l.eventId}`,
        tag: `futuremsg-${l.eventId}`,
      });
    }),
  );
}

/** AI（ジャンル／似た予定）の判定。安価な判定で当たらなかった候補だけに絞って1回で聞く。 */
async function aiJudgeMessages(
  event: EventForMatch,
  candidates: FutureMessageRow[],
): Promise<Map<string, { matchedBy: MatchedBy; matchReason: string }>> {
  const out = new Map<string, { matchedBy: MatchedBy; matchReason: string }>();
  if (candidates.length === 0 || !process.env.OPENAI_API_KEY) return out;

  const list = candidates.slice(0, 8).map((m, i) => ({
    idx: i,
    genres: m.genres,
    scope: m.scope,
    contextSummary: m.contextSummary,
    sourceEventTitle: m.sourceEventTitle,
  }));
  const system = `あなたは、予定のタイトルが「未来の自分へのメッセージ」の対象になるか
判定するアシスタントです。各候補は次のどちらかの根拠を持ちます:
- genres（ジャンル）: 予定がそのジャンルに当てはまるか
- scope="similar" の場合、contextSummary/sourceEventTitle と同じ種類の予定か
確信が持てるものだけ true にしてください（迷ったら false）。
出力は必ず次の JSON のみ:
{"matches":[{"idx":0,"match":true,"reason":"短い日本語の理由"}, ...]}
（該当しない候補は matches に含めなくてよい）`;
  try {
    const client = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
      timeout: 12000,
      maxRetries: 0,
    });
    const completion = await client.chat.completions.create({
      model: MODEL,
      temperature: 0,
      max_tokens: 400,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: system },
        {
          role: "user",
          content: `予定タイトル: ${event.title}\n候補:\n${JSON.stringify(list)}`,
        },
      ],
    });
    const raw = JSON.parse(completion.choices[0]?.message?.content ?? "{}") as {
      matches?: { idx?: unknown; match?: unknown; reason?: unknown }[];
    };
    for (const m of raw.matches ?? []) {
      const idx = typeof m.idx === "number" ? m.idx : -1;
      if (m.match !== true || idx < 0 || idx >= candidates.length) continue;
      const cand = candidates[idx];
      const byGenre = cand.genres.length > 0;
      const reason =
        typeof m.reason === "string" && m.reason.trim()
          ? m.reason.trim().slice(0, 80)
          : byGenre
            ? `AIがジャンル「${cand.genres[0]}」に一致すると判断`
            : "AIが似た予定と判断";
      out.set(cand.id, {
        matchedBy: byGenre ? "genre_ai" : "similar_ai",
        matchReason: reason,
      });
    }
  } catch (e) {
    console.error("[future-messages] aiJudgeMessages 失敗", e);
  }
  return out;
}

/**
 * 予定 1 件に対して、未来の自分へのメッセージを一致判定して結びつける（冪等）。
 * - キーワード／ジャンル関連語／カテゴリは毎回試す（安価）。
 * - AI（ジャンル・似た予定）は `allowAi` かつ `futureMessageCheckedAt` が未設定の
 *   ときだけ、候補を絞って 1 回だけ試す（同じ予定で何度も呼び直さない）。
 * 新しく結びついたメッセージ数を返す。
 */
export async function ensureFutureMessageMatchesForEvent(
  eventId: string,
  opts: { allowAi?: boolean; notify?: boolean } = {},
): Promise<number> {
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    select: {
      id: true,
      userId: true,
      title: true,
      memo: true,
      categoryId: true,
      eventDatetime: true,
      endDatetime: true,
      futureMessageCheckedAt: true,
    },
  });
  if (!event) return 0;
  // 過去（終了済み）の予定には新規に結びつけない。
  const ended = (event.endDatetime ?? event.eventDatetime) <= new Date();
  if (ended) return 0;
  const withinWindow =
    event.eventDatetime.getTime() - Date.now() <= FUTURE_MATCH_LIMIT_MS;
  if (!withinWindow) return 0;

  const rows = await prisma.futureMessage.findMany({
    where: { userId: event.userId, archivedAt: null },
  });
  if (rows.length === 0) return 0;
  const messages = rows.map(toRow);
  const text = matchTextOf(event);

  const newLinks: NewLink[] = [];
  const stillNoMatch: FutureMessageRow[] = [];
  for (const m of messages) {
    const hit = cheapMatch(m, text, event.categoryId);
    if (hit) {
      const link = await upsertLink(event, m.id, hit.matchedBy, hit.matchReason, m.genres);
      if (link) newLinks.push(link);
    } else {
      stillNoMatch.push(m);
    }
  }

  if (opts.allowAi && !event.futureMessageCheckedAt && stillNoMatch.length > 0) {
    // AI 候補は「ジャンル指定あり」または「scope=similar」のものだけに絞る
    // （事前フィルタ。それ以外は AI に聞くまでもない）。
    const candidates = stillNoMatch.filter(
      (m) => m.genres.length > 0 || m.scope === "similar",
    );
    if (candidates.length > 0) {
      const judged = await aiJudgeMessages(event, candidates);
      for (const [messageId, hit] of judged) {
        const m = candidates.find((c) => c.id === messageId);
        const link = await upsertLink(event, messageId, hit.matchedBy, hit.matchReason, m?.genres ?? []);
        if (link) newLinks.push(link);
      }
    }
    await prisma.event.update({
      where: { id: event.id },
      data: { futureMessageCheckedAt: new Date() },
    });
  }

  if (opts.notify !== false) await notifyNewLinks(event.userId, newLinks);
  return newLinks.length;
}

/** メッセージの条件を変えたとき、今後の（まだ先の）予定にだけ新たに一致させる。 */
async function rematchMessageAgainstUpcomingEvents(
  userId: string,
  messageId: string,
): Promise<void> {
  const message = await prisma.futureMessage.findUnique({ where: { id: messageId } });
  if (!message || message.archivedAt) return;
  const row = toRow(message);

  const events = await prisma.event.findMany({
    where: {
      userId,
      eventDatetime: { gte: new Date(), lte: new Date(Date.now() + FUTURE_MATCH_LIMIT_MS) },
    },
    select: {
      id: true,
      userId: true,
      title: true,
      memo: true,
      categoryId: true,
      eventDatetime: true,
      endDatetime: true,
    },
    take: 300,
  });
  const newLinks: NewLink[] = [];
  for (const ev of events) {
    const hit = cheapMatch(row, matchTextOf(ev), ev.categoryId);
    if (hit) {
      const link = await upsertLink(ev, messageId, hit.matchedBy, hit.matchReason, row.genres);
      if (link) newLinks.push(link);
    }
  }
  await notifyNewLinks(userId, newLinks);
}

// ── 予定詳細ページ用の取得・操作 ──

export interface EventMessageRow {
  id: string; // EventFutureMessage.id
  eventId: string;
  messageId: string;
  body: string;
  keywords: string[];
  genres: string[];
  categoryIds: string[];
  scope: string;
  /** shown=これから出す / confirmed=予定後に確定済み / skipped=今回は更新しなかった */
  status: string;
  matchedBy: MatchedBy;
  matchReason: string | null;
  confirmedCount: number;
  eventTitle: string;
  /** 予定が済んでいるか（振り返りを開けるかの判定。pendingMessageReviewWhere と同じ意味）。 */
  eventEnded: boolean;
}

export interface EventInfoForMessage {
  id: string;
  title: string;
  endDatetime: Date | null;
  eventDatetime: Date;
}

/** 予定が済んでいるか（終了日時、無ければ開始日時を過ぎたら済み）。pendingMessageReviewWhere と同じ条件。 */
export function isEventEnded(ev: EventInfoForMessage, now: Date = new Date()): boolean {
  return (ev.endDatetime ?? ev.eventDatetime) <= now;
}

/** 予定に結びついたメッセージ（予定詳細・学習内容の両方で編集できるよう、確定後・スキップ後も含める）。 */
export const LINKED_MESSAGE_STATUSES = ["shown", "confirmed", "skipped"] as const;

export function toEventMessageRow(
  l: {
    id: string;
    status: string;
    matchedBy: string;
    matchReason: string | null;
    message: Parameters<typeof toRow>[0];
  },
  ev: EventInfoForMessage,
  now: Date = new Date(),
): EventMessageRow {
  const m = toRow(l.message);
  return {
    id: l.id,
    eventId: ev.id,
    eventTitle: ev.title,
    eventEnded: isEventEnded(ev, now),
    messageId: m.id,
    body: m.body,
    keywords: m.keywords,
    genres: m.genres,
    categoryIds: m.categoryIds,
    scope: m.scope,
    status: l.status,
    matchedBy: l.matchedBy as MatchedBy,
    matchReason: l.matchReason,
    confirmedCount: m.confirmedCount,
  };
}

export async function getMessagesForEvent(
  eventId: string,
  userId: string,
): Promise<EventMessageRow[]> {
  const links = await prisma.eventFutureMessage.findMany({
    where: { eventId, userId, status: { in: [...LINKED_MESSAGE_STATUSES] } },
    include: {
      message: true,
      event: { select: { id: true, title: true, endDatetime: true, eventDatetime: true } },
    },
    orderBy: { createdAt: "asc" },
  });
  return links.map((l) => toEventMessageRow(l, l.event));
}

/** 予定詳細の「＋ 追加」＝新規メッセージを作って、この予定にも結びつける。 */
export async function createMessageForEvent(
  eventId: string,
  userId: string,
  input: { body: string; keywords?: string[]; genres?: string[] },
): Promise<string | null> {
  const event = await prisma.event.findFirst({ where: { id: eventId, userId } });
  if (!event) return null;
  const id = await createFutureMessage(userId, {
    body: input.body,
    keywords: input.keywords,
    genres: input.genres,
    sourceEventTitle: event.title,
    sourceCategoryId: event.categoryId,
  });
  if (!id) return null;
  await upsertLink(
    { ...event, endDatetime: event.endDatetime },
    id,
    "manual",
    "この予定で作成",
  );
  return id;
}

/** ✕ この予定からだけ外す（メッセージ本体は残る。同じ条件では再結びつけしない）。 */
export async function removeMessageFromEvent(
  eventId: string,
  userId: string,
  messageId: string,
): Promise<void> {
  await prisma.eventFutureMessage.updateMany({
    where: { eventId, messageId, userId },
    data: { status: "removed" },
  });
}

// ── 予定後の確定待ち ──

export interface PendingReview {
  linkId: string;
  eventId: string;
  eventTitle: string;
  messageId: string;
  body: string;
  keywords: string[];
  genres: string[];
  categoryIds: string[];
  scope: string;
  matchReason: string | null;
}

/** 「結果を記録しよう」に出す条件。ナビのドット判定と必ず同じ意味に保つこと。 */
export function pendingMessageReviewWhere(
  userId: string,
  now: Date = new Date(),
): Prisma.EventFutureMessageWhereInput {
  return {
    userId,
    status: "shown",
    event: {
      OR: [
        { endDatetime: { lte: now } },
        { endDatetime: null, eventDatetime: { lte: now } },
      ],
    },
  };
}

function toPendingReview(l: {
  id: string;
  eventId: string;
  event: { title: string };
  message: Parameters<typeof toRow>[0];
  matchReason: string | null;
}): PendingReview {
  const m = toRow(l.message);
  return {
    linkId: l.id,
    eventId: l.eventId,
    eventTitle: l.event.title,
    messageId: m.id,
    body: m.body,
    keywords: m.keywords,
    genres: m.genres,
    categoryIds: m.categoryIds,
    scope: m.scope,
    matchReason: l.matchReason,
  };
}

export async function getPendingMessageReviews(userId: string): Promise<PendingReview[]> {
  const links = await prisma.eventFutureMessage.findMany({
    where: pendingMessageReviewWhere(userId),
    include: { message: true, event: { select: { title: true } } },
    orderBy: { createdAt: "asc" },
  });
  return links.map(toPendingReview);
}

/** 1 予定ぶんの確定待ち（同じ予定に複数のメッセージが結びついていることもある）。 */
export async function getPendingMessageReviewsForEvent(
  eventId: string,
  userId: string,
): Promise<PendingReview[]> {
  const links = await prisma.eventFutureMessage.findMany({
    where: { ...pendingMessageReviewWhere(userId), eventId },
    include: { message: true, event: { select: { title: true } } },
    orderBy: { createdAt: "asc" },
  });
  return links.map(toPendingReview);
}

// ── Google カレンダー説明欄に書く「未来の自分へ」の内容 ──

export async function getEventDescriptionMessages(eventId: string): Promise<string[]> {
  const links = await prisma.eventFutureMessage.findMany({
    where: { eventId, status: "shown" },
    include: { message: { select: { body: true } } },
    orderBy: { createdAt: "asc" },
  });
  return links.map((l) => l.message.body);
}

// ── 確定カードの操作（§2.6） ──

/** 「この内容で確定」／項目ごとの修正後に確定。final の内容で FutureMessage を更新する。 */
export async function confirmMessageReview(
  userId: string,
  linkId: string,
  final: {
    body: string;
    keywords: string[];
    genres: string[];
    categoryIds: string[];
    scope: string;
  },
): Promise<{ messageId: string; eventId: string } | null> {
  const link = await prisma.eventFutureMessage.findFirst({
    where: { id: linkId, userId },
    select: { messageId: true, eventId: true },
  });
  if (!link) return null;

  const genreKeywords = await expandGenreKeywords(
    final.genres.slice(0, 5),
    parseGenreKeywords(
      (await prisma.futureMessage.findUnique({ where: { id: link.messageId } }))
        ?.genreKeywords ?? "[]",
    ),
  );

  await prisma.$transaction([
    prisma.futureMessage.update({
      where: { id: link.messageId },
      data: {
        body: final.body.trim().slice(0, 2000),
        keywords: stringifyStrArray(final.keywords),
        genres: stringifyStrArray(final.genres),
        genreKeywords: stringifyGenreKeywords(genreKeywords),
        categoryIds: stringifyStrArray(final.categoryIds),
        scope:
          final.scope === "similar" || final.scope === "once" ? final.scope : "keyword",
        confirmedCount: { increment: 1 },
        lastConfirmedAt: new Date(),
        ...(final.scope === "once" ? { archivedAt: new Date() } : {}),
      },
    }),
    prisma.eventFutureMessage.update({
      where: { id: linkId },
      data: { status: "confirmed" },
    }),
  ]);
  return link;
}

/** 振り返りカードの提案（AI）を作るための、現在の値と予定の情報。自分のリンクだけ返す。 */
export async function getLinkForReview(userId: string, linkId: string) {
  const link = await prisma.eventFutureMessage.findFirst({
    where: { id: linkId, userId },
    include: {
      message: true,
      event: { select: { title: true, memo: true, categoryId: true } },
    },
  });
  if (!link) return null;
  const m = toRow(link.message);
  return {
    eventTitle: link.event.title,
    eventMemo: link.event.memo,
    categoryId: link.event.categoryId,
    current: {
      body: m.body,
      keywords: m.keywords,
      genres: m.genres,
      categoryIds: m.categoryIds,
      scope: m.scope,
    },
  };
}

/** 「今回は更新しない」。scope は変えない。 */
export async function skipMessageReview(userId: string, linkId: string): Promise<void> {
  await prisma.eventFutureMessage.updateMany({
    where: { id: linkId, userId },
    data: { status: "skipped" },
  });
}

// ── 予定後の「メッセージを更新しませんか？」通知 ──

/**
 * 終わった予定で、確定待ち（status="shown"）のメッセージが残っているものにだけ、
 * 「メッセージを更新しませんか？」を1回送る（1予定1回。cron から呼ぶ）。
 */
export async function notifyPendingMessageReviews(
  userId: string,
  limit = 5,
): Promise<number> {
  const now = new Date();
  const horizon = new Date(now.getTime() - 48 * 3_600_000);

  const events = await prisma.event.findMany({
    where: {
      userId,
      messageReviewNotifiedAt: null,
      eventDatetime: { lte: now, gte: horizon },
      futureMessageLinks: { some: { status: "shown" } },
    },
    orderBy: { eventDatetime: "desc" },
    take: limit,
    select: { id: true, title: true, recurringEventId: true },
  });
  if (events.length === 0) return 0;

  let sent = 0;
  const notifiedSeries = new Set<string>();
  for (const e of events) {
    await prisma.event.update({
      where: { id: e.id },
      data: { messageReviewNotifiedAt: now },
    });
    const seriesKey = e.recurringEventId ?? "";
    if (seriesKey && notifiedSeries.has(seriesKey)) continue;
    if (seriesKey) notifiedSeries.add(seriesKey);

    await sendPushToUser(userId, {
      title: `${e.title}のメッセージを更新しませんか？`,
      body: "次の似た予定に向けて、内容を見直しましょう。タップして確認できます。",
      url: `/failures#review`,
      tag: `msgreview-${e.id}`,
    });
    sent++;
  }
  return sent;
}
