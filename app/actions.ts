"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { clearSession, getSessionUserId } from "@/lib/session";
import {
  getOrCreateCategory,
  resolveCategoryForEvent,
} from "@/lib/categories";
import { syncUserCalendar } from "@/lib/sync";
import { sendPushToUser } from "@/lib/push";
import {
  ensureChecklistForEvent,
  generateAndSaveChecklist,
  replaceChecklistItems,
} from "@/lib/checklist";
import { updateLearningFromEdits, type GeneratedItem } from "@/lib/learning";

async function requireUserId(): Promise<string> {
  const userId = await getSessionUserId();
  if (!userId) redirect("/");
  return userId;
}

function parseYen(raw: FormDataEntryValue | null): number {
  const n = Math.round(Number(String(raw ?? "").replace(/[^\d.-]/g, "")));
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

export async function logout(): Promise<void> {
  await clearSession();
  redirect("/");
}

/** Google 連携を解除する（トークンを削除）。予定データは残す。 */
export async function disconnectGoogle(): Promise<void> {
  const userId = await requireUserId();
  await prisma.userGoogleAccount.deleteMany({ where: { userId } });
  revalidatePath("/settings");
  revalidatePath("/events");
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

/** Google カレンダーから予定を取り込む（手動同期ボタン）。 */
export async function syncCalendar(): Promise<void> {
  const userId = await requireUserId();
  const account = await prisma.userGoogleAccount.findUnique({ where: { userId } });
  if (!account) redirect("/settings");

  const result = await syncUserCalendar(userId);

  // 初回取り込みでは大量に通知が飛ぶため送らない。以降の新規予定のみ通知。
  if (!result.isFirstSync) {
    for (const ev of result.newEvents) {
      await sendPushToUser(userId, {
        title: "新しい予定が追加されました",
        body: `「${ev.title}」の準備リストを確認しましょう`,
        url: `/events/${ev.id}`,
        tag: `event-${ev.id}`,
      });
    }
  }

  revalidatePath("/events");
  revalidatePath("/");
}

/** 手動で予定を登録し、準備リストを生成する。 */
export async function createManualEvent(formData: FormData): Promise<void> {
  const userId = await requireUserId();

  const title = String(formData.get("title") ?? "").trim();
  const datetimeRaw = String(formData.get("eventDatetime") ?? "").trim();
  const memo = String(formData.get("memo") ?? "").trim() || null;
  const categoryName = String(formData.get("categoryName") ?? "").trim();

  if (!title || !datetimeRaw) redirect("/events?error=missing");

  // カテゴリ未指定なら自動判定（キーワード→AIで新カテゴリも作られる）
  const category = categoryName
    ? await getOrCreateCategory(userId, categoryName)
    : await resolveCategoryForEvent(userId, title, memo);
  const event = await prisma.event.create({
    data: {
      userId,
      categoryId: category.id,
      title,
      eventDatetime: new Date(datetimeRaw),
      memo,
      source: "manual",
    },
  });

  await generateAndSaveChecklist(event.id);
  revalidatePath("/events");
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

  const category = await getOrCreateCategory(userId, categoryName);
  await prisma.event.update({
    where: { id: eventId },
    data: { categoryId: category.id },
  });

  revalidatePath("/events");
  revalidatePath(`/events/${eventId}`);
}

/** 準備リストを再生成する（学習内容を反映）。 */
export async function regenerateChecklist(formData: FormData): Promise<void> {
  const userId = await requireUserId();
  const eventId = String(formData.get("eventId") ?? "");
  const event = await prisma.event.findFirst({ where: { id: eventId, userId } });
  if (!event) return;

  await generateAndSaveChecklist(eventId);
  revalidatePath(`/events/${eventId}`);
}

/** 予定詳細を開いたときに、未生成なら準備リストを生成する。 */
export async function ensureChecklist(eventId: string): Promise<void> {
  const userId = await requireUserId();
  const event = await prisma.event.findFirst({ where: { id: eventId, userId } });
  if (!event) return;
  await ensureChecklistForEvent(eventId);
}

/** チェック（完了）の即時トグル。詳細ページは再描画せず、一覧の集計だけ更新。 */
export async function toggleChecklistItemDone(
  itemId: string,
  isDone: boolean,
): Promise<void> {
  const userId = await requireUserId();
  const item = await prisma.checklistItem.findFirst({
    where: { id: itemId, event: { userId } },
    select: { id: true },
  });
  if (!item) return;
  await prisma.checklistItem.update({
    where: { id: itemId },
    data: { isDone: Boolean(isDone) },
  });
  revalidatePath("/events");
  revalidatePath("/");
}

interface SaveChecklistInput {
  eventId: string;
  items: {
    title: string;
    timingLabel: string | null;
    isDone: boolean;
    isUserAdded: boolean;
  }[];
  removedTitles: string[];
}

/** チェックリストの編集を保存し、カテゴリ学習に反映する（自分マニュアル）。 */
export async function saveChecklist(input: SaveChecklistInput): Promise<void> {
  const userId = await requireUserId();
  const event = await prisma.event.findFirst({
    where: { id: input.eventId, userId },
    include: { checklistItems: true },
  });
  if (!event) return;

  const cleanItems = input.items
    .map((it) => ({
      title: it.title.trim(),
      timingLabel: it.timingLabel?.trim() || null,
      isDone: Boolean(it.isDone),
      isUserAdded: Boolean(it.isUserAdded),
    }))
    .filter((it) => it.title.length > 0);

  // 学習用の差分を計算
  const prevByTitle = new Map(
    event.checklistItems.map((c) => [c.title.trim(), c]),
  );
  const added: GeneratedItem[] = cleanItems
    .filter((it) => it.isUserAdded || !prevByTitle.has(it.title))
    .map((it) => ({ title: it.title, timingLabel: it.timingLabel }));
  const retimed: { title: string; timingLabel: string }[] = [];
  for (const it of cleanItems) {
    const prev = prevByTitle.get(it.title);
    if (prev && (prev.timingLabel ?? null) !== it.timingLabel && it.timingLabel) {
      retimed.push({ title: it.title, timingLabel: it.timingLabel });
    }
  }

  await replaceChecklistItems(input.eventId, cleanItems);

  if (event.categoryId) {
    await updateLearningFromEdits(event.categoryId, {
      removed: input.removedTitles.filter(Boolean),
      added,
      retimed,
    });
  }

  revalidatePath(`/events/${input.eventId}`);
  revalidatePath("/events");
}

// ─────────────────────────────────────────────
// P1: 失敗ログ & 再発防止
// ─────────────────────────────────────────────

/** 「うっかり失敗」を記録する。 */
export async function createFailureLog(formData: FormData): Promise<void> {
  const userId = await requireUserId();
  const description = String(formData.get("description") ?? "").trim();
  const estimatedLossYen = parseYen(formData.get("estimatedLossYen"));
  const categoryName = String(formData.get("categoryName") ?? "").trim();
  const occurredAtRaw = String(formData.get("occurredAt") ?? "").trim();

  if (!description) redirect("/failures?error=missing");

  const category = categoryName
    ? await getOrCreateCategory(userId, categoryName)
    : null;

  await prisma.failureLog.create({
    data: {
      userId,
      categoryId: category?.id ?? null,
      description,
      estimatedLossYen,
      occurredAt: occurredAtRaw ? new Date(occurredAtRaw) : new Date(),
    },
  });

  revalidatePath("/failures");
  revalidatePath("/");
  revalidatePath("/events");
}

/** 失敗ログを削除する。 */
export async function deleteFailureLog(formData: FormData): Promise<void> {
  const userId = await requireUserId();
  const id = String(formData.get("id") ?? "");
  await prisma.failureLog.deleteMany({ where: { id, userId } });
  revalidatePath("/failures");
  revalidatePath("/");
}

/** 予定の再発防止警告を「確認した」ことにして畳む。 */
export async function ackEventWarning(formData: FormData): Promise<void> {
  const userId = await requireUserId();
  const eventId = String(formData.get("eventId") ?? "");
  await prisma.event.updateMany({
    where: { id: eventId, userId },
    data: { failureWarningAckAt: new Date() },
  });
  revalidatePath(`/events/${eventId}`);
  revalidatePath("/");
}

/** 警告の失敗内容を、この予定の準備リストに「再発防止」項目として追加する。 */
export async function addPreventionItem(formData: FormData): Promise<void> {
  const userId = await requireUserId();
  const eventId = String(formData.get("eventId") ?? "");
  const label = String(formData.get("label") ?? "").trim();
  const timingLabel = String(formData.get("timingLabel") ?? "前日").trim() || null;
  if (!label) return;

  const event = await prisma.event.findFirst({ where: { id: eventId, userId } });
  if (!event) return;

  const max = await prisma.checklistItem.aggregate({
    where: { eventId },
    _max: { sortOrder: true },
  });

  await prisma.checklistItem.create({
    data: {
      eventId,
      title: `【再発防止】${label}`,
      timingLabel,
      isUserAdded: true,
      sortOrder: (max._max.sortOrder ?? -1) + 1,
    },
  });

  revalidatePath(`/events/${eventId}`);
}

/** 「これは防げた」と自己申告し、推定損失額を節約に計上する。 */
export async function markPrevented(formData: FormData): Promise<void> {
  const userId = await requireUserId();
  const eventId = String(formData.get("eventId") ?? "");
  const failureLogId = String(formData.get("failureLogId") ?? "");
  if (!eventId || !failureLogId) return;

  const [event, log] = await Promise.all([
    prisma.event.findFirst({ where: { id: eventId, userId } }),
    prisma.failureLog.findFirst({ where: { id: failureLogId, userId } }),
  ]);
  if (!event || !log) return;

  await prisma.savingsEntry.upsert({
    where: { eventId_failureLogId: { eventId, failureLogId } },
    update: { amountYen: log.estimatedLossYen, confirmedByUser: true },
    create: {
      userId,
      eventId,
      failureLogId,
      amountYen: log.estimatedLossYen,
      confirmedByUser: true,
    },
  });

  revalidatePath(`/events/${eventId}`);
  revalidatePath("/savings");
  revalidatePath("/");
}

/** 「防げた」の計上を取り消す。 */
export async function undoPrevented(formData: FormData): Promise<void> {
  const userId = await requireUserId();
  const eventId = String(formData.get("eventId") ?? "");
  const failureLogId = String(formData.get("failureLogId") ?? "");
  await prisma.savingsEntry.deleteMany({
    where: { userId, eventId, failureLogId },
  });
  revalidatePath(`/events/${eventId}`);
  revalidatePath("/savings");
  revalidatePath("/");
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

/** 設定画面から「テスト通知を送る」。 */
export async function sendTestPush(): Promise<void> {
  const userId = await requireUserId();
  await sendPushToUser(userId, {
    title: "そなえ：通知テスト",
    body: "予定が追加されると、このように通知が届きます。",
    url: "/",
  });
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
