"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  applyTemplateToEvent,
  clearChecklistSection,
  copyListFromEvent,
  saveChecklist,
  saveListAsTemplate,
  setItemNotifyLead,
  toggleChecklistItemDone,
} from "@/app/actions";
import { LEAD_PRESETS, formatLead, isLeadPreset } from "@/lib/lead-time";
import { InfoHint } from "@/app/components/info-hint";
import { ItemImages, Linkify, type ItemImage } from "./item-media";

interface Item {
  key: string;
  id: string | null;
  title: string;
  comment: string;
  isDone: boolean;
  isUserAdded: boolean;
  notifyLeadMinutes: number | null; // 予定開始の何分前に通知するか。null = 通知なし
  notifyCustom: boolean; // カスタム入力（日・時・分）を出しているか（UIのみ）
  images: ItemImage[];
}

interface InitialItem {
  id: string | null;
  title: string;
  comment: string | null;
  isDone: boolean;
  isUserAdded: boolean;
  notifyLeadMinutes: number | null;
  images?: ItemImage[];
}

const DEFAULT_LEAD = 180; // 3時間前
const splitLead = (m: number) => ({
  d: Math.floor(m / 1440),
  h: Math.floor((m % 1440) / 60),
  mm: m % 60,
});
const clamp = (n: number, hi: number) =>
  Math.max(0, Math.min(hi, Math.floor(Number.isFinite(n) ? n : 0)));

let counter = 0;
const nextKey = () => `it-${counter++}`;
const normTitle = (s: string) => s.toLowerCase().replace(/\s+/g, "").trim();

/** メモ帳などから貼り付けたテキストを 1 行 1 項目に。記号・番号は落とす。 */
function parseBulk(text: string): { title: string }[] {
  let lines = text.split(/\r?\n/);
  if (lines.length === 1 && /[、,]/.test(lines[0])) {
    lines = lines[0].split(/[、,]/);
  }
  const out: { title: string }[] = [];
  const seen = new Set<string>();
  for (const raw of lines) {
    let line = raw.replace(/[　 ]/g, " ").trim();
    if (!line) continue;
    line = line
      .replace(
        /^(?:[-*・•‣▸▹>＞○●◦]|\[[ xX]\]|[☐☑✅⬜◻◼■□▪▫]|\d+[.)、]|[（(]\d+[）)])\s*/,
        "",
      )
      .trim();
    line = line.replace(/^(?:済み?|done|[✓✔☑])\s*[:：\-]?\s*/i, "").trim();
    // 末尾の「（…前）」等はもう使わないので落とす
    line = line.replace(/[（(]\s*[^（()）]{1,16}\s*[）)]\s*$/, "").trim();
    if (!line) continue;
    const key = normTitle(line);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push({ title: line.slice(0, 120) });
  }
  return out;
}

