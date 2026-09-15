import Link from "next/link";
import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { ensureChecklistForEvent, normTitle } from "@/lib/checklist";
import { syncEventDescription } from "@/lib/description-sync";
import { extractEventFeature } from "@/lib/features";
import { getApplicableRules } from "@/lib/learning";
import { getWarningForEvent, ensureSuggestedFailures } from "@/lib/failures";
import { refreshEventFromGoogle } from "@/lib/sync";
import { getEventsWithLists, getUserTemplates } from "@/lib/templates";
import { formatDateOnly } from "@/lib/format";
import { parseLeads } from "@/lib/lead-time";
import {
  markListReviewed,
  generateChecklistForEvent,
  markNoFailure,
} from "@/app/actions";
import {
  FAILURE_LOG_KEY,
  isBuiltinSection,
  resolveSections,
  sectionLabel,
} from "@/lib/sections";
import { InfoHint } from "@/app/components/info-hint";
import { ChecklistEditor } from "./checklist-editor";
import {
  FailureListEditor,
  type FLOther,
  type FLRow,
} from "./failure-list-editor";
import { WarningPanel } from "./warning-panel";
import { ListReminderControl } from "./list-reminder-control";
import { AddSectionButton } from "./section-manager";
import { SectionList, type SectionEntry } from "./section-list";
import { DictationInput } from "./dictation-input";
import { FailureDictationInput } from "@/app/failures/failure-dictation-input";
import { SubmitButton } from "@/app/components/submit-button";

type TplOpt = { id: string; name: string };
type PastOpt = { id: string; label: string; count: number };
type ItemImg = { id: string; data: string; width: number; height: number };

type Row = {
  id: string;
  kind: string;
  title: string;
  comment: string | null;
  isDone: boolean;
  isUserAdded: boolean;
  notifyLeadMinutes: number | null;
  isSuggested: boolean;
  suggestionType: string | null;
  suggestionValue: string | null;
};

function KindBlock({
  eventId,
  kind,
  label,
  rows,
  templates,
  pastEvents,
  imagesBySlot,
}: {
  eventId: string;
  kind: string;
  label: string;
  rows: Row[];
  templates: TplOpt[];
  pastEvents: PastOpt[];
  imagesBySlot: Map<string, ItemImg[]>;
}) {
  const mine = rows.filter((r) => r.kind === kind);
  const normal = mine.filter((r) => !r.isSuggested);

  return (
    <div className="space-y-2">
      <ChecklistEditor
        eventId={eventId}
        kind={kind}
        label={label}
        templates={templates}
        pastEvents={pastEvents}
        initialItems={normal.map((c) => ({
          id: c.id,
          title: c.title,
          comment: c.comment,
          isDone: c.isDone,
          isUserAdded: c.isUserAdded,
          notifyLeadMinutes: c.notifyLeadMinutes,
          images: imagesBySlot.get(normTitle(c.title)) ?? [],
        }))}
      />
    </div>
  );
}

