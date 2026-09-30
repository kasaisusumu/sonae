"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma";
import { clearSession, getSessionUserId } from "@/lib/session";
import { syncEventDescription } from "@/lib/description-sync";
import {
  getOrCreateCategory,
  resolveCategoryForEvent,
} from "@/lib/categories";
import { syncAndNotify } from "@/lib/sync";
import { sendPushToUser, isPushConfigured } from "@/lib/push";
import { ensureWatch, stopWatch } from "@/lib/google";
import {
  addSeedItemsToEvent,
  ensureChecklistForEvent,
  generateAndSaveChecklist,
  normTitle,
  primeNotifiedChecklists,
  propagateListToNameGroup,
  renameSectionKind,
  resolveNameGroupOnEdit,
  type SeedItem,
} from "@/lib/checklist";
import {
  recordEdit,
  confirmRule,
  contradictRule,
  type GeneratedItem,
} from "@/lib/learning";
import { extractEventFeature } from "@/lib/features";
import { parseLead, stringifyLeads } from "@/lib/lead-time";
import { parseBulkTitles } from "@/lib/bulk";
import { parseJstDateTimeLocal } from "@/lib/format";
import {
  ensureFutureMessageMatchesForEvent,
  createFutureMessage,
  updateFutureMessage,
  deleteFutureMessage,
  createMessageForEvent,
  removeMessageFromEvent,
  confirmMessageReview,
  skipMessageReview,
} from "@/lib/future-messages";
import {
  recordProposalOutcome,
  type ProposalFields as MessageProposalFields,
  type MessageFields,
} from "@/lib/message-proposal";
import { APP_NAME } from "@/lib/app-info";
import { trackEvent } from "@/lib/track";
import {
  isBuiltinSection,
  parseSectionOrder,
  sectionKeyFromLabel,
  stringifySectionOrder,
} from "@/lib/sections";

async function requireUserId(): Promise<string> {
  const userId = await getSessionUserId();
  if (!userId) redirect("/");
  return userId;
}

/**
 * クライアント側の機能利用・ⓘ・案内ポップアップの表示/スキップを記録する
 * （管理画面の利用状況分析用）。ログインしていなければ何もしない。失敗しても無視する
 * （UI 動作の途中に `void trackFeatureUse(...)` の形で呼ぶ想定。await/エラー処理は不要）。
 */
export async function trackFeatureUse(eventKey: string): Promise<void> {
  const userId = await getSessionUserId();
  if (!userId) return;
  await prisma.featureEvent.create({ data: { userId, eventKey } }).catch(() => {});
}

