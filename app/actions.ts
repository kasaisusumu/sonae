"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { prisma } from "@/lib/prisma";
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
  ensureChecklistForEvent,
  generateAndSaveChecklist,
} from "@/lib/checklist";
import {
  recordEdit,
  confirmRule,
  contradictRule,
  type GeneratedItem,
} from "@/lib/learning";
import { extractEventFeature } from "@/lib/features";
import { featureSignature } from "@/lib/signature";

async function requireUserId(): Promise<string> {
  const userId = await getSessionUserId();
  if (!userId) redirect("/");
  return userId;
}

function parseYen(raw: FormDataEntryValue | null): number {
  const n = Math.round(Number(String(raw ?? "").replace(/[^\d.-]/g, "")));
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

/** アプリで能動的に触った予定は、以後の自動管理（説明欄同期）の対象にする。 */
function markAutoManaged(eventId: string) {
  return prisma.event.updateMany({
    where: { id: eventId, autoManaged: false },
    data: { autoManaged: true },
  });
}

/**
 * チェックリスト・失敗ログ・カテゴリを変えたとき、影響しうる画面をまとめて再検証する。
 * （ホーム＝節約ダッシュボード、予定一覧、予定詳細、失敗ログ、学習の樹形図＝/savings）
 */
function revalidateAppViews(eventId?: string) {
  revalidatePath("/");
  revalidatePath("/events");
  revalidatePath("/failures");
  revalidatePath("/savings");
  if (eventId) revalidatePath(`/events/${eventId}`);
  revalidatePath("/events/[id]", "page");
}

export async function logout(): Promise<void> {
  await clearSession();
  redirect("/");
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

  await syncAndNotify(userId);
  await ensureWatch(userId).catch(() => {});

  revalidatePath("/events");
  revalidatePath("/");
  revalidatePath("/settings");
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

  const category = await getOrCreateCategory(userId, categoryName);
  await prisma.event.update({
    where: { id: eventId },
    data: { categoryId: category.id },
  });

  revalidateAppViews(eventId);
}

/** 準備リストを再生成する（学習内容を反映）。 */
export async function regenerateChecklist(formData: FormData): Promise<void> {
  const userId = await requireUserId();
  const eventId = String(formData.get("eventId") ?? "");
  const event = await prisma.event.findFirst({ where: { id: eventId, userId } });
  if (!event) return;

  await generateAndSaveChecklist(eventId);
  await markAutoManaged(eventId);
  after(() => syncEventDescription(eventId));
  revalidateAppViews(eventId);
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
    select: { id: true, eventId: true },
  });
  if (!item) return;
  await prisma.checklistItem.update({
    where: { id: itemId },
    data: { isDone: Boolean(isDone) },
  });
  // 完了状態をカレンダー説明欄（取り消し線）にも反映
  await markAutoManaged(item.eventId);
  after(() => syncEventDescription(item.eventId));
  revalidateAppViews(item.eventId);
}

interface SaveChecklistInput {
  eventId: string;
  kind: "task" | "belonging";
  items: {
    title: string;
    timingLabel: string | null;
    comment: string | null;
    isDone: boolean;
    isUserAdded: boolean;
    // 予定開始の何分前に通知するか。null = 通知しない。
    notifyLeadMinutes: number | null;
  }[];
  removedTitles: string[];
  // 「同じ内容」としてまとめられた他の予定にも同じリストを反映する（学習ページから）
  applyToEventIds?: string[];
}

function cleanLead(v: unknown): number | null {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.min(Math.round(n), 60 * 24 * 30); // 上限 30 日
}