export async function ChecklistSection({
  event,
}: {
  event: {
    id: string;
    userId: string;
    title: string;
    memo: string | null;
    eventDatetime: Date;
    endDatetime: Date | null;
    categoryId: string | null;
    recurringEventId: string | null;
    failureWarningAckAt: Date | null;
    listReminderLeads: string;
    // 連携時に取り込んだ既存の予定は false。この間は開いても自動生成しない
    // （下の「準備リストを作る」ボタンを押したときだけ生成する）。
    autoManaged: boolean;
    category: { name: string } | null;
  };
}) {
  // Google からの取り直し（説明欄の直接編集の取り込み）は、描画をブロックしない。
  // レスポンス後に走らせ、変化があれば次の読み込み・LiveSync の更新で反映する。
  // 以前はここで await していて、開くたびに Google API 往復ぶん待たされていた。
  after(async () => {
    const changed = await refreshEventFromGoogle(event.id);
    if (changed) revalidatePath(`/events/${event.id}`);
  });

  const itemsAndFlag = await Promise.all([
    prisma.checklistItem.findMany({
      where: { eventId: event.id },
      orderBy: { sortOrder: "asc" },
    }),
    prisma.event.findUnique({
      where: { id: event.id },
      select: { listCleared: true },
    }),
  ]);
  let items = itemsAndFlag[0];
  const listCleared = itemsAndFlag[1]?.listCleared ?? false;
  const needsGeneration = items.length === 0 && !listCleared;
  // 連携時に取り込んだ既存の予定（autoManaged=false）は、開いただけでは自動生成
  // しない（ユーザー指定）。それ以外（新規に追加された予定・手動追加）は今まで
  // 通り、開いた瞬間に生成する。
  const needsManualGenerate = needsGeneration && !event.autoManaged;
  // ユーザーが意図的に全部消した予定は、二度と自動生成・自動提案しない。
  if (needsGeneration && event.autoManaged) {
    await ensureChecklistForEvent(event.id);
    items = await prisma.checklistItem.findMany({
      where: { eventId: event.id },
      orderBy: { sortOrder: "asc" },
    });
    after(() => syncEventDescription(event.id));
  }

  // 失敗ログ（考えられる失敗）。以前は <Suspense> で別コンポーネントに切り出して
  // いたが、自動保存のたびの再検証でその Suspense 境界だけ再サスペンドし、
  // 中の FailureListEditor がまるごと作り直されて開閉状態が消える不具合が
  // あったため、ChecklistSection 本体の非同期処理に統合した（ChecklistEditor と
  // 同じ扱いにして、他の枠と同じく再検証をまたいで状態が保たれるようにする）。
  if (!needsManualGenerate) {
    await ensureSuggestedFailures(event.id, event.userId);
  }
  const [linkedFailures, otherFailures, failureEv] = await Promise.all([
    prisma.failureLog.findMany({
      where: { userId: event.userId, eventId: event.id },
      orderBy: { occurredAt: "desc" },
      select: {
        id: true,
        description: true,
        outcome: true,
        countermeasure: true,
        occurredAt: true,
      },
    }),
    prisma.failureLog.findMany({
      where: { userId: event.userId, eventId: { not: event.id } },
      orderBy: { occurredAt: "desc" },
      take: 80,
      select: {
        id: true,
        description: true,
        occurredAt: true,
        event: { select: { title: true } },
      },
    }),
    prisma.event.findFirst({
      where: { id: event.id, userId: event.userId },
      select: { eventDatetime: true, endDatetime: true, noFailureAt: true },
    }),
  ]);
  const linkedFailureDesc = new Set(
    linkedFailures.map((l) => l.description.trim()),
  );
  const otherFailureCandidates: FLOther[] = otherFailures
    .filter((o) => !linkedFailureDesc.has(o.description.trim()))
    .map((o) => ({
      id: o.id,
      description: o.description,
      occurredAt: o.occurredAt,
      eventTitle: o.event?.title ?? null,
    }));
  const failureIsPast =
    !!failureEv &&
    (failureEv.endDatetime ?? failureEv.eventDatetime) <= new Date();
  const askFailureOutcome = failureIsPast && linkedFailures.length === 0;
  const failureLogNode = (
    <div id="failure-check" className="scroll-mt-4 space-y-2">
      {askFailureOutcome &&
        (failureEv?.noFailureAt ? (
          <div className="flex flex-wrap items-center gap-2 rounded-xl bg-surface-muted p-3 text-xs text-muted">
            <span>「失敗はなかった」で記録済み。</span>
            <form action={markNoFailure}>
              <input type="hidden" name="eventId" value={event.id} />
              <input type="hidden" name="undo" value="1" />
              <button type="submit" className="underline hover:text-foreground">
                取り消す
              </button>
            </form>
          </div>
        ) : (
          <div className="rounded-xl border border-border bg-surface-muted p-3">
            <p className="text-xs font-medium text-foreground">
              この予定、うっかりはありましたか？
            </p>
            <p className="mt-0.5 text-[11px] text-muted">
              あったら話すか、下の「＋ 追加」で一言。なければワンタップで。
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <form action={markNoFailure}>
                <input type="hidden" name="eventId" value={event.id} />
                <SubmitButton variant="ghost">なかった 🙆</SubmitButton>
              </form>
              <FailureDictationInput eventId={event.id} />
            </div>
          </div>
        ))}

      <FailureListEditor
        eventId={event.id}
        label="考えられる失敗"
        initial={linkedFailures as FLRow[]}
        others={otherFailureCandidates}
      />
    </div>
  );

  const feature = extractEventFeature({
    title: event.title,
    memo: event.memo,
    eventDatetime: event.eventDatetime,
    endDatetime: event.endDatetime,
  });
  const [
    warning,
    taskRules,
    belongingRules,
    reviewState,
    allTemplates,
    pastEventsRaw,
    itemImages,
  ] = await Promise.all([
    getWarningForEvent(event),
    getApplicableRules(event.categoryId, feature, "task"),
    getApplicableRules(event.categoryId, feature, "belonging"),
    prisma.event.findUnique({
      where: { id: event.id },
      select: {
        listReviewedAt: true,
        listCustomized: true,
        listReminderLeads: true,
        sectionOrder: true,
        _count: { select: { editRecords: true } },
      },
    }),
    getUserTemplates(event.userId),
    getEventsWithLists(event.userId, event.id),
    prisma.checklistItemImage.findMany({
      where: { eventId: event.id },
      orderBy: { createdAt: "asc" },
      select: { id: true, kind: true, slot: true, data: true, width: true, height: true },
    }),
  ]);
  const forced = [...taskRules, ...belongingRules].filter((r) => r.forced);
  const rows = items as unknown as Row[];

  // kind ごとに slot(正規化タイトル) → 画像配列
  const imagesByKind = new Map<string, Map<string, ItemImg[]>>();
  for (const img of itemImages) {
    let m = imagesByKind.get(img.kind);
    if (!m) {
      m = new Map();
      imagesByKind.set(img.kind, m);
    }
    const arr = m.get(img.slot) ?? [];
    arr.push({
      id: img.id,
      data: img.data,
      width: img.width,
      height: img.height,
    });
    m.set(img.slot, arr);
  }
  const EMPTY_IMG_MAP: Map<string, ItemImg[]> = new Map();
  const sections = resolveSections(
    reviewState?.sectionOrder ?? null,
    items.map((i) => i.kind),
  );
  // 「この予定の失敗ログ」もリスト枠として並べ替え対象にする。
  // まだ並べ替えたことがなければ、話して作るのすぐ下（先頭）に置く。
  const orderedKeys = sections.includes(FAILURE_LOG_KEY)
    ? sections
    : [FAILURE_LOG_KEY, ...sections];

  // ユーザーが足した枠（買うもの等）の名前付きリストも、その枠名が一致すれば拾う
  // （組み込みの2枠に限らない。「引き出す」も別枠として独立させるため）。
  const tplByKind = (k: string): TplOpt[] =>
    allTemplates
      .filter((t) => t.kind === k)
      .map((t) => ({ id: t.id, name: t.name }));
  const pastByKind = (k: "task" | "belonging"): PastOpt[] =>
    pastEventsRaw
      .map((e) => ({
        id: e.id,
        label: `${formatDateOnly(e.eventDatetime)} ${e.title}`,
        count: k === "belonging" ? e.belongingCount : e.taskCount,
      }))
      .filter((e) => e.count > 0);
  const unreviewed =
    !!reviewState &&
    !reviewState.listReviewedAt &&
    !reviewState.listCustomized &&
    reviewState._count.editRecords === 0 &&
    items.length > 0;

  return (
    <>
      {/* 「過去に失敗の記録があります」の警告はやめて、ページ上部の失敗ログ提案に一本化。
          終わった予定の振り返り（今回はどうでしたか？）だけ残す。 */}
      {warning && warning.isPast && (
        <div id="failure-review" className="scroll-mt-4">
          <WarningPanel warning={warning} />
        </div>
      )}

      <section className="space-y-4" data-coach="checklist">
        {/* 小さめのボタン2つを横並び。押すとポップアップで開く。 */}
        <div
          data-coach="list-reminder"
          className="flex flex-wrap items-center gap-2"
        >
          <ListReminderControl
            eventId={event.id}
            current={parseLeads(
              reviewState?.listReminderLeads ?? event.listReminderLeads,
            )}
          />
          <DictationInput eventId={event.id} />
        </div>

        {needsManualGenerate && (
          <div
            data-coach="generate-checklist"
            className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-surface-muted px-4 py-3"
          >
            <p className="flex items-center gap-1.5 text-xs text-foreground">
              連携時に取り込んだ予定です。準備リストはまだ作っていません
              <InfoHint id="checklist-generate-existing">
                自分で予定に入れる前からあった予定は、開いても自動では作りません。
                このボタンを押すと、今この場で準備リスト・考えられる失敗を作ります。
              </InfoHint>
            </p>
            <form action={generateChecklistForEvent}>
              <input type="hidden" name="eventId" value={event.id} />
              <SubmitButton>🪄 準備リストを作る</SubmitButton>
            </form>
          </div>
        )}

        {unreviewed && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-surface-muted px-4 py-3">
            <p className="flex items-center gap-1.5 text-xs text-foreground">
              このリストは未確認です
              <InfoHint id="checklist-unreviewed">
                中身を見て問題なければ「確認しました」を押してください。編集しても消えます。
              </InfoHint>
            </p>
            <form action={markListReviewed}>
              <input type="hidden" name="eventId" value={event.id} />
              <SubmitButton>確認しました</SubmitButton>
            </form>
          </div>
        )}

        <SectionList
          eventId={event.id}
          entries={orderedKeys.map((key): SectionEntry => {
            if (key === FAILURE_LOG_KEY) {
              return {
                key,
                label: "考えられる失敗",
                builtin: true, // 名前変更・削除はさせない
                node: failureLogNode,
              };
            }
            const builtin = isBuiltinSection(key);
            return {
              key,
              label: sectionLabel(key),
              builtin,
              node: (
                <KindBlock
                  eventId={event.id}
                  kind={key}
                  label={sectionLabel(key)}
                  rows={rows}
                  templates={tplByKind(key)}
                  pastEvents={
                    builtin ? pastByKind(key as "task" | "belonging") : []
                  }
                  imagesBySlot={imagesByKind.get(key) ?? EMPTY_IMG_MAP}
                />
              ),
            };
          })}
        />

        <div className="pt-0.5" data-coach="add-section">
          <AddSectionButton eventId={event.id} />
        </div>
      </section>

      {forced.length > 0 && (
        <section className="rounded-2xl bg-teal-soft p-4 text-sm">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-teal-dark">
              この種類の予定で学習済みのこと
            </h3>
            <Link href="/savings" className="text-xs text-teal-dark underline">
              確認・編集
            </Link>
          </div>
          <ul className="mt-2 space-y-1 text-teal-dark/90">
            {forced
              .filter((r) => r.ruleType === "fixed_item")
              .map((r) => (
                <li key={r.id}>
                  毎回入れる: {r.target}
                  {r.itemKind === "belonging" ? "（持ち物）" : ""}
                </li>
              ))}
            {forced
              .filter((r) => r.ruleType === "exclude_item")
              .map((r) => (
                <li key={r.id}>
                  出さない: {r.target}
                  {r.itemKind === "belonging" ? "（持ち物）" : ""}
                </li>
              ))}
            {forced
              .filter((r) => r.ruleType === "timing_override")
              .map((r) => (
                <li key={r.id}>
                  {r.target} → {r.value}
                </li>
              ))}
          </ul>
        </section>
      )}
    </>
  );
}

export function ChecklistSectionSkeleton() {
  // ちらつき防止のためアニメーションなし（静止したプレースホルダー）。
  // animate-pulse は明滅して見えると不評だったため使わない（今後の骨組みも同様に）。
  return (
    <div className="space-y-3" aria-hidden>
      <div className="h-6 w-32 rounded bg-surface-muted" />
      <div className="space-y-2 rounded-2xl bg-surface p-4">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-6 rounded bg-surface-muted" />
        ))}
        <p className="pt-2 text-xs text-muted">準備リストを作成中…（初回のみ数秒）</p>
      </div>
    </div>
  );
}
