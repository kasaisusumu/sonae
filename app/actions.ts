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
  ensureChecklistForEvent,
  generateAndSaveChecklist,
  normTitle,
  primeNotifiedChecklists,
  propagateListToNameGroup,
  resolveNameGroupOnEdit,
} from "@/lib/checklist";
import {
  recordEdit,
  confirmRule,
  contradictRule,
  type GeneratedItem,
} from "@/lib/learning";
import { extractEventFeature } from "@/lib/features";
import { featureSignature } from "@/lib/signature";
import { parseLead } from "@/lib/lead-time";
import { parseBulkTitles } from "@/lib/bulk";
import { parseJstDate, parseJstDateTimeLocal } from "@/lib/format";
import { clusterKey } from "@/lib/failures";
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

  const category = await getOrCreateCategory(userId, categoryName);
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
 * 予定単位の「準備リストのリマインド」設定を変える（即時）。
 * leadMinutes = null で送らない。既定は 1 日前(1440)。
 */
export async function setListReminder(
  eventId: string,
  leadMinutes: number | null,
): Promise<void> {
  const userId = await requireUserId();
  const lead = cleanLead(leadMinutes);
  const res = await prisma.event.updateMany({
    where: { id: eventId, userId },
    data: {
      listReminderLeadMinutes: lead,
      listReminderNotifiedAt: null,
      // ユーザーが決めたので、以後この予定は学習で上書きしない。次の似た予定はこの値を初期値にする。
      listReminderTouchedAt: new Date(),
    },
  });
  if (res.count === 0) return;
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

  // ユーザーが足した枠なら、予定の枠順に確実に含めておく（説明欄・学習と整合）。
  const curOrder = parseSectionOrder(event.sectionOrder);
  const nextOrder =
    isBuiltinSection(kind) || curOrder.includes(kind)
      ? curOrder
      : [...curOrder, kind];

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
            kind,
            title: it.title,
            timingLabel: p ? p.timingLabel : null,
            comment: it.comment,
            isDone: it.isDone,
            isUserAdded: it.isUserAdded,
            notifyLeadMinutes: it.notifyLeadMinutes,
            // リード時間が変わっていなければ送信済みフラグを引き継ぐ（再送しない）
            notifiedAt: leadUnchanged ? (p?.notifiedAt ?? null) : null,
            sortOrder: (kind === "task" ? 0 : maxOrder + 1) + i,
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
        itemKind: kind,
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
  // 要求された順に、実在するキーだけを並べる。要求に無い既存キーは末尾へ。
  const next = [
    ...wanted.filter((k) => cur.includes(k)),
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
      occurredAt:
        (occurredAtRaw ? parseJstDate(occurredAtRaw) : null) ??
        linkedEvent?.eventDatetime ??
        new Date(),
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

/**
 * 提案（または既存）の失敗を、内容・金額・成功/失敗を選んだ上でこの予定に記録する。
 * outcome:
 *   "prevented"     … 防げた → 推定損失額を節約に計上
 *   "not_prevented" … 防げなかった
 *   ""              … まだ選ばない
 */
export async function attachFailureToEvent(formData: FormData): Promise<void> {
  const userId = await requireUserId();
  const eventId = String(formData.get("eventId") ?? "");
  const description = String(formData.get("description") ?? "").trim();
  if (!eventId || !description) return;

  const rawAmount = formData.get("estimatedLossYen");
  const estimatedLossYen = parseYen(rawAmount);
  const rawOutcome = String(formData.get("outcome") ?? "");

  // 「今回は関係ない」= この予定では以後この内容を提案しない（記録はしない）
  if (rawOutcome === "dismiss") {
    const descKey = clusterKey(description);
    if (descKey) {
      await prisma.failureDismissal.upsert({
        where: { eventId_descKey: { eventId, descKey } },
        create: { userId, eventId, descKey },
        update: {},
      });
    }
    revalidateAppViews(eventId);
    return;
  }

  const outcome =
    rawOutcome === "prevented" || rawOutcome === "not_prevented"
      ? rawOutcome
      : null;

  const event = await prisma.event.findFirst({
    where: { id: eventId, userId },
    select: {
      id: true,
      title: true,
      memo: true,
      eventDatetime: true,
      endDatetime: true,
      categoryId: true,
    },
  });
  if (!event) return;

  // 同じ内容がこの予定に既にあるなら二重記録しない
  const dup = await prisma.failureLog.findFirst({
    where: { userId, eventId, description },
    select: { id: true },
  });
  if (dup) {
    revalidateAppViews(eventId);
    return;
  }

  const featureSig = featureSignature(
    extractEventFeature({
      title: event.title,
      memo: event.memo,
      eventDatetime: event.eventDatetime,
      endDatetime: event.endDatetime,
    }),
  );

  const log = await prisma.failureLog.create({
    data: {
      userId,
      categoryId: event.categoryId,
      eventId: event.id,
      featureSignature: featureSig,
      description,
      estimatedLossYen,
      occurredAt: event.eventDatetime,
      outcome,
    },
  });

  if (outcome === "prevented") {
    await prisma.savingsEntry.upsert({
      where: { eventId_failureLogId: { eventId, failureLogId: log.id } },
      update: { amountYen: estimatedLossYen, confirmedByUser: true },
      create: {
        userId,
        eventId,
        failureLogId: log.id,
        amountYen: estimatedLossYen,
        confirmedByUser: true,
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
 *   "irrelevant"    … 今回は関係ない → 計上は取り消し。振り返り済み扱いにして一覧から下げる。
 *   "unset"         … 未選択に戻す → 計上取り消し。失敗ログ一覧で選び直す。
 * 同じボタンをもう一度押したら "unset"（トグル）。
 */
export async function setFailureOutcome(formData: FormData): Promise<void> {
  const userId = await requireUserId();
  const failureLogId = String(formData.get("failureLogId") ?? "");
  const raw = String(formData.get("outcome") ?? "");
  const outcome =
    raw === "prevented" || raw === "not_prevented" || raw === "irrelevant"
      ? raw
      : "unset";
  if (!failureLogId) return;

  // 振り返り時に金額を改めて入力・修正できる（空欄なら既存のまま）。
  const rawAmount = formData.get("estimatedLossYen");
  const hasAmount = rawAmount !== null && String(rawAmount).trim() !== "";
  const newAmount = hasAmount ? parseYen(rawAmount) : null;

  const log = await prisma.failureLog.findFirst({
    where: { id: failureLogId, userId },
    select: { id: true, eventId: true, estimatedLossYen: true },
  });
  if (!log) return;

  const amount = newAmount ?? log.estimatedLossYen;

  if (outcome === "prevented") {
    if (hasAmount) {
      await prisma.failureLog.update({
        where: { id: failureLogId },
        data: { estimatedLossYen: amount },
      });
    }
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
          amountYen: amount,
          confirmedByUser: true,
        },
      });
    } else if (hasAmount) {
      await prisma.savingsEntry.updateMany({
        where: { userId, failureLogId },
        data: { amountYen: amount },
      });
    }
    await prisma.failureLog.update({
      where: { id: failureLogId },
      data: { outcome: "prevented" },
    });
  } else {
    if (hasAmount) {
      await prisma.failureLog.update({
        where: { id: failureLogId },
        data: { estimatedLossYen: amount },
      });
    }
    await prisma.savingsEntry.deleteMany({ where: { userId, failureLogId } });
    await prisma.failureLog.update({
      where: { id: failureLogId },
      data: { outcome: outcome === "unset" ? null : outcome },
    });
  }

  revalidateAppViews(log.eventId ?? undefined);
}

/**
 * 失敗ログの推定金額を、振り返りの場であとから入力・修正する。
 * すでに「防げた」に計上済みなら、節約額の方も同じ金額へ揃える。
 */
export async function updateFailureAmount(formData: FormData): Promise<void> {
  const userId = await requireUserId();
  const failureLogId = String(formData.get("failureLogId") ?? "");
  if (!failureLogId) return;
  const amount = parseYen(formData.get("estimatedLossYen"));

  const log = await prisma.failureLog.findFirst({
    where: { id: failureLogId, userId },
    select: { id: true, eventId: true },
  });
  if (!log) return;

  await prisma.failureLog.update({
    where: { id: failureLogId },
    data: { estimatedLossYen: amount },
  });
  await prisma.savingsEntry.updateMany({
    where: { userId, failureLogId },
    data: { amountYen: amount },
  });

  revalidateAppViews(log.eventId ?? undefined);
}

/**
 * 失敗ログの内容（失敗内容・金額・日付・結果／状態）をまとめて編集する。
 * 予定ページからいつでも呼べる。結果（防げた／防げなかった／未選択）を変えたら
 * 節約ダッシュボードの計上も揃える。
 */
export async function updateFailureLog(formData: FormData): Promise<void> {
  const userId = await requireUserId();
  const id = String(formData.get("id") ?? "");
  if (!id) return;

  const log = await prisma.failureLog.findFirst({
    where: { id, userId },
    select: { id: true, eventId: true, estimatedLossYen: true },
  });
  if (!log) return;

  const description = String(formData.get("description") ?? "").trim();
  const rawAmount = formData.get("estimatedLossYen");
  const hasAmount = rawAmount !== null && String(rawAmount).trim() !== "";
  const amount = hasAmount ? parseYen(rawAmount) : null;
  const occurredAtRaw = String(formData.get("occurredAt") ?? "").trim();
  const occurredAt = occurredAtRaw ? parseJstDate(occurredAtRaw) : null;

  const rawOutcome = formData.get("outcome");
  const hasOutcome = rawOutcome !== null;
  const outcomeStr = String(rawOutcome ?? "");
  const outcome: string | null =
    outcomeStr === "prevented" ||
    outcomeStr === "not_prevented" ||
    outcomeStr === "irrelevant"
      ? outcomeStr
      : null;

  await prisma.failureLog.update({
    where: { id },
    data: {
      ...(description ? { description } : {}),
      ...(hasAmount ? { estimatedLossYen: amount! } : {}),
      ...(occurredAt ? { occurredAt } : {}),
      ...(hasOutcome ? { outcome } : {}),
    },
  });

  const effectiveAmount = hasAmount ? amount! : log.estimatedLossYen;
  if (hasAmount) {
    await prisma.savingsEntry.updateMany({
      where: { userId, failureLogId: id },
      data: { amountYen: effectiveAmount },
    });
  }

  // 結果を変えたら節約計上も合わせる（setFailureOutcome と同じ扱い）。
  if (hasOutcome) {
    if (outcome === "prevented") {
      const existing = await prisma.savingsEntry.findFirst({
        where: { userId, failureLogId: id },
        select: { id: true },
      });
      if (!existing) {
        await prisma.savingsEntry.create({
          data: {
            userId,
            failureLogId: id,
            eventId: log.eventId,
            amountYen: effectiveAmount,
            confirmedByUser: true,
          },
        });
      }
    } else {
      await prisma.savingsEntry.deleteMany({ where: { userId, failureLogId: id } });
    }
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

/** 終了後の「失敗あった？」に「なかった」と答える（undo=1 で取り消し）。 */
export async function markNoFailure(formData: FormData): Promise<void> {
  const userId = await requireUserId();
  const eventId = String(formData.get("eventId") ?? "");
  const undo = String(formData.get("undo") ?? "") === "1";
  await prisma.event.updateMany({
    where: { id: eventId, userId },
    data: { noFailureAt: undo ? null : new Date() },
  });
  revalidateAppViews(eventId);
}

/** 警告の失敗内容を、この予定の準備リストに「再発防止」項目として追加する。 */
export async function addPreventionItem(formData: FormData): Promise<void> {
  const userId = await requireUserId();
  const eventId = String(formData.get("eventId") ?? "");
  const label = String(formData.get("label") ?? "").trim();
  const notifyLeadMinutes = cleanLead(formData.get("notifyLeadMinutes")) ?? 1440;
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
      notifyLeadMinutes,
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

  // 振り返りで金額を改めて入力できる（空欄なら既存のまま）。
  const rawAmount = formData.get("estimatedLossYen");
  const hasAmount = rawAmount !== null && String(rawAmount).trim() !== "";
  const amount = hasAmount ? parseYen(rawAmount) : log.estimatedLossYen;
  if (hasAmount) {
    await prisma.failureLog.update({
      where: { id: failureLogId },
      data: { estimatedLossYen: amount },
    });
  }

  await prisma.savingsEntry.upsert({
    where: { eventId_failureLogId: { eventId, failureLogId } },
    update: { amountYen: amount, confirmedByUser: true },
    create: {
      userId,
      eventId,
      failureLogId,
      amountYen: amount,
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

// ─────────────────────────────────────────────
// 準備リストのテンプレート（名前を付けて保存・再利用）＋他の予定からコピー
// ─────────────────────────────────────────────

type TemplateSeed = {
  /** "task" / "belonging" / ユーザーが足した枠名 */
  kind: string;
  title: string;
  notifyLeadMinutes: number | null;
};

function readKind(v: unknown): "task" | "belonging" {
  return String(v ?? "") === "belonging" ? "belonging" : "task";
}

/**
 * 予定の「いま」のリストのうち、指定した種類（準備すること or 持ち物）だけを
 * 名前を付けてテンプレート保存する。テンプレートは種類ごとに分ける。
 */
export async function saveListAsTemplate(formData: FormData): Promise<void> {
  const userId = await requireUserId();
  const eventId = String(formData.get("eventId") ?? "");
  const kind = readKind(formData.get("kind"));
  const name = String(formData.get("name") ?? "")
    .trim()
    .slice(0, 60);
  if (!eventId || !name) return;

  const event = await prisma.event.findFirst({
    where: { id: eventId, userId },
    include: {
      checklistItems: {
        where: { isSuggested: false },
        orderBy: { sortOrder: "asc" },
        select: { kind: true, title: true, notifyLeadMinutes: true },
      },
    },
  });
  if (!event) return;

  const picked = event.checklistItems.filter(
    (it) => (it.kind === "belonging" ? "belonging" : "task") === kind,
  );
  if (picked.length === 0) return;

  const create = picked.map((it, i) => ({
    kind,
    title: it.title,
    notifyLeadMinutes: it.notifyLeadMinutes ?? null,
    sortOrder: i,
  }));

  await prisma.listTemplate.upsert({
    where: { userId_kind_name: { userId, kind, name } },
    update: { sourceEventId: eventId, items: { deleteMany: {}, create } },
    create: { userId, kind, name, sourceEventId: eventId, items: { create } },
  });

  revalidateAppViews(eventId);
}

/** 学習内容ページから、名前を付けたリストを新規作成する（一括貼り付け対応）。 */
export async function createListTemplate(formData: FormData): Promise<void> {
  const userId = await requireUserId();
  const kind = readKind(formData.get("kind"));
  const name = String(formData.get("name") ?? "")
    .trim()
    .slice(0, 60);
  if (!name) return;

  const titles = parseBulkTitles(String(formData.get("bulkText") ?? ""));

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

/** テンプレート／他の予定の項目を、予定の準備リストに追加する（同じ種類・同じ名前はスキップ）。 */
async function addSeedItemsToEvent(
  userId: string,
  eventId: string,
  seeds: TemplateSeed[],
): Promise<number> {
  const event = await prisma.event.findFirst({
    where: { id: eventId, userId },
    include: {
      checklistItems: { select: { kind: true, title: true, sortOrder: true } },
    },
  });
  if (!event) return 0;

  const existing = new Set(
    event.checklistItems.map((c) => `${c.kind}:${normTitle(c.title)}`),
  );
  const nextSort: Record<string, number> = {};
  for (const c of event.checklistItems) {
    nextSort[c.kind] = Math.max(nextSort[c.kind] ?? 0, c.sortOrder + 1);
  }

  const fresh = seeds.filter(
    (s) => s.title.trim() && !existing.has(`${s.kind}:${normTitle(s.title)}`),
  );
  if (fresh.length === 0) return 0;

  const data = fresh.map((s) => {
    const so = nextSort[s.kind] ?? 0;
    nextSort[s.kind] = so + 1;
    return {
      eventId,
      kind: s.kind,
      title: s.title.trim().slice(0, 120),
      notifyLeadMinutes: s.notifyLeadMinutes,
      isUserAdded: true,
      sortOrder: so,
    };
  });

  // コピー元にあってこの予定の枠順に無いユーザー枠は、枠順にも足す
  const order = parseSectionOrder(event.sectionOrder);
  const missing = [
    ...new Set(
      fresh
        .map((s) => s.kind)
        .filter((k) => !isBuiltinSection(k) && !order.includes(k)),
    ),
  ];

  await prisma.$transaction([
    prisma.checklistItem.createMany({ data }),
    ...(missing.length
      ? [
          prisma.event.update({
            where: { id: eventId },
            data: {
              sectionOrder: stringifySectionOrder([...order, ...missing]),
            },
          }),
        ]
      : []),
  ]);

  await markAutoManaged(eventId);
  const twinIds = await resolveNameGroupOnEdit(eventId);
  after(() => {
    void syncEventDescription(eventId);
    for (const id of twinIds) void syncEventDescription(id);
  });
  revalidateAppViews(eventId);
  return fresh.length;
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

  await addSeedItemsToEvent(
    userId,
    eventId,
    template.items.map((it) => ({
      kind: it.kind === "belonging" ? "belonging" : "task",
      title: it.title,
      notifyLeadMinutes: it.notifyLeadMinutes ?? null,
    })),
  );
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
        select: { kind: true, title: true, notifyLeadMinutes: true },
      },
    },
  });
  if (!source) return;

  const picked = source.checklistItems
    .map((it) => ({
      kind: it.kind,
      title: it.title,
      notifyLeadMinutes: it.notifyLeadMinutes ?? null,
    }))
    .filter((it) => !filterByKind || it.kind === onlyKind);

  await addSeedItemsToEvent(userId, eventId, picked);
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