/** チェックリストの編集を保存し、学習ルールに反映する（種別ごと・提案項目は残す）。 */
export async function saveChecklist(input: SaveChecklistInput): Promise<void> {
  const userId = await requireUserId();
  const kind = input.kind === "belonging" ? "belonging" : "task";
  const event = await prisma.event.findFirst({
    where: { id: input.eventId, userId },
    include: { checklistItems: true },
  });
  if (!event) return;

  const cleanItems = input.items
    .map((it) => ({
      title: it.title.trim(),
      timingLabel: it.timingLabel?.trim() || null,
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
    .map((it) => ({ title: it.title, timingLabel: it.timingLabel }));
  const retimed: { title: string; timingLabel: string }[] = [];
  const renotified: { title: string; leadMinutes: number | null }[] = [];
  for (const it of cleanItems) {
    const p = prevByTitle.get(it.title);
    if (p && (p.timingLabel ?? null) !== it.timingLabel && it.timingLabel) {
      retimed.push({ title: it.title, timingLabel: it.timingLabel });
    }
    // 通知リード時間の変更、または通知付きで新規追加 → 内容とセットで学習
    const prevLead = p ? (p.notifyLeadMinutes ?? null) : null;
    if (
      (p && prevLead !== it.notifyLeadMinutes) ||
      (!p && it.notifyLeadMinutes !== null)
    ) {
      renotified.push({ title: it.title, leadMinutes: it.notifyLeadMinutes });
    }
  }

  // この種別の非提案項目だけ入れ替え（提案行・他種別は残す）
  const maxOrder = Math.max(
    0,
    ...event.checklistItems.map((c) => c.sortOrder),
  );
  await prisma.$transaction([
    prisma.checklistItem.deleteMany({
      where: { eventId: input.eventId, isSuggested: false, kind },
    }),
    prisma.checklistItem.createMany({
      data: cleanItems.map((it, i) => {
        const p = prevByTitle.get(it.title);
        const leadUnchanged =
          p && (p.notifyLeadMinutes ?? null) === it.notifyLeadMinutes;
        return {
          eventId: input.eventId,
          kind,
          title: it.title,
          timingLabel: it.timingLabel,
          comment: it.comment,
          isDone: it.isDone,
          isUserAdded: it.isUserAdded,
          notifyLeadMinutes: it.notifyLeadMinutes,
          // リード時間が変わっていなければ送信済みフラグを引き継ぐ（再送しない）
          notifiedAt: leadUnchanged ? (p?.notifiedAt ?? null) : null,
          sortOrder: (kind === "belonging" ? maxOrder + 1 : 0) + i,
        };
      }),
    }),
  ]);

  if (
    event.categoryId &&
    (removed.length || added.length || retimed.length || renotified.length)
  ) {
    await recordEdit({
      eventId: event.id,
      categoryId: event.categoryId,
      itemKind: kind,
      feature: extractEventFeature({
        title: event.title,
        memo: event.memo,
        eventDatetime: event.eventDatetime,
        endDatetime: event.endDatetime,
      }),
      removed,
      added,
      retimed,
      renotified,
    });
  }

  await markAutoManaged(input.eventId);
  after(() => syncEventDescription(input.eventId));

  // まとめ表示された他の予定にも、同じ内容（非提案項目）をコピーする
  const siblingIds = [...new Set(input.applyToEventIds ?? [])].filter(
    (id) => id && id !== input.eventId,
  );
  if (siblingIds.length > 0) {
    const sibs = await prisma.event.findMany({
      where: { id: { in: siblingIds }, userId },
      select: { id: true },
    });
    for (const sib of sibs) {
      await prisma.$transaction([
        prisma.checklistItem.deleteMany({
          where: { eventId: sib.id, isSuggested: false, kind },
        }),
        prisma.checklistItem.createMany({
          data: cleanItems.map((it, i) => ({
            eventId: sib.id,
            kind,
            title: it.title,
            timingLabel: it.timingLabel,
            comment: it.comment,
            isDone: it.isDone,
            isUserAdded: it.isUserAdded,
            notifyLeadMinutes: it.notifyLeadMinutes,
            sortOrder: (kind === "belonging" ? 1000 : 0) + i,
          })),
        }),
      ]);
      await markAutoManaged(sib.id);
      after(() => syncEventDescription(sib.id));
    }
  }

  revalidateAppViews(input.eventId);
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
        timingLabel: item.suggestionValue ?? item.timingLabel,
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

// ─────────────────────────────────────────────
// P1: 失敗ログ & 再発防止
// ─────────────────────────────────────────────

/** 「うっかり失敗」を記録する。金額は任意。特定の予定に紐づけられる。 */
export async function createFailureLog(formData: FormData): Promise<void> {
  const userId = await requireUserId();
  const description = String(formData.get("description") ?? "").trim();
  const estimatedLossYen = parseYen(formData.get("estimatedLossYen"));
  const categoryName = String(formData.get("categoryName") ?? "").trim();
  const occurredAtRaw = String(formData.get("occurredAt") ?? "").trim();
  const eventId = String(formData.get("eventId") ?? "").trim() || null;

  if (!description) return;

  const linkedEvent = eventId
    ? await prisma.event.findFirst({
        where: { id: eventId, userId },
        select: {
          id: true,
          categoryId: true,
          title: true,
          memo: true,
          eventDatetime: true,
          endDatetime: true,
        },
      })
    : null;

  const category = categoryName
    ? await getOrCreateCategory(userId, categoryName)
    : null;

  // 予定に紐づくなら、その予定の特徴シグネチャをその場で確定（学習と同じ粒度）
  const featureSig = linkedEvent
    ? featureSignature(
        extractEventFeature({
          title: linkedEvent.title,
          memo: linkedEvent.memo,
          eventDatetime: linkedEvent.eventDatetime,
          endDatetime: linkedEvent.endDatetime,
        }),
      )
    : "{}";

  await prisma.failureLog.create({
    data: {
      userId,
      categoryId: category?.id ?? linkedEvent?.categoryId ?? null,
      eventId: linkedEvent?.id ?? null,
      featureSignature: featureSig,
      description,
      estimatedLossYen,
      occurredAt: occurredAtRaw
        ? new Date(occurredAtRaw)
        : (linkedEvent?.eventDatetime ?? new Date()),
    },
  });

  revalidateAppViews(linkedEvent?.id);
}

/** 事後の警告で「今回もやってしまった」を1タップ記録（同じ内容で、この予定に紐づけて追記）。 */
export async function logRepeatedFailure(formData: FormData): Promise<void> {
  const userId = await requireUserId();
  const eventId = String(formData.get("eventId") ?? "");
  const failureLogId = String(formData.get("failureLogId") ?? "");
  if (!eventId || !failureLogId) return;

  const [event, template] = await Promise.all([
    prisma.event.findFirst({ where: { id: eventId, userId } }),
    prisma.failureLog.findFirst({ where: { id: failureLogId, userId } }),
  ]);
  if (!event || !template) return;

  // 同じ予定・同じ内容の二重記録を避ける
  const dup = await prisma.failureLog.findFirst({
    where: { userId, eventId, description: template.description },
  });
  if (!dup) {
    const featureSig = featureSignature(
      extractEventFeature({
        title: event.title,
        memo: event.memo,
        eventDatetime: event.eventDatetime,
        endDatetime: event.endDatetime,
      }),
    );
    await prisma.failureLog.create({
      data: {
        userId,
        categoryId: event.categoryId ?? template.categoryId ?? null,
        eventId: event.id,
        featureSignature: featureSig,
        description: template.description,
        estimatedLossYen: template.estimatedLossYen,
        occurredAt: event.eventDatetime,
      },
    });
  }

  revalidateAppViews(eventId);
}

/** 失敗ログを削除する。 */
export async function deleteFailureLog(formData: FormData): Promise<void> {
  const userId = await requireUserId();
  const id = String(formData.get("id") ?? "");
  await prisma.failureLog.deleteMany({ where: { id, userId } });
  revalidateAppViews();
}

/**
 * 失敗ログ 1 件の振り返り結果を切り替える。
 *   "prevented"     … 防げた → 推定損失額を 1 回だけ節約に計上。ダッシュボードに残る。
 *   "not_prevented" … 防げなかった → 計上は取り消し。ダッシュボードには出さない。
 *   "unset"         … 未選択に戻す → 計上取り消し。失敗ログ一覧で選び直す。
 * 同じボタンをもう一度押したら "unset"（トグル）。
 */
export async function setFailureOutcome(formData: FormData): Promise<void> {
  const userId = await requireUserId();
  const failureLogId = String(formData.get("failureLogId") ?? "");
  const raw = String(formData.get("outcome") ?? "");
  const outcome =
    raw === "prevented" || raw === "not_prevented" ? raw : "unset";
  if (!failureLogId) return;

  const log = await prisma.failureLog.findFirst({
    where: { id: failureLogId, userId },
    select: { id: true, eventId: true, estimatedLossYen: true },
  });
  if (!log) return;

  if (outcome === "prevented") {
    const existing = await prisma.savingsEntry.findFirst({
      where: { userId, failureLogId },
      select: { id: true },
    });
    if (!existing) {
      await prisma.savingsEntry.create({
        data: {
          userId,
          failureLogId,
          eventId: log.eventId,
          amountYen: log.estimatedLossYen,
          confirmedByUser: true,
        },
      });
    }
    await prisma.failureLog.update({
      where: { id: failureLogId },
      data: { outcome: "prevented" },
    });
  } else {
    await prisma.savingsEntry.deleteMany({ where: { userId, failureLogId } });
    await prisma.failureLog.update({
      where: { id: failureLogId },
      data: { outcome: outcome === "not_prevented" ? "not_prevented" : null },
    });
  }

  revalidateAppViews(log.eventId ?? undefined);
}

/** 予定の再発防止警告を「確認した」ことにして畳む。 */
export async function ackEventWarning(formData: FormData): Promise<void> {
  const userId = await requireUserId();
  const eventId = String(formData.get("eventId") ?? "");
  await prisma.event.updateMany({
    where: { id: eventId, userId },
    data: { failureWarningAckAt: new Date() },
  });
  revalidateAppViews(eventId);
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

  revalidateAppViews(eventId);
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
  await prisma.failureLog.updateMany({
    where: { id: failureLogId, outcome: { not: "not_prevented" } },
    data: { outcome: "prevented" },
  });

  revalidateAppViews(eventId);
}

/** 「防げた」の計上を取り消す。他に計上が残っていなければ振り返り結果も未選択に戻す。 */
export async function undoPrevented(formData: FormData): Promise<void> {
  const userId = await requireUserId();
  const eventId = String(formData.get("eventId") ?? "");
  const failureLogId = String(formData.get("failureLogId") ?? "");
  await prisma.savingsEntry.deleteMany({
    where: { userId, eventId, failureLogId },
  });
  const remaining = await prisma.savingsEntry.count({
    where: { userId, failureLogId },
  });
  if (remaining === 0) {
    await prisma.failureLog.updateMany({
      where: { id: failureLogId, outcome: "prevented" },
      data: { outcome: null },
    });
  }
  revalidateAppViews(eventId);
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
  const { sent, removed } = await sendPushToUser(userId, {
    title: "私のマネージャー：通知テスト",
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