function parseYen(raw: FormDataEntryValue | null): number {
  const n = Math.round(Number(String(raw ?? "").replace(/[^\d.-]/g, "")));
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

/**
 * アプリで能動的に触った予定は、以後の自動管理（説明欄同期）の対象にし、
 * かつ「確認済み」扱いにする。編集した時点でリストには目を通しているので、
 * 「確認しました」を押していなくても未確認表示（アプリ・カレンダー説明欄）を消す。
 */
async function markAutoManaged(eventId: string) {
  await prisma.event.updateMany({
    where: { id: eventId, autoManaged: false },
    data: { autoManaged: true },
  });
  await prisma.event.updateMany({
    where: { id: eventId, listReviewedAt: null },
    data: { listReviewedAt: new Date() },
  });
}

/**
 * 何かを編集したら、影響しうる画面を「すべて」その場で再検証する。
 * 予定ページと学習ページ（/savings）・設定・カレンダー連携表示など、
 * どこを編集しても他方が即座に最新になるよう、ルート全体を revalidate する。
 * （ユーザー要望: ずれより即時同期を優先）
 */
function revalidateAppViews(eventId?: string) {
  // ルートレイアウト配下の全ページ（動的セグメント含む）＋クライアントのルーターキャッシュを無効化
  revalidatePath("/", "layout");
  // 個別の動的パスも明示（保険）
  if (eventId) revalidatePath(`/events/${eventId}`);
  revalidatePath("/events/[id]", "page");
}

export async function logout(): Promise<void> {
  await clearSession();
  redirect("/?loggedout=1");
}

/** Google 連携を解除する（トークンを削除）。予定データは残す。 */
export async function disconnectGoogle(): Promise<void> {
  const userId = await requireUserId();
  await stopWatch(userId).catch(() => {});
  await prisma.userGoogleAccount.deleteMany({ where: { userId } });
  revalidatePath("/settings");
  revalidatePath("/events");
}

/** 予定の説明欄への書き込みを無効にする（スコープはそのまま。フラグだけ落とす）。 */
export async function disableDescriptionWrite(): Promise<void> {
  const userId = await requireUserId();
  await prisma.userGoogleAccount.updateMany({
    where: { userId },
    data: { writeDescriptionEnabled: false },
  });
  revalidatePath("/settings");
}

/** 同期対象の Google カレンダーを切り替える。 */
export async function setCalendarId(formData: FormData): Promise<void> {
  const userId = await requireUserId();
  const calendarId = String(formData.get("calendarId") ?? "").trim();
  if (!calendarId) return;
  await prisma.userGoogleAccount.updateMany({
    where: { userId },
    data: { calendarId },
  });
  revalidatePath("/settings");
  revalidatePath("/events");
}

/** Google カレンダーから予定を取り込む（手動同期ボタン）。自動通知の watch も張り直す。 */
export async function syncCalendar(): Promise<void> {
  const userId = await requireUserId();
  const account = await prisma.userGoogleAccount.findUnique({ where: { userId } });
  if (!account) redirect("/settings");

  trackEvent(userId, "feature:calendar-manual-sync");
  await syncAndNotify(userId);
  await ensureWatch(userId).catch(() => {});

  revalidatePath("/events");
  revalidatePath("/");
  revalidatePath("/settings");
}

/**
 * アプリを開いている間の“生同期”。クライアントの <LiveSync> が
 * マウント時・タブ復帰時・数十秒おきに呼ぶ。
 * - Google からの差分をその場で取り込み（説明欄の直接編集も即反映）
 * - 新規予定があれば通知（webhook/cron を待たない）
 * - 生成(OpenAI)は回さない＝軽い。watch チャンネルの張り直しだけ after() で。
 * 変化があったときだけ changed:true を返し、呼び出し側が router.refresh() する。
 */
export async function pullCalendarChanges(): Promise<{ changed: boolean }> {
  const userId = await getSessionUserId();
  if (!userId) return { changed: false };
  const account = await prisma.userGoogleAccount.findUnique({
    where: { userId },
    select: { userId: true },
  });
  if (!account) return { changed: false };

  try {
    const result = await syncAndNotify(userId, {
      deferGeneration: true,
      skipAiCategory: true,
    });
    const changed =
      result.newEvents.length + result.updatedCount + result.deletedCount > 0;
    after(() => {
      void ensureWatch(userId).catch(() => {});
      // オフライン中にまとめて追加された予定なども、復帰時にここで一括で準備リストまで作る。
      // 対象は新規追加通知を出した予定だけ（既存予定は生成しない）。
      if (result.newEvents.length > 0) {
        void primeNotifiedChecklists(userId, 12).catch(() => {});
      }
    });
    if (changed) revalidateAppViews();
    return { changed };
  } catch (e) {
    console.error("[pullCalendarChanges] userId=%s", userId, e);
    return { changed: false };
  }
}

/** 手動で予定を登録し、準備リストを生成する。 */
export async function createManualEvent(formData: FormData): Promise<void> {
  const userId = await requireUserId();

  const title = String(formData.get("title") ?? "").trim();
  const datetimeRaw = String(formData.get("eventDatetime") ?? "").trim();
  const memo = String(formData.get("memo") ?? "").trim() || null;
  const categoryName = String(formData.get("categoryName") ?? "").trim();

  if (!title || !datetimeRaw) redirect("/events?error=missing");

  // datetime-local は「日本時間の壁時計」として解釈する（サーバーは UTC のため）
  const eventDatetime = parseJstDateTimeLocal(datetimeRaw);
  if (!eventDatetime) redirect("/events?error=missing");

  // カテゴリ未指定なら自動判定（キーワード→AIで新カテゴリも作られる）
  const category = categoryName
    ? await getOrCreateCategory(userId, categoryName)
    : await resolveCategoryForEvent(userId, title, memo);
  const event = await prisma.event.create({
    data: {
      userId,
      categoryId: category.id,
      title,
      eventDatetime,
      memo,
      source: "manual",
    },
  });

  await generateAndSaveChecklist(event.id);

  // 予定を入れて提案ができたら通知する（アプリを閉じていても届く）
  after(() =>
    sendPushToUser(userId, {
      title: "準備リストができました",
      body: `「${title}」の準備すること・持ち物を用意しました`,
      url: `/events/${event.id}`,
      tag: `event-${event.id}`,
    }).catch(() => {}),
  );

  revalidateAppViews(event.id);
  redirect(`/events/${event.id}`);
}

/** 予定のカテゴリを修正する。 */
export async function updateEventCategory(formData: FormData): Promise<void> {
  const userId = await requireUserId();
  const eventId = String(formData.get("eventId") ?? "");
  const categoryName = String(formData.get("categoryName") ?? "").trim();
  if (!eventId || !categoryName) return;

  const event = await prisma.event.findFirst({ where: { id: eventId, userId } });
  if (!event) return;

  const existed = await prisma.category.findUnique({
    where: { userId_name: { userId, name: categoryName } },
    select: { id: true },
  });
  const category = await getOrCreateCategory(userId, categoryName);
  if (!existed) trackEvent(userId, "feature:category-create");
  await prisma.event.update({
    where: { id: eventId },
    data: { categoryId: category.id },
  });

  revalidateAppViews(eventId);
}

// ── 準備リスト各項目のメモに貼る画像 ───────────────────────
//   メモ本文（リンクを含む）は comment としてこれまで通り説明欄にも出る。
//   画像はアプリ内のみ。圧縮済みデータ URL を、項目 id ではなく
//   (eventId, kind, slot=正規化タイトル) で保存する（saveChecklist が
//   項目行を毎回作り直すため）。ストレージを圧迫しないよう上限を設ける。

const MAX_ITEM_IMAGE_BYTES = 500 * 1024; // 圧縮後 1 枚あたり
const MAX_IMAGES_PER_ITEM = 4; // 1 項目あたり

/** 準備リスト項目のメモに圧縮済み画像を 1 枚追加する。 */
export async function addChecklistItemImage(input: {
  eventId: string;
  kind: string;
  title: string;
  data: string;
  width: number;
  height: number;
}): Promise<{ ok: boolean; error?: string }> {
  const userId = await requireUserId();
  const data = String(input.data ?? "");
  if (!/^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(data)) {
    return { ok: false, error: "画像として読み取れませんでした。" };
  }
  const b64 = data.slice(data.indexOf(",") + 1);
  const bytes = Math.floor((b64.length * 3) / 4);
  if (bytes > MAX_ITEM_IMAGE_BYTES) {
    return {
      ok: false,
      error: "画像が大きすぎます。もう少し小さいものを選んでください。",
    };
  }

  const kind = (input.kind || "task").trim() || "task";
  const slot = normTitle(input.title || "");
  if (!slot) return { ok: false, error: "先に項目名を入力してください。" };

  const event = await prisma.event.findFirst({
    where: { id: input.eventId, userId },
    select: { id: true },
  });
  if (!event) return { ok: false, error: "予定が見つかりません。" };

  const count = await prisma.checklistItemImage.count({
    where: { eventId: input.eventId, kind, slot },
  });
  if (count >= MAX_IMAGES_PER_ITEM) {
    return {
      ok: false,
      error: `画像は 1 項目につき ${MAX_IMAGES_PER_ITEM} 枚までです。`,
    };
  }

  await prisma.checklistItemImage.create({
    data: {
      eventId: input.eventId,
      kind,
      slot,
      data,
      width: Math.max(1, Math.round(input.width) || 1),
      height: Math.max(1, Math.round(input.height) || 1),
      bytes,
    },
  });
  revalidateAppViews(input.eventId);
  return { ok: true };
}

/** 準備リスト項目のメモ画像を 1 枚削除する。 */
export async function deleteChecklistItemImage(
  formData: FormData,
): Promise<void> {
  const userId = await requireUserId();
  const id = String(formData.get("id") ?? "");
  const img = await prisma.checklistItemImage.findFirst({
    where: { id, event: { userId } },
    select: { id: true, eventId: true },
  });
  if (!img) return;
  await prisma.checklistItemImage.deleteMany({ where: { id } });
  revalidateAppViews(img.eventId);
}

/** 準備リストを再生成する（学習内容を反映）。 */
export async function regenerateChecklist(formData: FormData): Promise<void> {
  const userId = await requireUserId();
  const eventId = String(formData.get("eventId") ?? "");
  const event = await prisma.event.findFirst({ where: { id: eventId, userId } });
  if (!event) return;

  // 「作り直す」は必ず生成し直す（同名コピーはしない）
  await generateAndSaveChecklist(eventId, { force: true });
  await markAutoManaged(eventId);
  // この予定が同名グループに属している（未編集）なら、作り直した内容を同名の未編集予定にも配る
  const twinIds = await propagateListToNameGroup(eventId);
  after(() => {
    void syncEventDescription(eventId);
    for (const id of twinIds) void syncEventDescription(id);
  });
  revalidateAppViews(eventId);
}

/** 予定詳細を開いたときに、未生成なら準備リストを生成する。 */
export async function ensureChecklist(eventId: string): Promise<void> {
  const userId = await requireUserId();
  const event = await prisma.event.findFirst({ where: { id: eventId, userId } });
  if (!event) return;
  await ensureChecklistForEvent(eventId);
}

/**
 * 連携時に取り込んだ既存の予定（autoManaged=false）は、開いても自動生成しない
 * （ユーザー指定）。この「準備リストを作る」ボタンを押したときだけ、ここで初めて
 * 準備リストと未来の自分へのメッセージの一致判定を行う。生成後はこの予定も
 * 自動管理の対象になる（以後は他の予定と同じ扱い）。
 */
export async function generateChecklistForEvent(
  formData: FormData,
): Promise<void> {
  const userId = await requireUserId();
  const eventId = String(formData.get("eventId") ?? "");
  const event = await prisma.event.findFirst({ where: { id: eventId, userId } });
  if (!event) return;

  await ensureChecklistForEvent(eventId);
  await ensureFutureMessageMatchesForEvent(eventId, { allowAi: true }).catch(() => {});
  await markAutoManaged(eventId);
  revalidateAppViews(eventId);
  after(() => void syncEventDescription(eventId));
}

/** チェック（完了）の即時トグル。詳細ページは再描画せず、一覧の集計だけ更新。 */
export async function toggleChecklistItemDone(
  itemId: string,
  isDone: boolean,
): Promise<void> {
  const userId = await requireUserId();
  const item = await prisma.checklistItem.findFirst({
    where: { id: itemId, event: { userId } },
    select: { id: true, eventId: true },
  });
  if (!item) return;
  // update ではなく updateMany（対象行が消えていても 500 にしない）
  const res = await prisma.checklistItem.updateMany({
    where: { id: itemId },
    data: { isDone: Boolean(isDone) },
  });
  if (res.count === 0) return;
  // 完了状態をカレンダー説明欄（取り消し線）にも反映
  await markAutoManaged(item.eventId);
  after(() => syncEventDescription(item.eventId));
  revalidateAppViews(item.eventId);
}

/**
 * 生成されたリストを「確認しました」と記録する（編集はしていない）。
 * これで「未確認」表示（アプリ・カレンダー説明欄）が消える。
 * 内容を編集した場合は EditRecord ができるので、このボタンは自然に不要になる。
 */
export async function markListReviewed(formData: FormData): Promise<void> {
  const userId = await requireUserId();
  const eventId = String(formData.get("eventId") ?? "");
  if (!eventId) return;
  const res = await prisma.event.updateMany({
    where: { id: eventId, userId, listReviewedAt: null },
    data: { listReviewedAt: new Date() },
  });
  if (res.count === 0) return;
  await markAutoManaged(eventId);
  after(() => syncEventDescription(eventId));
  revalidateAppViews(eventId);
}

/**
 * 予定単位の「準備リストのリマインド」を変える（即時）。最大 5 個。
 * leads = [] で送らない。
 */
export async function setListReminders(
  eventId: string,
  leads: number[],
): Promise<void> {
  const userId = await requireUserId();
  const json = stringifyLeads(Array.isArray(leads) ? leads : []);
  const arr = JSON.parse(json) as number[];
  const res = await prisma.event.updateMany({
    where: { id: eventId, userId },
    data: {
      listReminderLeads: json,
      sentListReminderLeads: "[]", // 変えたので再送対象に
      listReminderLeadMinutes: arr[0] ?? null, // 先頭値のミラー
      listReminderNotifiedAt: null,
      // ユーザーが決めたので、以後この予定は学習で上書きしない。次の似た予定はこの値を初期値にする。
      listReminderTouchedAt: new Date(),
    },
  });
  if (res.count === 0) return;
  trackEvent(userId, "feature:list-reminder-set");
  revalidateAppViews(eventId);
}

/**
 * 通知リード時間の即時変更＋即時学習（「保存する」不要。チェックと同じ扱い）。
 * minutes = null で通知なし。
 */
export async function setItemNotifyLead(
  itemId: string,
  minutes: number | null,
): Promise<void> {
  const userId = await requireUserId();
  const lead = cleanLead(minutes);
  const item = await prisma.checklistItem.findFirst({
    where: { id: itemId, isSuggested: false, event: { userId } },
    include: { event: true },
  });
  if (!item) return;
  if ((item.notifyLeadMinutes ?? null) === lead) return; // 変化なし

  const res = await prisma.checklistItem.updateMany({
    where: { id: itemId },
    data: { notifyLeadMinutes: lead, notifiedAt: null },
  });
  if (res.count === 0) return; // 対象行が消えていた（保存と競合）

  // 内容とセットで即時学習（notify_override）
  if (item.event.categoryId) {
    await recordEdit({
      eventId: item.eventId,
      categoryId: item.event.categoryId,
      itemKind: item.kind === "belonging" ? "belonging" : "task",
      feature: extractEventFeature({
        title: item.event.title,
        memo: item.event.memo,
        eventDatetime: item.event.eventDatetime,
        endDatetime: item.event.endDatetime,
      }),
      removed: [],
      added: [],
      retimed: [],
      renotified: [{ title: item.title, leadMinutes: lead }],
    });
  }

  await markAutoManaged(item.eventId);
  const twinIds = await resolveNameGroupOnEdit(item.eventId);
  after(() => {
    void syncEventDescription(item.eventId);
    for (const id of twinIds) void syncEventDescription(id);
  });
  revalidateAppViews(item.eventId);
}

interface SaveChecklistInput {
  eventId: string;
  /** "task" / "belonging" / ユーザーが足した枠名 */
  kind: string;
  items: {
    title: string;
    comment: string | null;
    isDone: boolean;
    isUserAdded: boolean;
    // 予定開始の何分前に通知するか。null = 通知しない。項目の「いつ」はこれ 1 本。
    notifyLeadMinutes: number | null;
  }[];
  removedTitles: string[];
}

function cleanLead(v: unknown): number | null {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.min(Math.round(n), 60 * 24 * 30); // 上限 30 日
}

/** チェックリストの編集を保存し、学習ルールに反映する（種別ごと・提案項目は残す）。 */
export async function saveChecklist(input: SaveChecklistInput): Promise<void> {
  const userId = await requireUserId();
  const kind = (input.kind || "task").trim() || "task";
  const event = await prisma.event.findFirst({
    where: { id: input.eventId, userId },
    include: { checklistItems: true },
  });
  if (!event) return;

  const cleanItems = input.items
    .map((it) => ({
      title: it.title.trim(),
      comment: it.comment?.trim() || null,
      isDone: Boolean(it.isDone),
      isUserAdded: Boolean(it.isUserAdded),
      notifyLeadMinutes: cleanLead(it.notifyLeadMinutes),
    }))
    .filter((it) => it.title.length > 0);

  // この種別の、非提案項目だけを対象に差分をとる
  const prev = event.checklistItems.filter(
    (c) => !c.isSuggested && c.kind === kind,
  );
  const prevByTitle = new Map(prev.map((c) => [c.title.trim(), c]));
  const nextTitles = new Set(cleanItems.map((it) => it.title));

  const removed = [...prevByTitle.keys()].filter((t) => !nextTitles.has(t));
  const added: GeneratedItem[] = cleanItems
    .filter((it) => it.isUserAdded || !prevByTitle.has(it.title))
    .map((it) => ({
      title: it.title,
      timingLabel: null,
      notifyLeadMinutes: it.notifyLeadMinutes,
    }));
  const renotified: { title: string; leadMinutes: number | null }[] = [];
  for (const it of cleanItems) {
    const p = prevByTitle.get(it.title);
    // 通知リード時間の変更、または通知付きで新規追加 → 内容とセットで学習
    const prevLead = p ? (p.notifyLeadMinutes ?? null) : null;
    if (
      (p && prevLead !== it.notifyLeadMinutes) ||
      (!p && it.notifyLeadMinutes !== null)
    ) {
      renotified.push({ title: it.title, leadMinutes: it.notifyLeadMinutes });
    }
  }

  // 名前付きリストそのまま（sourceTemplateId 付き）の枠で、タイトルの追加・削除が
  // 実際にあったら（メモ・チェック・通知だけの変更では変えない）、この予定だけ枠名を
  // 「元のリスト名（編集済み）」に変える（ユーザー指示）。組み込みの2枠は対象外。
  // `added` は isUserAdded な行を毎回含む（学習用）ので、ここではタイトル集合だけで
  // 厳密に「本当に新しいタイトルか」を見る。
  const genuinelyNewTitleCount = [...nextTitles].filter(
    (t) => !prevByTitle.has(t),
  ).length;
  const titleSetChanged = removed.length > 0 || genuinelyNewTitleCount > 0;
  let effectiveKind = kind;
  if (titleSetChanged && !isBuiltinSection(kind)) {
    const srcTemplateId = prev.find((p) => p.sourceTemplateId)?.sourceTemplateId;
    if (srcTemplateId) {
      const srcTemplate = await prisma.listTemplate.findUnique({
        where: { id: srcTemplateId },
        select: { name: true },
      });
      if (srcTemplate) {
        effectiveKind = `${srcTemplate.name}（編集済み）`.slice(0, 80);
      }
    }
  }
  const renamed = effectiveKind !== kind;

  // ユーザーが足した枠なら、予定の枠順に確実に含めておく（説明欄・学習と整合）。
  // 改名するときは、旧キーの位置に新キーを差し替える（新キーが既に別枠として
  // 存在するなら、そちらに合流させて旧キーは順序から外す）。
  const curOrder = parseSectionOrder(event.sectionOrder);
  const nextOrder = renamed
    ? curOrder.includes(effectiveKind)
      ? curOrder.filter((k) => k !== kind)
      : curOrder.map((k) => (k === kind ? effectiveKind : k))
    : isBuiltinSection(kind) || curOrder.includes(kind)
      ? curOrder
      : [...curOrder, kind];

  // この種別の非提案項目だけ入れ替え（提案行・他種別は残す）
  const maxOrder = Math.max(
    0,
    ...event.checklistItems.map((c) => c.sortOrder),
  );
  const survivingSlots = cleanItems.map((it) => normTitle(it.title));

  // トランザクションは配列で組み立てる。createMany は空配列だと環境によって
  // エラーになるため、項目が 1 件以上あるときだけ入れる（全削除でも落とさない）。
  const ops: Prisma.PrismaPromise<unknown>[] = [
    prisma.checklistItem.deleteMany({
      where: { eventId: input.eventId, isSuggested: false, kind },
    }),
  ];
  if (cleanItems.length > 0) {
    ops.push(
      prisma.checklistItem.createMany({
        data: cleanItems.map((it, i) => {
          const p = prevByTitle.get(it.title);
          const leadUnchanged =
            p && (p.notifyLeadMinutes ?? null) === it.notifyLeadMinutes;
          return {
            eventId: input.eventId,
            kind: effectiveKind,
            title: it.title,
            timingLabel: p ? p.timingLabel : null,
            comment: it.comment,
            isDone: it.isDone,
            isUserAdded: it.isUserAdded,
            notifyLeadMinutes: it.notifyLeadMinutes,
            // リード時間が変わっていなければ送信済みフラグを引き継ぐ（再送しない）
            notifiedAt: leadUnchanged ? (p?.notifiedAt ?? null) : null,
            sortOrder: (effectiveKind === "task" ? 0 : maxOrder + 1) + i,
            // 改名した＝ここから先は独自編集なので「テンプレートのまま」の印を外す。
            // 改名していなければ、まだ「そのまま」の状態なので印を引き継ぐ。
            sourceTemplateId: renamed ? null : (p?.sourceTemplateId ?? null),
          };
        }),
      }),
    );
  }
  if (nextOrder !== curOrder) {
    ops.push(
      prisma.event.update({
        where: { id: input.eventId },
        data: { sectionOrder: stringifySectionOrder(nextOrder) },
      }),
    );
  }
  if (renamed) {
    // 改名: 残る項目のメモ画像は新しい枠名へ移してから、旧枠名に残った分
    // （削除された項目の分）を消す。
    if (survivingSlots.length > 0) {
      ops.push(
        prisma.checklistItemImage.updateMany({
          where: { eventId: input.eventId, kind, slot: { in: survivingSlots } },
          data: { kind: effectiveKind },
        }),
      );
    }
    ops.push(
      prisma.checklistItemImage.deleteMany({
        where: { eventId: input.eventId, kind },
      }),
    );
  } else {
    // 消えた項目（削除・改名）のメモ画像を後始末する。残った項目のスロットは追従。
    // 全削除のときは、この種別の画像を丸ごと消す。
    ops.push(
      prisma.checklistItemImage.deleteMany({
        where:
          survivingSlots.length > 0
            ? { eventId: input.eventId, kind, slot: { notIn: survivingSlots } }
            : { eventId: input.eventId, kind },
      }),
    );
  }
  await prisma.$transaction(ops);

  // 全種別を通じて非提案項目が 0 になったか＝「リストを全部消した」状態。
  const remaining = await prisma.checklistItem.count({
    where: { eventId: input.eventId, isSuggested: false },
  });
  const listCleared = remaining === 0;
  await prisma.event.update({
    where: { id: input.eventId },
    data: { listCleared },
  });
  if (listCleared) {
    // 全部消したなら、残っている提案（isSuggested）も消す。ユーザーが自分で足す。
    await prisma.checklistItem.deleteMany({
      where: { eventId: input.eventId, isSuggested: true },
    });
  }

  // ここから先（学習・同名グループ・説明欄同期）は「おまけ」。
  // 失敗しても保存自体は済んでいるので、500 にはせずログだけ残す。
  try {
    const uniq = (a: string[]) =>
      Array.from(new Set(a.map((s) => s.trim()).filter(Boolean)));
    if (
      event.categoryId &&
      (removed.length || added.length || renotified.length)
    ) {
      await recordEdit({
        eventId: event.id,
        categoryId: event.categoryId,
        itemKind: effectiveKind,
        feature: extractEventFeature({
          title: event.title,
          memo: event.memo,
          eventDatetime: event.eventDatetime,
          endDatetime: event.endDatetime,
        }),
        removed: uniq(removed),
        added: added.filter(
          (a, i, arr) =>
            !!a.title.trim() &&
            arr.findIndex((x) => x.title.trim() === a.title.trim()) === i,
        ),
        retimed: [],
        renotified,
      });
    }

    // カテゴリ横断パターン（pattern_analogy）の採用/却下フィードバック。
    // この保存で非提案項目は毎回全部作り直され、その際 suggestionType は引き継がれない
    // （上の createMany 参照）ので、「pattern_analogy が付いたまま迎えるこの1回の保存」が
    // 採用/却下を判定できる唯一の機会になる。次回以降の保存では既にタグが外れているので
    // 何回再保存しても二重にカウントされない。
    const patternPrev = prev.filter(
      (c) => c.suggestionType === "pattern_analogy" && c.suggestionRuleId,
    );
    for (const c of patternPrev) {
      const kept = nextTitles.has(c.title.trim());
      await prisma.learnedRule
        .update({
          where: { id: c.suggestionRuleId! },
          data: kept
            ? { confirmedCount: { increment: 1 } }
            : { contradictedCount: { increment: 1 } },
        })
        .catch(() => {});
    }

    await markAutoManaged(input.eventId);

    // 内容（項目・通知時間）が変わった編集なら、同名グループの扱いを更新する。
    const contentChanged =
      removed.length > 0 || added.length > 0 || renotified.length > 0;
    const twinIds = contentChanged
      ? await resolveNameGroupOnEdit(input.eventId)
      : [];

    after(() => {
      void syncEventDescription(input.eventId);
      for (const id of twinIds) void syncEventDescription(id);
    });
  } catch (e) {
    console.error(
      "[saveChecklist] 保存後の学習・同期でエラー eventId=%s",
      input.eventId,
      e,
    );
    after(() => void syncEventDescription(input.eventId));
  }

  revalidateAppViews(input.eventId);
}

/**
 * 予定詳細ページの「リストごとに全部消す」。指定した枠（kind）の項目を一括削除する。
 * 個別の ✕ 削除と違い、これは学習（除外ルール）には流さない — この予定のリストを
 * まとめて空にするだけ。
 */
export async function clearChecklistSection(formData: FormData): Promise<void> {
  const userId = await requireUserId();
  const eventId = String(formData.get("eventId") ?? "");
  const kind = String(formData.get("kind") ?? "").trim();
  if (!eventId || !kind) return;

  const event = await prisma.event.findFirst({
    where: { id: eventId, userId },
    select: { id: true },
  });
  if (!event) return;

  trackEvent(userId, "feature:clear-section");
  await prisma.$transaction([
    prisma.checklistItem.deleteMany({
      where: { eventId, isSuggested: false, kind },
    }),
    prisma.checklistItemImage.deleteMany({ where: { eventId, kind } }),
  ]);

  const remaining = await prisma.checklistItem.count({
    where: { eventId, isSuggested: false },
  });
  if (remaining === 0) {
    await prisma.checklistItem.deleteMany({
      where: { eventId, isSuggested: true },
    });
  }
  await prisma.event.update({
    where: { id: eventId },
    data: { listCleared: remaining === 0 },
  });

  await markAutoManaged(eventId);
  revalidateAppViews(eventId);
  after(() => void syncEventDescription(eventId));
}

// ── 準備リストの「枠」（セクション）を追加・改名・削除する ──────────
//   組み込みの「準備すること」「持ち物」は改名・削除できない。
//   枠を足す／消すと、説明欄の同期（after）と学習ページも即座に追随する。

async function loadEventForSection(eventId: string) {
  const userId = await requireUserId();
  const event = await prisma.event.findFirst({
    where: { id: eventId, userId },
    select: { id: true, sectionOrder: true },
  });
  return event;
}

/**
 * 枠の変更後、同名グループの扱い（波及 or 切り離し）を更新し、説明欄も同期する。
 * 予定ページからでも学習ページ（まとめられた同名予定）からでも整合するように。
 */
async function propagateSectionChange(eventId: string): Promise<void> {
  await markAutoManaged(eventId);
  let twinIds: string[] = [];
  try {
    twinIds = await resolveNameGroupOnEdit(eventId);
  } catch (e) {
    console.error("[section] 同名グループ処理に失敗 eventId=%s", eventId, e);
  }
  after(() => {
    void syncEventDescription(eventId);
    for (const id of twinIds) void syncEventDescription(id);
  });
  revalidateAppViews(eventId);
}

/** 新しい枠を追加する。枠名がキーになる（組み込み名は不可）。 */
export async function addChecklistSection(formData: FormData): Promise<void> {
  const eventId = String(formData.get("eventId") ?? "");
  const name = String(formData.get("name") ?? "").trim().slice(0, 24);
  if (!name) return;
  const key = sectionKeyFromLabel(name);
  if (isBuiltinSection(key)) return; // 「準備すること」等はすでにある

  const event = await loadEventForSection(eventId);
  if (!event) return;

  const order = parseSectionOrder(event.sectionOrder);
  if (order.includes(key)) return;
  await prisma.event.update({
    where: { id: eventId },
    data: { sectionOrder: stringifySectionOrder([...order, key]) },
  });
  trackEvent(await getSessionUserId(), "feature:add-section");
  await propagateSectionChange(eventId);
}

/** 枠の名前を変える。中の項目の kind も新しい名前へ付け替える。 */
export async function renameChecklistSection(
  formData: FormData,
): Promise<void> {
  const eventId = String(formData.get("eventId") ?? "");
  const from = String(formData.get("from") ?? "").trim();
  const to = sectionKeyFromLabel(
    String(formData.get("to") ?? "").trim().slice(0, 24),
  );
  if (!from || !to || isBuiltinSection(from) || isBuiltinSection(to)) return;

  const event = await loadEventForSection(eventId);
  if (!event) return;

  const order = parseSectionOrder(event.sectionOrder);
  if (!order.includes(from) || order.includes(to)) return;

  await prisma.$transaction([
    prisma.checklistItem.updateMany({
      where: { eventId, kind: from },
      data: { kind: to },
    }),
    prisma.checklistItemImage.updateMany({
      where: { eventId, kind: from },
      data: { kind: to },
    }),
    prisma.event.update({
      where: { id: eventId },
      data: {
        sectionOrder: stringifySectionOrder(
          order.map((k) => (k === from ? to : k)),
        ),
      },
    }),
  ]);
  await propagateSectionChange(eventId);
}

/** 枠を削除する。中の項目もまとめて消える（組み込みは不可）。 */
export async function removeChecklistSection(
  formData: FormData,
): Promise<void> {
  const eventId = String(formData.get("eventId") ?? "");
  const key = String(formData.get("key") ?? "").trim();
  if (!key || isBuiltinSection(key)) return;

  const event = await loadEventForSection(eventId);
  if (!event) return;

  const order = parseSectionOrder(event.sectionOrder);
  if (!order.includes(key)) return;

  await prisma.$transaction([
    prisma.checklistItem.deleteMany({ where: { eventId, kind: key } }),
    prisma.checklistItemImage.deleteMany({ where: { eventId, kind: key } }),
    prisma.event.update({
      where: { id: eventId },
      data: {
        sectionOrder: stringifySectionOrder(order.filter((k) => k !== key)),
      },
    }),
  ]);
  await propagateSectionChange(eventId);
}

/** 枠（セクション）の並び順を入れ替える（ドラッグ&ドロップ / ▲▼）。 */
export async function reorderChecklistSections(input: {
  eventId: string;
  order: string[];
}): Promise<void> {
  const eventId = String(input.eventId ?? "");
  const event = await loadEventForSection(eventId);
  if (!event) return;

  const cur = parseSectionOrder(event.sectionOrder);
  const wanted = input.order
    .map((k) => String(k))
    .filter((k, i, a) => a.indexOf(k) === i);
  // 要求された順に、実在するキー（と "@" 始まりの特別キー）だけを並べる。
  // 要求に無い既存キーは末尾へ。
  const next = [
    ...wanted.filter((k) => cur.includes(k) || k.startsWith("@")),
    ...cur.filter((k) => !wanted.includes(k)),
  ];
  if (stringifySectionOrder(next) === stringifySectionOrder(cur)) return;

  await prisma.event.update({
    where: { id: eventId },
    data: { sectionOrder: stringifySectionOrder(next) },
  });
  await propagateSectionChange(eventId);
}

/** 提案項目を「適用」する（1タップ）。ルールの確信度を上げる。 */
export async function acceptSuggestion(itemId: string): Promise<void> {
  const userId = await requireUserId();
  const item = await prisma.checklistItem.findFirst({
    where: { id: itemId, isSuggested: true, event: { userId } },
  });
  if (!item) return;

  if (item.suggestionType === "exclude") {
    await prisma.checklistItem.delete({ where: { id: itemId } });
  } else if (item.suggestionType === "add") {
    await prisma.checklistItem.update({
      where: { id: itemId },
      data: {
        isSuggested: false,
        suggestionType: null,
        suggestionRuleId: null,
        suggestionValue: null,
        isUserAdded: true,
      },
    });
  } else if (item.suggestionType === "timing") {
    await prisma.checklistItem.update({
      where: { id: itemId },
      data: {
        notifyLeadMinutes:
          parseLead(item.suggestionValue) ?? item.notifyLeadMinutes,
        isSuggested: false,
        suggestionType: null,
        suggestionRuleId: null,
        suggestionValue: null,
      },
    });
  }

  if (item.suggestionRuleId) await confirmRule(item.suggestionRuleId);
  await markAutoManaged(item.eventId);
  after(() => syncEventDescription(item.eventId));
  revalidateAppViews(item.eventId);
}

/** 提案項目を「却下」する（1タップ）。ルールの確信度を下げる。 */
export async function rejectSuggestion(itemId: string): Promise<void> {
  const userId = await requireUserId();
  const item = await prisma.checklistItem.findFirst({
    where: { id: itemId, isSuggested: true, event: { userId } },
  });
  if (!item) return;

  if (item.suggestionType === "add") {
    await prisma.checklistItem.delete({ where: { id: itemId } });
  } else {
    // exclude / timing → 項目は現状のまま残す
    await prisma.checklistItem.update({
      where: { id: itemId },
      data: {
        isSuggested: false,
        suggestionType: null,
        suggestionRuleId: null,
        suggestionValue: null,
      },
    });
  }

  if (item.suggestionRuleId) await contradictRule(item.suggestionRuleId);
  await markAutoManaged(item.eventId);
  after(() => syncEventDescription(item.eventId));
  revalidateAppViews(item.eventId);
}

/** 学習内容の確認画面: ルールを固定/解除する。 */
export async function setRuleLocked(
  ruleId: string,
  locked: boolean,
): Promise<void> {
  const userId = await requireUserId();
  const rule = await prisma.learnedRule.findFirst({
    where: { id: ruleId, category: { userId } },
  });
  if (!rule) return;
  await prisma.learnedRule.update({
    where: { id: ruleId },
    data: {
      isUserLocked: locked,
      ...(locked
        ? { confidence: 0.95, confirmedCount: Math.max(rule.confirmedCount, 3) }
        : {}),
    },
  });
  revalidateAppViews();
}

/** 学習内容の確認画面: ルールを削除（リセット）する。 */
export async function deleteLearnedRule(ruleId: string): Promise<void> {
  const userId = await requireUserId();
  await prisma.learnedRule.deleteMany({
    where: { id: ruleId, category: { userId } },
  });
  revalidateAppViews();
}

/**
 * 学習されたマニュアルページ: カテゴリを削除する。
 * 予定はカテゴリ無し（その他扱い）になるだけで消えない
 * （Event の categoryId は onDelete: SetNull）。このカテゴリで
 * 学習したルール（LearnedRule）は一緒に消える（onDelete: Cascade）。
 */
export async function deleteCategory(categoryId: string): Promise<void> {
  const userId = await requireUserId();
  const category = await prisma.category.findFirst({
    where: { id: categoryId, userId },
  });
  if (!category) return;
  trackEvent(userId, "feature:category-delete");
  await prisma.category.delete({ where: { id: categoryId } });
  revalidateAppViews();
}

/**
 * 学習されたマニュアルページ: 樹形図の「学習された予定」を1件、学習前の状態に戻す
 * （＝一覧から消える）。実際の予定・準備リストの中身（ChecklistItem）は消さない
 * ——あくまで「これは確認・編集済み」という学習の印を外すだけ。
 * まとめて表示されている同名グループ（siblingEventIds 含む）もまとめて対象にする。
 */
export async function forgetLearnedEvent(eventIds: string[]): Promise<void> {
  const userId = await requireUserId();
  if (eventIds.length === 0) return;
  const events = await prisma.event.findMany({
    where: { id: { in: eventIds }, userId },
    select: { id: true },
  });
  const ids = events.map((e) => e.id);
  if (ids.length === 0) return;
  trackEvent(userId, "feature:learned-event-delete");

  await prisma.$transaction([
    prisma.editRecord.deleteMany({ where: { eventId: { in: ids } } }),
    prisma.event.updateMany({
      where: { id: { in: ids } },
      data: { listCustomized: false, listReviewedAt: null, listCleared: false },
    }),
  ]);
  revalidateAppViews();
}

// ─────────────────────────────────────────────
// P1: 未来の自分へのメッセージ
// ─────────────────────────────────────────────

function parseCsv(raw: FormDataEntryValue | null): string[] {
  return String(raw ?? "")
    .split(/[,、，]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * 「未来の自分へ」ページ（/failures）の「メッセージを書く」フォーム。
 * 予定に紐づけなくても作れる（あとで一致すれば自動で結びつく）。
 */
export async function createFutureMessageAction(formData: FormData): Promise<void> {
  const userId = await requireUserId();
  const body = String(formData.get("body") ?? "").trim();
  if (!body) return;
  const rawScope = String(formData.get("scope") ?? "keyword");
  trackEvent(userId, "feature:message-quick-record");

  await createFutureMessage(userId, {
    body,
    keywords: parseCsv(formData.get("keywords")),
    genres: parseCsv(formData.get("genres")),
    categoryIds: formData.getAll("categoryIds").map(String),
    scope: rawScope,
  });
  revalidateAppViews();
}

/** 予定詳細ページの「💌 未来の自分へ」枠の「＋ 追加」。新規メッセージを作り、この予定にも結びつける。 */
export async function createMessageForEventAction(formData: FormData): Promise<void> {
  const userId = await requireUserId();
  const eventId = String(formData.get("eventId") ?? "");
  const body = String(formData.get("body") ?? "").trim();
  if (!eventId || !body) return;

  await createMessageForEvent(eventId, userId, {
    body,
    keywords: parseCsv(formData.get("keywords")),
    genres: parseCsv(formData.get("genres")),
  });
  await markAutoManaged(eventId);
  revalidateAppViews(eventId);
}

/** メッセージ本体の内容・条件をその場で編集（自動保存）。 */
export async function updateFutureMessageAction(formData: FormData): Promise<void> {
  const userId = await requireUserId();
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const eventId = String(formData.get("eventId") ?? "") || undefined;

  await updateFutureMessage(userId, id, {
    body: String(formData.get("body") ?? ""),
    keywords: parseCsv(formData.get("keywords")),
    genres: parseCsv(formData.get("genres")),
    categoryIds: formData.getAll("categoryIds").map(String),
    scope: String(formData.get("scope") ?? "keyword"),
  });
  revalidateAppViews(eventId);
}

/** メッセージのアーカイブ／復活（削除ではなく、一覧から退避）。 */
export async function archiveFutureMessageAction(formData: FormData): Promise<void> {
  const userId = await requireUserId();
  const id = String(formData.get("id") ?? "");
  const archived = String(formData.get("archived") ?? "") === "1";
  if (!id) return;
  await updateFutureMessage(userId, id, { archived });
  revalidateAppViews();
}

/** メッセージを完全に削除する（確認ポップアップ必須）。 */
export async function deleteFutureMessageAction(formData: FormData): Promise<void> {
  const userId = await requireUserId();
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  await deleteFutureMessage(userId, id);
  revalidateAppViews();
}

/** ✕ この予定からだけ外す（メッセージ本体は残り、同じ条件でも再結びつけしない）。 */
export async function removeMessageFromEventAction(formData: FormData): Promise<void> {
  const userId = await requireUserId();
  const eventId = String(formData.get("eventId") ?? "");
  const messageId = String(formData.get("messageId") ?? "");
  if (!eventId || !messageId) return;
  await removeMessageFromEvent(eventId, userId, messageId);
  revalidateAppViews(eventId);
}

/**
 * 音声入力（スマホのマイクキーで話した自由文）を、AI で「本文・キーワード・ジャンル」
 * の配列に整える（まだ保存しない）。previewDictatedFailures と同じ2段階の作法。
 */
export async function previewDictatedMessages(text: string): Promise<{
  ok: boolean;
  items: { body: string; keywords: string[]; genres: string[] }[];
  error?: string;
}> {
  await requireUserId();
  const trimmed = String(text ?? "").trim();
  if (!trimmed) return { ok: false, items: [], error: "内容がありません。" };

  const { splitDictationIntoMessages } = await import("@/lib/dictation-to-message");
  let items;
  try {
    items = await splitDictationIntoMessages(trimmed);
  } catch (e) {
    console.error("[previewDictatedMessages] 失敗", e);
    return {
      ok: false,
      items: [],
      error: "うまく整えられませんでした。少し短くして試してみてください。",
    };
  }
  if (items.length === 0) {
    return { ok: false, items: [], error: "何が起きたか読み取れませんでした。" };
  }
  return { ok: true, items };
}

/** previewDictatedMessages で確認済みの内容をまとめて保存する。 */
export async function saveDictatedMessages(input: {
  eventId: string | null;
  items: { body: string; keywords: string[]; genres: string[] }[];
}): Promise<{ ok: boolean; added: number; error?: string }> {
  const userId = await requireUserId();
  const cleanItems = (input.items ?? [])
    .map((it) => ({
      body: String(it.body ?? "").trim(),
      keywords: (it.keywords ?? []).map(String),
      genres: (it.genres ?? []).map(String),
    }))
    .filter((it) => it.body.length > 0);
  if (cleanItems.length === 0) {
    return { ok: false, added: 0, error: "内容がありません。" };
  }

  const eventId = input.eventId ? String(input.eventId).trim() || null : null;
  if (eventId) {
    const owns = await prisma.event.findFirst({
      where: { id: eventId, userId },
      select: { id: true },
    });
    if (!owns) {
      return {
        ok: false,
        added: 0,
        error: "選んだ予定が見つかりませんでした。もう一度選び直してください。",
      };
    }
  }

  trackEvent(userId, "feature:message-dictation");
  for (const it of cleanItems) {
    if (eventId) {
      await createMessageForEvent(eventId, userId, it);
    } else {
      await createFutureMessage(userId, it);
    }
  }
  revalidateAppViews(eventId ?? undefined);
  return { ok: true, added: cleanItems.length };
}

/** 予定後の確定カード：「この内容で確定」／項目ごとの修正後に確定する。 */
export async function confirmMessageReviewAction(input: {
  linkId: string;
  proposed: MessageProposalFields;
  final: MessageFields;
  acceptedNewMessages?: { body: string; keywords: string[] }[];
}): Promise<{ ok: boolean }> {
  const userId = await requireUserId();
  trackEvent(userId, "feature:message-review-confirm");

  const link = await confirmMessageReview(userId, input.linkId, input.final);
  if (!link) return { ok: false };

  await recordProposalOutcome({
    userId,
    messageId: link.messageId,
    eventId: link.eventId,
    proposed: input.proposed,
    final: input.final,
  });

  for (const s of input.acceptedNewMessages ?? []) {
    if (!s.body.trim()) continue;
    await createFutureMessage(userId, { body: s.body, keywords: s.keywords });
  }

  revalidateAppViews(link.eventId);
  return { ok: true };
}

/** 予定後の確定カード：「今回は更新しない」。 */
export async function skipMessageReviewAction(formData: FormData): Promise<void> {
  const userId = await requireUserId();
  const linkId = String(formData.get("linkId") ?? "");
  if (!linkId) return;
  await skipMessageReview(userId, linkId);
  revalidateAppViews();
}

// ─────────────────────────────────────────────
// オンボーディング
// ─────────────────────────────────────────────

/** 導入チュートリアルを完了/スキップしたことをサーバー側にも記録する。 */
export async function markTutorialSeen(): Promise<void> {
  const userId = await requireUserId();
  await prisma.user.updateMany({
    where: { id: userId, tutorialSeenAt: null },
    data: { tutorialSeenAt: new Date() },
  });
}

/**
 * 説明欄のリンクから開いたときの「直接編集できます」案内を、
 * 「今後表示しない」で消したことを記録する（呼ばなければ毎回表示され続ける）。
 */
export async function dismissDescLinkHint(): Promise<void> {
  const userId = await requireUserId();
  await prisma.user.updateMany({
    where: { id: userId, descLinkHintDismissedAt: null },
    data: { descLinkHintDismissedAt: new Date() },
  });
  void trackFeatureUse("popup:desc-link-hint:dismiss");
}

// ─────────────────────────────────────────────
// 通知（Web Push）購読の登録・解除
// ─────────────────────────────────────────────

export async function savePushSubscription(input: {
  endpoint: string;
  p256dh: string;
  auth: string;
  userAgent?: string;
}): Promise<void> {
  const userId = await requireUserId();
  await prisma.pushSubscription.upsert({
    where: { endpoint: input.endpoint },
    update: {
      userId,
      p256dh: input.p256dh,
      auth: input.auth,
      userAgent: input.userAgent ?? null,
    },
    create: {
      userId,
      endpoint: input.endpoint,
      p256dh: input.p256dh,
      auth: input.auth,
      userAgent: input.userAgent ?? null,
    },
  });
}

export async function removePushSubscription(endpoint: string): Promise<void> {
  await requireUserId();
  await prisma.pushSubscription.deleteMany({ where: { endpoint } });
}

export interface TestPushResult {
  configured: boolean;
  subscriptions: number;
  sent: number;
  removed: number;
}

/** 設定画面から「テスト通知を送る」。診断のため結果を返す。 */
export async function sendTestPush(): Promise<TestPushResult> {
  const userId = await requireUserId();
  const configured = isPushConfigured();
  const subscriptions = await prisma.pushSubscription.count({ where: { userId } });
  if (!configured || subscriptions === 0) {
    return { configured, subscriptions, sent: 0, removed: 0 };
  }
  trackEvent(userId, "feature:notification-test");
  const { sent, removed } = await sendPushToUser(userId, {
    title: `${APP_NAME}：通知テスト`,
    body: "予定が追加されると、このように通知が届きます。",
    url: "/",
    tag: "test",
  });
  return { configured, subscriptions, sent, removed };
}

// ─────────────────────────────────────────────
// P1: 簡易フィードバック（WTP）
// ─────────────────────────────────────────────

export async function submitFeedback(formData: FormData): Promise<void> {
  const userId = await requireUserId();
  const wtpRaw = String(formData.get("wtpYen") ?? "").trim();
  const wtpYen = wtpRaw ? parseYen(wtpRaw) : null;
  const comment = String(formData.get("comment") ?? "").trim() || null;
  const screen = String(formData.get("screen") ?? "").trim() || null;

  if (wtpYen === null && !comment) return;

  await prisma.feedback.create({
    data: { userId, wtpYen, comment, screen },
  });

  revalidatePath("/settings");
}

// ─────────────────────────────────────────────
// 準備リストのテンプレート（名前を付けて保存・再利用）＋他の予定からコピー
// ─────────────────────────────────────────────

function readKind(v: unknown): "task" | "belonging" {
  return String(v ?? "") === "belonging" ? "belonging" : "task";
}

/**
 * 予定の「いま」のリストのうち、指定した枠（準備すること／持ち物／ユーザーが足した枠）
 * だけを名前を付けてテンプレート保存する。テンプレートは枠ごとに分ける。
 */
export async function saveListAsTemplate(formData: FormData): Promise<void> {
  const userId = await requireUserId();
  const eventId = String(formData.get("eventId") ?? "");
  // 組み込みの2枠に限らず、いま編集中の枠キーをそのまま使う（task/belonging に強制しない）。
  const kind = String(formData.get("kind") ?? "").trim() || "task";
  const name = String(formData.get("name") ?? "")
    .trim()
    .slice(0, 60);
  if (!eventId || !name) return;
  trackEvent(userId, "feature:template-save");

  const event = await prisma.event.findFirst({
    where: { id: eventId, userId },
    include: {
      checklistItems: {
        where: { isSuggested: false, kind },
        orderBy: { sortOrder: "asc" },
        select: { title: true, notifyLeadMinutes: true },
      },
    },
  });
  if (!event) return;

  const picked = event.checklistItems;
  if (picked.length === 0) return;

  const create = picked.map((it, i) => ({
    kind,
    title: it.title,
    notifyLeadMinutes: it.notifyLeadMinutes ?? null,
    sortOrder: i,
  }));

  const template = await prisma.listTemplate.upsert({
    where: { userId_kind_name: { userId, kind, name } },
    update: { sourceEventId: eventId, items: { deleteMany: {}, create } },
    create: { userId, kind, name, sourceEventId: eventId, items: { create } },
  });

  // この予定の枠自体を、名前を付けたリストの名前に合わせる（ユーザー指示）。組み込みの
  // 2枠（準備すること／持ち物）はそれ自体の意味を変えてしまうため改名の対象外にする。
  if (!isBuiltinSection(kind) && kind !== name) {
    await renameSectionKind(eventId, kind, name, {
      setSourceTemplateId: template.id,
    });
  } else {
    // 改名しない場合も、以後の編集検知（枠名を「◯◯（編集済み）」にする判定）のため
    // 「いまはテンプレートのまま」の印だけ付けておく。
    await prisma.checklistItem.updateMany({
      where: { eventId, kind, isSuggested: false },
      data: { sourceTemplateId: template.id },
    });
  }

  revalidateAppViews(eventId);
}

/**
 * 学習内容ページから、名前を付けたリストを新規作成する。
 * - 枠: `customKind` があればそれを新しい枠キーに（表示名＝キー）。無ければ task/belonging。
 * - `tidy=1` のときは自由文（音声入力含む）を AI で項目に整えてから作る。それ以外は行分割。
 */
export async function createListTemplate(formData: FormData): Promise<void> {
  const userId = await requireUserId();
  const customKind = String(formData.get("customKind") ?? "")
    .trim()
    .slice(0, 24);
  const kind = customKind
    ? sectionKeyFromLabel(customKind)
    : readKind(formData.get("kind"));
  const name = String(formData.get("name") ?? "")
    .trim()
    .slice(0, 60);
  if (!name) return;

  const bulk = String(formData.get("bulkText") ?? "");
  const titles =
    String(formData.get("tidy") ?? "") === "1"
      ? await (await import("@/lib/tidy-list")).tidyListItems(bulk)
      : parseBulkTitles(bulk);

  await prisma.listTemplate.upsert({
    where: { userId_kind_name: { userId, kind, name } },
    update: {
      items: {
        deleteMany: {},
        create: titles.map((title, i) => ({ kind, title, sortOrder: i })),
      },
    },
    create: {
      userId,
      kind,
      name,
      items: {
        create: titles.map((title, i) => ({ kind, title, sortOrder: i })),
      },
    },
  });

  revalidateAppViews();
}

/** 名前を付けたリストの中身を丸ごと置き換える（学習内容ページのエディタから）。 */
export async function saveTemplateItems(
  templateId: string,
  items: { title: string; notifyLeadMinutes: number | null }[],
): Promise<void> {
  const userId = await requireUserId();
  const template = await prisma.listTemplate.findFirst({
    where: { id: templateId, userId },
    select: { id: true, kind: true },
  });
  if (!template) return;

  const clean = items
    .map((it) => ({
      title: it.title.trim().slice(0, 120),
      notifyLeadMinutes:
        typeof it.notifyLeadMinutes === "number" && it.notifyLeadMinutes > 0
          ? Math.round(it.notifyLeadMinutes)
          : null,
    }))
    .filter((it) => it.title);

  await prisma.$transaction([
    prisma.listTemplateItem.deleteMany({ where: { templateId } }),
    prisma.listTemplateItem.createMany({
      data: clean.map((it, i) => ({
        templateId,
        kind: template.kind,
        title: it.title,
        notifyLeadMinutes: it.notifyLeadMinutes,
        sortOrder: i,
      })),
    }),
    prisma.listTemplate.update({
      where: { id: templateId },
      data: { updatedAt: new Date() },
    }),
  ]);

  revalidateAppViews();
}

/**
 * 名前付きマニュアルの編集画面（TemplateEditor）用: 自由文（スマホのマイクキーで
 * 音声入力した話し言葉のままでもよい）を AI で項目名の配列に整える。
 * DB へは書かない（呼び出し側が saveTemplateItems で保存する）。
 */
export async function tidyTemplateBulkText(text: string): Promise<string[]> {
  await requireUserId();
  const { tidyListItems } = await import("@/lib/tidy-list");
  return tidyListItems(text);
}

/** 名前を付けたリストに、一括貼り付けで項目を追記する。 */
export async function addTemplateItemsBulk(formData: FormData): Promise<void> {
  const userId = await requireUserId();
  const templateId = String(formData.get("templateId") ?? "");
  const titles = parseBulkTitles(String(formData.get("bulkText") ?? ""));
  if (!templateId || titles.length === 0) return;

  const template = await prisma.listTemplate.findFirst({
    where: { id: templateId, userId },
    include: { items: { select: { title: true, sortOrder: true } } },
  });
  if (!template) return;

  const existing = new Set(template.items.map((i) => normTitle(i.title)));
  let sort = template.items.reduce((m, i) => Math.max(m, i.sortOrder + 1), 0);
  const fresh = titles.filter((t) => !existing.has(normTitle(t)));
  if (fresh.length === 0) return;

  await prisma.listTemplateItem.createMany({
    data: fresh.map((title) => ({
      templateId,
      kind: template.kind,
      title,
      sortOrder: sort++,
    })),
  });
  await prisma.listTemplate.update({
    where: { id: templateId },
    data: { updatedAt: new Date() },
  });

  revalidateAppViews();
}

/**
 * スマホのキーボードのマイクで話した自由文を AI で振り分け、
 * 準備すること・持ち物・必要な枠 に分けて予定の準備リストへ追加する。
 */
export async function buildListFromDictation(input: {
  eventId: string;
  text: string;
}): Promise<{
  ok: boolean;
  added: number;
  summary?: string;
  error?: string;
}> {
  const userId = await requireUserId();
  const eventId = String(input.eventId ?? "");
  const text = String(input.text ?? "").slice(0, 4000).trim();
  if (!text) return { ok: false, added: 0, error: "内容がありません。" };
  trackEvent(userId, "feature:dictation");

  const event = await prisma.event.findFirst({
    where: { id: eventId, userId },
    select: {
      id: true,
      title: true,
      memo: true,
      eventDatetime: true,
      endDatetime: true,
      categoryId: true,
      listCleared: true,
      category: { select: { name: true } },
    },
  });
  if (!event) return { ok: false, added: 0, error: "予定が見つかりません。" };

  const { splitDictationIntoList } = await import("@/lib/dictation-to-list");
  let parsed;
  try {
    parsed = await splitDictationIntoList(text, {
      title: event.title,
      categoryName: event.category?.name ?? "その他",
    });
  } catch (e) {
    console.error("[buildListFromDictation] 失敗", e);
    return {
      ok: false,
      added: 0,
      error: "うまく振り分けられませんでした。少し短くして試してみてください。",
    };
  }

  const seeds: SeedItem[] = [
    ...parsed.task.map((t) => ({
      kind: "task",
      title: t,
      notifyLeadMinutes: null,
    })),
    ...parsed.belonging.map((t) => ({
      kind: "belonging",
      title: t,
      notifyLeadMinutes: null,
    })),
    ...parsed.sections.flatMap((s) => {
      const kind = sectionKeyFromLabel(s.name);
      return s.items.map((t) => ({ kind, title: t, notifyLeadMinutes: null }));
    }),
  ];
  if (seeds.length === 0) {
    return {
      ok: false,
      added: 0,
      error: "追加できる項目が見つかりませんでした。",
    };
  }

  // 全消し状態なら解除してから足す
  if (event.listCleared) {
    await prisma.event.update({
      where: { id: eventId },
      data: { listCleared: false },
    });
  }

  const added = await addSeedItemsToEvent(userId, eventId, seeds);

  const parts: string[] = [];
  if (parsed.task.length) parts.push(`準備 ${parsed.task.length}`);
  if (parsed.belonging.length) parts.push(`持ち物 ${parsed.belonging.length}`);
  for (const s of parsed.sections) {
    if (s.items.length) parts.push(`${s.name} ${s.items.length}`);
  }

  return {
    ok: true,
    added,
    summary:
      added > 0
        ? `${added}件を追加しました（${parts.join(" / ")}）。`
        : "すべて登録済みでした。",
  };
}

/** 保存済みテンプレートを予定の準備リストに追加する。 */
export async function applyTemplateToEvent(formData: FormData): Promise<void> {
  const userId = await requireUserId();
  const eventId = String(formData.get("eventId") ?? "");
  const templateId = String(formData.get("templateId") ?? "");
  if (!eventId || !templateId) return;

  const template = await prisma.listTemplate.findFirst({
    where: { id: templateId, userId },
    include: { items: { orderBy: { sortOrder: "asc" } } },
  });
  if (!template) return;
  trackEvent(userId, "feature:template-apply");

  // 「マニュアルから追加」は、元のテンプレートの枠（task/belonging を含む）に関わらず、
  // 常にテンプレート名そのものを枠名にして、独立した別枠として追加する（ユーザー指示）。
  // 「準備すること」「持ち物」で押しても、そこには混ざらずテンプレート名の新しい枠ができる。
  // sourceTemplateId を付けておくと、あとでこの枠の中身が編集されたとき
  // 「◯◯（編集済み）」に改名する判定に使える。
  await addSeedItemsToEvent(
    userId,
    eventId,
    template.items.map((it) => ({
      kind: template.name,
      title: it.title,
      notifyLeadMinutes: it.notifyLeadMinutes ?? null,
      sourceTemplateId: template.id,
    })),
  );
  revalidateAppViews(eventId);
}

/** 他の（過去の）予定の準備リストを、この予定にコピーする。 */
export async function copyListFromEvent(formData: FormData): Promise<void> {
  const userId = await requireUserId();
  const eventId = String(formData.get("eventId") ?? "");
  const sourceEventId = String(formData.get("sourceEventId") ?? "");
  const rawKind = formData.get("kind");
  const onlyKind = rawKind != null ? String(rawKind) : null; // 枠キー（組み込み or ユーザー枠名）
  const filterByKind = onlyKind != null; // 指定があればその枠だけ
  if (!eventId || !sourceEventId || eventId === sourceEventId) return;

  const source = await prisma.event.findFirst({
    where: { id: sourceEventId, userId },
    include: {
      checklistItems: {
        where: { isSuggested: false },
        orderBy: { sortOrder: "asc" },
        select: {
          kind: true,
          title: true,
          notifyLeadMinutes: true,
          sourceTemplateId: true,
        },
      },
    },
  });
  if (!source) return;
  trackEvent(userId, "feature:copy-from-event");

  // コピー元の項目がさらに名前付きリスト由来なら、その紐付けも引き継ぐ
  // （そのままコピーしただけ＝「そのまま使っている」ため）。
  const picked = source.checklistItems
    .map((it) => ({
      kind: it.kind,
      title: it.title,
      notifyLeadMinutes: it.notifyLeadMinutes ?? null,
      sourceTemplateId: it.sourceTemplateId,
    }))
    .filter((it) => !filterByKind || it.kind === onlyKind);

  await addSeedItemsToEvent(userId, eventId, picked);
  revalidateAppViews(eventId);
}

/** テンプレートの名前を変更する。 */
export async function renameListTemplate(formData: FormData): Promise<void> {
  const userId = await requireUserId();
  const id = String(formData.get("id") ?? "");
  const name = String(formData.get("name") ?? "")
    .trim()
    .slice(0, 60);
  if (!id || !name) return;
  await prisma.listTemplate.updateMany({ where: { id, userId }, data: { name } });
  revalidateAppViews();
}

/** テンプレートが入る枠（準備すること／持ち物）を変更する。中の項目の kind も揃える。 */
export async function setListTemplateKind(formData: FormData): Promise<void> {
  const userId = await requireUserId();
  const id = String(formData.get("id") ?? "");
  const kind =
    String(formData.get("kind") ?? "") === "belonging" ? "belonging" : "task";
  if (!id) return;

  const tpl = await prisma.listTemplate.findFirst({
    where: { id, userId },
    select: { id: true, kind: true, name: true },
  });
  if (!tpl || tpl.kind === kind) return;

  // 同じ枠に同名があると @@unique([userId, kind, name]) に触れる。そのときだけ
  // 名前に枠名を添えて重複を避ける。
  let name = tpl.name;
  const clash = await prisma.listTemplate.findUnique({
    where: { userId_kind_name: { userId, kind, name } },
    select: { id: true },
  });
  if (clash) {
    const label = kind === "belonging" ? "持ち物" : "準備すること";
    name = `${tpl.name}（${label}）`.slice(0, 60);
  }

  await prisma.$transaction([
    prisma.listTemplate.update({ where: { id }, data: { kind, name } }),
    prisma.listTemplateItem.updateMany({
      where: { templateId: id },
      data: { kind },
    }),
  ]);
  revalidateAppViews();
}

/** テンプレートを削除する。 */
export async function deleteListTemplate(formData: FormData): Promise<void> {
  const userId = await requireUserId();
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  await prisma.listTemplate.deleteMany({ where: { id, userId } });
  revalidateAppViews();
}

/** 名前をつけたリスト（テンプレート）を、中身ごと複製する。 */
export async function duplicateListTemplate(
  formData: FormData,
): Promise<void> {
  const userId = await requireUserId();
  const id = String(formData.get("id") ?? "");
  if (!id) return;

  const src = await prisma.listTemplate.findFirst({
    where: { id, userId },
    include: { items: { orderBy: { sortOrder: "asc" } } },
  });
  if (!src) return;

  // 同じ種類で名前が重複しないように「〜 のコピー」「〜 のコピー2」…
  let name = `${src.name} のコピー`.slice(0, 60);
  for (let n = 2; n <= 30; n++) {
    const dup = await prisma.listTemplate.findUnique({
      where: { userId_kind_name: { userId, kind: src.kind, name } },
      select: { id: true },
    });
    if (!dup) break;
    name = `${src.name} のコピー${n}`.slice(0, 60);
  }

  await prisma.listTemplate.create({
    data: {
      userId,
      kind: src.kind,
      name,
      sourceEventId: src.sourceEventId,
      items: {
        create: src.items.map((it, i) => ({
          kind: src.kind,
          title: it.title,
          notifyLeadMinutes: it.notifyLeadMinutes,
          sortOrder: i,
        })),
      },
    },
  });
  revalidateAppViews();
}