export function ChecklistEditor({
  eventId,
  kind = "task",
  label,
  initialItems,
  templates = [],
  pastEvents = [],
  allowImages = true,
}: {
  eventId: string;
  kind?: string;
  /** 見出しの表示名。省略時は組み込みの「準備すること／持ち物」。 */
  label?: string;
  initialItems: InitialItem[];
  templates?: { id: string; name: string }[];
  pastEvents?: { id: string; label: string; count: number }[];
  /** 項目メモへの写真添付を出すか（予定ページでは true、学習ページでは false）。 */
  allowImages?: boolean;
}) {
  const isBelonging = kind === "belonging";
  const kindLabel = label ?? (isBelonging ? "持ち物" : "準備すること");
  const router = useRouter();
  const initial = useMemo<Item[]>(
    () =>
      initialItems.map((it) => ({
        key: nextKey(),
        id: it.id,
        title: it.title,
        comment: it.comment ?? "",
        isDone: it.isDone,
        isUserAdded: it.isUserAdded,
        notifyLeadMinutes: it.notifyLeadMinutes ?? null,
        notifyCustom:
          it.notifyLeadMinutes != null && !isLeadPreset(it.notifyLeadMinutes),
        images: it.images ?? [],
      })),
    [initialItems],
  );

  const [items, setItems] = useState<Item[]>(initial);

  // 表示順は「このページを開いた時点の並び（未チェックが上・チェック済みが下）」で固定する。
  // ページ内でチェックを付け外ししても順番は動かさない（誤タップをすぐ戻せる）。
  // 次にこのページを開くと再ソートされる。カレンダー説明欄はトグルで即並べ替え。
  const identity = (it: Item) => it.id ?? `t:${normTitle(it.title)}`;
  const [frozenOrder] = useState<string[]>(() =>
    initial
      .map((it, i) => ({ it, i }))
      .sort((a, b) => (a.it.isDone ? 1 : 0) - (b.it.isDone ? 1 : 0) || a.i - b.i)
      .map(({ it }) => identity(it)),
  );
  const displayItems = useMemo(() => {
    const pos = new Map(frozenOrder.map((k, i) => [k, i]));
    return items
      .map((it, i) => ({ it, i }))
      .sort((a, b) => {
        const pa = pos.get(identity(a.it)) ?? 1e9;
        const pb = pos.get(identity(b.it)) ?? 1e9;
        return pa - pb || a.i - b.i;
      })
      .map(({ it }) => it);
  }, [items, frozenOrder]);
  const [removedTitles, setRemovedTitles] = useState<string[]>([]);
  const [pending, startTransition] = useTransition();
  const [saved, setSaved] = useState(false);
  // 「ユーザーが実際に中身をいじった（メモ以外）」フラグ。
  // これが立ったときだけ自動保存する。保存したら false に戻す。
  // ＝ 何も書いていないのに保存が延々と走るのを防ぐ。
  const [structEdited, setStructEdited] = useState(false);
  // ハイライトチュートリアル中で、かつ項目が空のときだけ「例」を仮表示する。
  // この例は state（items）に入れず、保存も学習もしない。純粋に見せるだけ。
  const [coachActive, setCoachActive] = useState(false);
  const [exampleOpen, setExampleOpen] = useState(false);
  useEffect(() => {
    const on = (e: Event) => {
      const active = !!(e as CustomEvent).detail?.active;
      setCoachActive(active);
      if (!active) setExampleOpen(false);
    };
    window.addEventListener("mm:coach", on);
    return () => window.removeEventListener("mm:coach", on);
  }, []);

  // 行ごとの詳細（通知タイミング・メモ・削除）を開いているか
  const [openKeys, setOpenKeys] = useState<Set<string>>(() => new Set());
  const toggleOpen = (key: string) =>
    setOpenKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkText, setBulkText] = useState("");
  const [bulkNote, setBulkNote] = useState<string | null>(null);

  const originalTitles = useMemo(
    () => new Set(initialItems.map((i) => i.title)),
    [initialItems],
  );

  // メモは自動保存しない。保存済みの値と違う項目があるか（キー：正規化タイトル）。
  const savedCommentByTitle = useMemo(
    () => new Map(initial.map((i) => [normTitle(i.title), i.comment])),
    [initial],
  );
  const commentDirty = items.some(
    (it) =>
      it.title.trim().length > 0 &&
      (savedCommentByTitle.get(normTitle(it.title)) ?? "") !== it.comment,
  );
  const rowCommentDirty = (it: Item) =>
    (savedCommentByTitle.get(normTitle(it.title)) ?? "") !== it.comment;

  const dirty = structEdited || commentDirty;

  const syncedRef = useRef(initial);
  useEffect(() => {
    const userEdited =
      structEdited ||
      commentDirty ||
      JSON.stringify(items.map(strip)) !==
        JSON.stringify(syncedRef.current.map(strip)) ||
      removedTitles.length > 0;
    syncedRef.current = initial;
    if (userEdited) {
      // 本文編集中でも、写真の増減（別経路で保存＋router.refresh）は反映する。
      setItems((cur) =>
        cur.map((it) => {
          const fresh = it.id
            ? initial.find((x) => x.id === it.id)
            : undefined;
          return fresh && fresh.images !== it.images
            ? { ...it, images: fresh.images }
            : it;
        }),
      );
      return;
    }
    setItems(initial);
    setRemovedTitles([]);
    setStructEdited(false);
    setSaved(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initial]);

  // 自動保存は「ユーザーが実際にいじった（structEdited）」ときだけ。
  // 何も書いていない状態では一切走らせない。編集が続く間は 1.8 秒ごとに
  // タイマーが張り直され、止まったら 1 回だけ保存する。
  // メモ（comment）は自動保存しない ＝ 書き終わったら「メモを保存」を押す。
  useEffect(() => {
    if (!structEdited || pending) return;
    const t = window.setTimeout(() => {
      setStructEdited(false);
      persist(items, false);
    }, 1800);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, structEdited, pending]);

  // includeMemo=false のとき（＝自動保存）は、メモは保存済みの値のまま送る。
  // メモは「メモを保存」を押したときだけ（includeMemo=true）反映する。
  function toPayload(list: Item[], includeMemo: boolean) {
    return list
      .filter((it) => it.title.trim())
      .map((it) => {
        const memo = includeMemo
          ? it.comment
          : (savedCommentByTitle.get(normTitle(it.title)) ?? "");
        return {
          title: it.title.trim(),
          comment: memo.trim() || null,
          isDone: it.isDone,
          isUserAdded: it.isUserAdded,
          notifyLeadMinutes: it.notifyLeadMinutes,
        };
      });
  }

  function persist(list: Item[], includeMemo = true) {
    startTransition(async () => {
      await saveChecklist({
        eventId,
        kind,
        items: toPayload(list, includeMemo),
        removedTitles,
      });
      setRemovedTitles([]);
      setSaved(true);
    });
  }

  function update(key: string, patch: Partial<Item>) {
    setItems((prev) =>
      prev.map((it) => (it.key === key ? { ...it, ...patch } : it)),
    );
    setSaved(false);
    // メモ（comment）だけの変更では自動保存しない。文言・通知の変更だけが対象。
    if ("title" in patch || "notifyLeadMinutes" in patch) setStructEdited(true);
  }

  // 保存済み項目は通知の変更をその場で保存＋学習（チェックと同じ扱い）
  function commitNotify(it: Item, minutes: number | null) {
    if (it.id && (it.notifyLeadMinutes ?? null) !== minutes) {
      void setItemNotifyLead(it.id, minutes);
    }
  }

  function onNotifySelect(it: Item, value: string) {
    if (value === "custom") {
      update(it.key, {
        notifyCustom: true,
        notifyLeadMinutes: it.notifyLeadMinutes ?? DEFAULT_LEAD,
      });
    } else if (value === "none") {
      update(it.key, { notifyCustom: false, notifyLeadMinutes: null });
      commitNotify(it, null);
    } else {
      const m = Number(value);
      update(it.key, { notifyCustom: false, notifyLeadMinutes: m });
      commitNotify(it, m);
    }
  }

  function setCustomPart(it: Item, part: "d" | "h" | "mm", value: string) {
    const cur = splitLead(it.notifyLeadMinutes ?? DEFAULT_LEAD);
    const d = part === "d" ? clamp(Number(value), 30) : cur.d;
    const h = part === "h" ? clamp(Number(value), 23) : cur.h;
    const mm = part === "mm" ? clamp(Number(value), 59) : cur.mm;
    const total = d * 1440 + h * 60 + mm;
    const next = total > 0 ? total : null;
    update(it.key, { notifyLeadMinutes: next });
    commitNotify(it, next);
  }

  function toggleDone(it: Item, next: boolean) {
    setItems((prev) =>
      prev.map((x) => (x.key === it.key ? { ...x, isDone: next } : x)),
    );
    if (it.id) void toggleChecklistItemDone(it.id, next);
  }

  function remove(key: string) {
    if (!window.confirm("削除しますか？")) return;
    setItems((prev) => {
      const target = prev.find((it) => it.key === key);
      // 保存済みの項目を消したときだけ、保存が必要（空の未保存行はそのまま消すだけ）
      if (target && (target.id || originalTitles.has(target.title))) {
        setStructEdited(true);
        if (originalTitles.has(target.title)) {
          setRemovedTitles((r) =>
            r.includes(target.title) ? r : [...r, target.title],
          );
        }
      }
      return prev.filter((it) => it.key !== key);
    });
    setSaved(false);
  }

  function clearAll() {
    if (
      !window.confirm(`「${kindLabel}」の項目をすべて削除します。よろしいですか？`)
    )
      return;
    setItems([]);
    startTransition(async () => {
      const fd = new FormData();
      fd.set("eventId", eventId);
      fd.set("kind", kind);
      await clearChecklistSection(fd);
      router.refresh();
    });
  }

  function add() {
    setItems((prev) => [
      ...prev,
      {
        key: nextKey(),
        id: null,
        title: "",
        comment: "",
        isDone: false,
        isUserAdded: true,
        notifyLeadMinutes: null,
        notifyCustom: false,
        images: [],
      },
    ]);
    setSaved(false);
  }

  function bulkAdd() {
    const parsed = parseBulk(bulkText);
    if (parsed.length === 0) {
      setBulkNote("追加できる行が見つかりませんでした。");
      return;
    }
    const existing = new Set(items.map((i) => normTitle(i.title)));
    const fresh = parsed.filter((p) => !existing.has(normTitle(p.title)));
    if (fresh.length === 0) {
      setBulkText("");
      setBulkNote("すべて登録済みでした。");
      return;
    }
    const merged: Item[] = [
      ...items,
      ...fresh.map((p) => ({
        key: nextKey(),
        id: null,
        title: p.title,
        comment: "",
        isDone: false,
        isUserAdded: true,
        notifyLeadMinutes: null,
        notifyCustom: false,
        images: [],
      })),
    ];
    setItems(merged);
    setBulkText("");
    setBulkOpen(false);
    setBulkNote(
      `${fresh.length}件を追加しました${
        parsed.length !== fresh.length
          ? `（${parsed.length - fresh.length}件は重複のため除外）`
          : ""
      }。`,
    );
    persist(merged);
  }

  const doneCount = items.filter((it) => it.isDone).length;

  // チュートリアル中で、その枠がまだ空のときだけ「例」を見せる。
  // 何か 1 つでも実際に入ったら、その枠の例は消える（realCount === 0 ゲート）。
  const realCount = items.filter((it) => it.title.trim()).length;
  const showExamples =
    coachActive &&
    (kind === "task" || kind === "belonging") &&
    realCount === 0;
  const EXAMPLES: { title: string; lead: string }[] = isBelonging
    ? [
        { title: "モバイルバッテリー", lead: "" },
        { title: "常備薬", lead: "1日前" },
        { title: "身分証", lead: "" },
      ]
    : [
        { title: "持ち物を確認する", lead: "1日前" },
        { title: "何時に出るか決める", lead: "1日前" },
        { title: "集合時間を確認する", lead: "" },
      ];

  // ── テンプレート／他の予定 のポップアップ ──
  const [modal, setModal] = useState<null | "save" | "apply" | "copy">(null);
  // 「＋ 追加」以外の操作は「その他」メニューに畳む（ボタンの氾濫を防ぐ）。
  const [moreOpen, setMoreOpen] = useState(false);
  const [tplName, setTplName] = useState("");
  const [applyId, setApplyId] = useState("");
  const [copyId, setCopyId] = useState("");

  async function flushPending() {
    if (dirty) {
      await saveChecklist({
        eventId,
        kind,
        items: toPayload(items, true),
        removedTitles,
      });
      setRemovedTitles([]);
    }
  }

  function doSaveTemplate() {
    const name = tplName.trim();
    if (!name) return;
    startTransition(async () => {
      await flushPending();
      const fd = new FormData();
      fd.set("eventId", eventId);
      fd.set("kind", kind);
      fd.set("name", name);
      await saveListAsTemplate(fd);
      setTplName("");
      setModal(null);
      setSaved(true);
      router.refresh();
    });
  }

  function doApplyTemplate() {
    if (!applyId) return;
    startTransition(async () => {
      await flushPending();
      const fd = new FormData();
      fd.set("eventId", eventId);
      fd.set("templateId", applyId);
      await applyTemplateToEvent(fd);
      setApplyId("");
      setModal(null);
      router.refresh();
    });
  }

  function doCopyFromEvent() {
    if (!copyId) return;
    startTransition(async () => {
      await flushPending();
      const fd = new FormData();
      fd.set("eventId", eventId);
      fd.set("sourceEventId", copyId);
      fd.set("kind", kind);
      await copyListFromEvent(fd);
      setCopyId("");
      setModal(null);
      router.refresh();
    });
  }

  return (
    <div className="rounded-2xl bg-surface p-3">
      {/* 保存中だけ、右上に小さく出す（スクロール追従・ヘッダーの下・邪魔にならない大きさ）。 */}
      {pending && (
        <div className="fixed right-3 top-16 z-[70] flex items-center gap-2 rounded-full border border-border bg-surface px-3 py-1.5 text-xs text-muted shadow-md">
          <span className="h-3 w-3 animate-spin rounded-full border-2 border-border border-t-foreground" />
          自動保存中…
        </div>
      )}
      <div className="mb-1.5 flex items-baseline gap-2">
        <h3 className="text-sm font-semibold text-foreground">{kindLabel}</h3>
        <span className="text-xs text-muted tabular-nums">
          {doneCount}/{items.length}
        </span>
        {items.length > 0 && (
          <button
            type="button"
            onClick={clearAll}
            disabled={pending}
            className="ml-auto shrink-0 self-center rounded-md border border-border px-2 py-0.5 text-[11px] text-muted hover:border-warn hover:text-warn disabled:opacity-50"
          >
            全部消す
          </button>
        )}
      </div>

      {showExamples && (
        <div className="mb-2 rounded-lg border border-dashed border-border bg-surface-muted p-2">
          <p className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold text-foreground">
            <span className="rounded bg-foreground px-1 py-0.5 text-[10px] leading-none text-surface">
              記入例
            </span>
            ここは説明用の例です。保存も学習もされません。1つでも入れると消えます。
          </p>
          <ul className="divide-y divide-border/50">
            {EXAMPLES.map((ex, i) => {
              const open = i === 0 && exampleOpen;
              return (
                <li
                  key={i}
                  data-coach={i === 0 ? "item-row" : undefined}
                  className="py-1"
                >
                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      disabled
                      aria-hidden
                      className="h-4 w-4 shrink-0 accent-[var(--teal)]"
                    />
                    <span className="shrink-0 rounded border border-border px-1 text-[10px] leading-tight text-muted">
                      例
                    </span>
                    <span className="min-w-0 flex-1 px-1 py-1 text-sm text-muted">
                      {ex.title}
                    </span>
                    {ex.lead && (
                      <span className="shrink-0 text-[11px] tabular-nums text-teal-dark">
                        🔔{ex.lead}
                      </span>
                    )}
                    <button
                      type="button"
                      data-coach={i === 0 ? "item-expand" : undefined}
                      onClick={() => {
                        if (i === 0) setExampleOpen((v) => !v);
                      }}
                      aria-label={open ? "詳細を閉じる" : "詳細を開く"}
                      className={`shrink-0 rounded-md border px-1.5 py-0.5 text-xs leading-none ${
                        open
                          ? "border-teal bg-teal-soft text-teal-dark"
                          : "border-border text-muted"
                      }`}
                    >
                      {open ? "∧" : "∨"}
                    </button>
                    <span className="shrink-0 rounded-full border border-border px-1.5 py-0.5 text-[11px] text-muted">
                      ✕
                    </span>
                  </div>
                  {open && (
                    <div className="ml-6 mt-1.5 space-y-1 rounded-lg bg-background/60 p-2 text-[11px] text-muted">
                      <p>通知タイミング（例: 1日前 / 3時間前 / なし）</p>
                      <p>メモ・リンク（改行OK。「メモを保存」で保存）</p>
                      <p>＋ 写真（自動で圧縮）</p>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <ul className="divide-y divide-border/70">
        {displayItems.map((it) => {
          const c = splitLead(it.notifyLeadMinutes ?? DEFAULT_LEAD);
          const showCustom =
            it.notifyCustom ||
            (it.notifyLeadMinutes != null && !isLeadPreset(it.notifyLeadMinutes));
          const selValue = showCustom
            ? "custom"
            : it.notifyLeadMinutes == null
              ? "none"
              : String(it.notifyLeadMinutes);
          const open = openKeys.has(it.key);
          return (
            <li key={it.key} data-coach="item-row" className="py-1.5">
              {/* 1 行に集約：チェック / 文言 / 通知チップ。
                  項目名は大きめ表示・長ければ折り返す（field-sizing で自動高さ）。 */}
              <div className="flex items-start gap-2">
                <input
                  type="checkbox"
                  checked={it.isDone}
                  onChange={(e) => toggleDone(it, e.target.checked)}
                  className="mt-1 h-5 w-5 shrink-0 accent-[var(--teal)]"
                  aria-label="完了"
                />
                <textarea
                  value={it.title}
                  onChange={(e) => update(it.key, { title: e.target.value })}
                  rows={1}
                  placeholder={`${kindLabel}を書く`}
                  className={`min-w-0 flex-1 resize-none overflow-hidden rounded-md border border-transparent bg-transparent px-1 py-0.5 text-lg leading-snug [field-sizing:content] hover:border-border focus:border-border focus:bg-background ${
                    it.isDone ? "text-muted line-through" : ""
                  }`}
                />
                {it.isUserAdded && (
                  <span className="mt-1.5 hidden shrink-0 rounded bg-accent-soft px-1 text-[10px] text-teal-dark sm:inline">
                    追加
                  </span>
                )}
                {it.notifyLeadMinutes != null && (
                  <span className="mt-1.5 shrink-0 text-[11px] tabular-nums text-teal-dark">
                    🔔{formatLead(it.notifyLeadMinutes)}
                  </span>
                )}
                {it.images.length > 0 && (
                  <span className="mt-1.5 shrink-0 text-[11px] tabular-nums text-muted">
                    🖼️{it.images.length}
                  </span>
                )}
                <button
                  type="button"
                  data-coach="item-expand"
                  onClick={() => toggleOpen(it.key)}
                  aria-expanded={open}
                  aria-label={open ? "詳細を閉じる" : "詳細を開く"}
                  className={`mt-0.5 shrink-0 rounded-md border px-2 py-1 text-sm leading-none transition-colors ${
                    open
                      ? "border-teal bg-teal-soft text-teal-dark"
                      : "border-border text-muted hover:border-teal hover:text-teal-dark"
                  }`}
                >
                  {open ? "∧" : "∨"}
                </button>
                <button
                  type="button"
                  onClick={() => remove(it.key)}
                  aria-label="削除"
                  className="mt-0.5 shrink-0 rounded-full border border-border px-2 py-1 text-xs text-muted hover:border-warn hover:text-warn"
                >
                  ✕
                </button>
              </div>

              {/* 詳細（チップを押したときだけ）：通知タイミング・メモ・削除 */}
              {open && (
                <div className="ml-6 mt-1.5 space-y-2 rounded-lg bg-background/60 p-2">
                  <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted">
                    <span className="shrink-0">通知</span>
                    <select
                      value={selValue}
                      onChange={(e) => onNotifySelect(it, e.target.value)}
                      className="rounded-md border bg-background px-1.5 py-0.5 text-xs"
                      aria-label="通知タイミング"
                    >
                      {LEAD_PRESETS.map((p) => (
                        <option
                          key={p.label}
                          value={p.minutes == null ? "none" : String(p.minutes)}
                        >
                          {p.label}
                        </option>
                      ))}
                      <option value="custom">カスタム…</option>
                    </select>
                    {showCustom && (
                      <span className="inline-flex items-center gap-0.5">
                        <input
                          type="number"
                          min={0}
                          max={30}
                          value={c.d || ""}
                          onChange={(e) => setCustomPart(it, "d", e.target.value)}
                          className="w-10 rounded border bg-background px-1 py-0.5 text-xs"
                          aria-label="日"
                        />
                        日
                        <input
                          type="number"
                          min={0}
                          max={23}
                          value={c.h || ""}
                          onChange={(e) => setCustomPart(it, "h", e.target.value)}
                          className="w-10 rounded border bg-background px-1 py-0.5 text-xs"
                          aria-label="時間"
                        />
                        時間
                        <input
                          type="number"
                          min={0}
                          max={59}
                          value={c.mm || ""}
                          onChange={(e) => setCustomPart(it, "mm", e.target.value)}
                          className="w-10 rounded border bg-background px-1 py-0.5 text-xs"
                          aria-label="分"
                        />
                        分前
                      </span>
                    )}
                  </div>

                  <textarea
                    value={it.comment}
                    onChange={(e) => update(it.key, { comment: e.target.value })}
                    rows={3}
                    placeholder="メモ・リンク（任意・学習しません）。改行できます。"
                    className="w-full resize-y rounded-md border border-border bg-background px-2 py-1 text-xs text-muted"
                  />
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => persist(items)}
                      disabled={pending || !rowCommentDirty(it)}
                      className="rounded-md border border-teal/40 px-2 py-0.5 text-[11px] text-teal-dark hover:border-teal disabled:opacity-40"
                    >
                      {pending ? "保存中…" : "メモを保存"}
                    </button>
                    <span className="text-[11px] text-muted">
                      {rowCommentDirty(it)
                        ? "未保存（自動保存されません）"
                        : it.comment.trim()
                          ? "保存済み"
                          : ""}
                    </span>
                  </div>
                  {it.comment.trim() && (
                    <p className="whitespace-pre-wrap break-words text-[11px] text-muted">
                      <Linkify text={it.comment} />
                    </p>
                  )}

                  {/* 写真（項目ごとのメモに添付。Google カレンダーには出ない） */}
                  {allowImages && (
                    <ItemImages
                      eventId={eventId}
                      kind={kind}
                      title={it.title}
                      canAttach={!!it.id && it.title.trim().length > 0}
                      images={it.images}
                    />
                  )}
                </div>
              )}

              {/* 閉じているときはメモを 1 行プレビュー */}
              {!open && it.comment.trim() && (
                <p className="ml-6 truncate text-[11px] text-muted">
                  <Linkify text={it.comment} />
                </p>
              )}
            </li>
          );
        })}
      </ul>

      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <div data-coach="templates" className="relative flex flex-wrap gap-1.5">
          {/* メインは「＋ 追加」だけ。ほかの操作は「その他」メニューに畳む。 */}
          <button
            type="button"
            data-coach="add-item"
            onClick={add}
            className="rounded-md border border-foreground bg-foreground px-3 py-1.5 text-xs font-medium text-surface hover:opacity-90"
          >
            ＋ 追加
          </button>
          <button
            type="button"
            onClick={() => setMoreOpen((v) => !v)}
            aria-expanded={moreOpen}
            className="rounded-md border border-border px-2.5 py-1.5 text-xs text-muted hover:border-foreground/40 hover:text-foreground"
          >
            その他 {moreOpen ? "▲" : "▾"}
          </button>

          {moreOpen && (
            <>
              <div
                className="fixed inset-0 z-40"
                onClick={() => setMoreOpen(false)}
              />
              <div className="absolute left-0 top-full z-50 mt-1 w-56 overflow-hidden rounded-xl border border-border bg-surface py-1 shadow-lg">
                {[
                  {
                    label: "📝 メモから一括で追加",
                    on: () => {
                      setBulkOpen(true);
                      setBulkNote(null);
                    },
                  },
                  { label: "📋 テンプレから追加", on: () => setModal("apply") },
                  { label: "📆 他の予定からコピー", on: () => setModal("copy") },
                  { label: "⭐ 名前をつけて保存", on: () => setModal("save") },
                ].map((m) => (
                  <button
                    key={m.label}
                    type="button"
                    onClick={() => {
                      setMoreOpen(false);
                      m.on();
                    }}
                    className="block w-full px-3 py-2 text-left text-xs text-foreground hover:bg-surface-muted"
                  >
                    {m.label}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>

        <div className="flex items-center gap-2 text-[11px]">
          <span className={dirty ? "text-muted" : "text-teal-dark"}>
            {pending
              ? "保存中…"
              : commentDirty
                ? "メモが未保存"
                : structEdited
                  ? "変更あり（自動保存）"
                  : saved
                    ? "保存しました"
                    : ""}
          </span>
          {dirty && !pending && (
            <button
              type="button"
              onClick={() => persist(items)}
              className="rounded-md border border-teal/40 px-2 py-0.5 text-teal-dark hover:border-teal"
            >
              {commentDirty ? "メモも保存" : "今すぐ保存"}
            </button>
          )}
        </div>
      </div>

      {bulkOpen && (
        <div className="mt-3 rounded-xl border border-border bg-background p-3">
          <textarea
            value={bulkText}
            onChange={(e) => setBulkText(e.target.value)}
            rows={5}
            placeholder={
              isBelonging
                ? "メモを貼り付け。1行に1つ。\n充電器\nモバイルバッテリー\n常備薬"
                : "メモを貼り付け。1行に1つ。\n宿の予約を確認する\n・切符を用意する\n1. 戸締まりチェック"
            }
            className="w-full rounded-lg border bg-surface px-3 py-2 text-sm"
          />
          <p className="mt-1 text-[11px] text-muted">
            行頭の「・」「-」「1.」やチェック記号は自動で取り除きます。重複はスキップします。通知タイミングは追加後に設定できます。
          </p>
          <div className="mt-2 flex items-center gap-2">
            <button
              type="button"
              onClick={bulkAdd}
              disabled={pending || !bulkText.trim()}
              className="rounded-lg bg-foreground px-3 py-1.5 text-sm font-medium text-surface hover:opacity-90 disabled:opacity-50"
            >
              追加する
            </button>
            <button
              type="button"
              onClick={() => {
                setBulkOpen(false);
                setBulkText("");
              }}
              className="text-xs text-muted underline hover:text-foreground"
            >
              取消
            </button>
          </div>
        </div>
      )}
      {bulkNote && <p className="mt-2 text-xs text-teal-dark">{bulkNote}</p>}

      <p className="mt-1.5 flex items-center gap-1 text-[11px] text-muted">
        文言・追加・削除は自動保存
        <InfoHint>
          ∨ で通知タイミング・メモ・リンク・写真。メモは「メモを保存」で保存。
          ✕ で削除。
        </InfoHint>
      </p>

      {modal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => {
            if (!pending) setModal(null);
          }}
        >
          <div
            className="w-full max-w-sm space-y-3 rounded-2xl bg-surface p-5 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            {modal === "save" && (
              <>
                <h3 className="text-sm font-semibold text-foreground">
                  ⭐ この{kindLabel}リストを保存
                </h3>
                <p className="text-[11px] text-muted">
                  名前を付けて保存すると、どの予定でも「📋 テンプレから」で追加できます。同じ名前は上書きします。
                </p>
                <input
                  value={tplName}
                  onChange={(e) => setTplName(e.target.value)}
                  maxLength={60}
                  placeholder={
                    isBelonging ? "例: 日帰り出張の持ち物" : "例: 出張の準備"
                  }
                  className="w-full rounded-lg border bg-background px-3 py-2 text-sm"
                />
                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setModal(null)}
                    className="rounded-lg px-3 py-1.5 text-sm text-muted"
                  >
                    キャンセル
                  </button>
                  <button
                    type="button"
                    onClick={doSaveTemplate}
                    disabled={pending || !tplName.trim()}
                    className="rounded-lg bg-foreground px-4 py-1.5 text-sm font-medium text-surface disabled:opacity-50"
                  >
                    {pending ? "保存中…" : "保存"}
                  </button>
                </div>
              </>
            )}

            {modal === "apply" && (
              <>
                <h3 className="text-sm font-semibold text-foreground">
                  📋 テンプレから{kindLabel}を追加
                </h3>
                {templates.length === 0 ? (
                  <p className="text-xs text-muted">
                    まだ{kindLabel}のテンプレートはありません。「⭐ 名前をつけて保存」か、学習ページで作成できます。
                  </p>
                ) : (
                  <>
                    <select
                      value={applyId}
                      onChange={(e) => setApplyId(e.target.value)}
                      className="w-full rounded-lg border bg-background px-3 py-2 text-sm"
                    >
                      <option value="">テンプレートを選ぶ</option>
                      {templates.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name}
                        </option>
                      ))}
                    </select>
                    <p className="text-[11px] text-muted">
                      すでにある項目（同じ名前）はスキップします。
                    </p>
                  </>
                )}
                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setModal(null)}
                    className="rounded-lg px-3 py-1.5 text-sm text-muted"
                  >
                    キャンセル
                  </button>
                  <button
                    type="button"
                    onClick={doApplyTemplate}
                    disabled={pending || !applyId}
                    className="rounded-lg bg-foreground px-4 py-1.5 text-sm font-medium text-surface disabled:opacity-50"
                  >
                    {pending ? "追加中…" : "追加"}
                  </button>
                </div>
              </>
            )}

            {modal === "copy" && (
              <>
                <h3 className="text-sm font-semibold text-foreground">
                  📆 他の予定から{kindLabel}をコピー
                </h3>
                {pastEvents.length === 0 ? (
                  <p className="text-xs text-muted">
                    {kindLabel}リストのある他の予定がまだありません。
                  </p>
                ) : (
                  <>
                    <select
                      value={copyId}
                      onChange={(e) => setCopyId(e.target.value)}
                      className="w-full rounded-lg border bg-background px-3 py-2 text-sm"
                    >
                      <option value="">予定を選ぶ</option>
                      {pastEvents.map((e) => (
                        <option key={e.id} value={e.id}>
                          {e.label}（{e.count}）
                        </option>
                      ))}
                    </select>
                    <p className="text-[11px] text-muted">
                      選んだ予定の{kindLabel}をこの予定に追加します（同じ名前はスキップ）。
                    </p>
                  </>
                )}
                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setModal(null)}
                    className="rounded-lg px-3 py-1.5 text-sm text-muted"
                  >
                    キャンセル
                  </button>
                  <button
                    type="button"
                    onClick={doCopyFromEvent}
                    disabled={pending || !copyId}
                    className="rounded-lg bg-foreground px-4 py-1.5 text-sm font-medium text-surface disabled:opacity-50"
                  >
                    {pending ? "コピー中…" : "コピー"}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function strip(it: Item) {
  return {
    title: it.title.trim(),
    comment: it.comment.trim(),
    notifyLeadMinutes: it.notifyLeadMinutes,
  };
}
