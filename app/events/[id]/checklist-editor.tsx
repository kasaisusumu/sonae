"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import {
  saveChecklist,
  setItemNotifyLead,
  toggleChecklistItemDone,
} from "@/app/actions";
import { LEAD_PRESETS, isLeadPreset } from "@/lib/lead-time";

interface Item {
  key: string;
  id: string | null;
  title: string;
  comment: string;
  isDone: boolean;
  isUserAdded: boolean;
  notifyLeadMinutes: number | null; // 予定開始の何分前に通知するか。null = 通知なし
  notifyCustom: boolean; // カスタム入力（日・時・分）を出しているか（UIのみ）
}

interface InitialItem {
  id: string | null;
  title: string;
  comment: string | null;
  isDone: boolean;
  isUserAdded: boolean;
  notifyLeadMinutes: number | null;
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
  initialItems,
}: {
  eventId: string;
  kind?: "task" | "belonging";
  initialItems: InitialItem[];
}) {
  const isBelonging = kind === "belonging";
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
      })),
    [initialItems],
  );

  const [items, setItems] = useState<Item[]>(initial);
  const [removedTitles, setRemovedTitles] = useState<string[]>([]);
  const [pending, startTransition] = useTransition();
  const [saved, setSaved] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkText, setBulkText] = useState("");
  const [bulkNote, setBulkNote] = useState<string | null>(null);

  const originalTitles = useMemo(
    () => new Set(initialItems.map((i) => i.title)),
    [initialItems],
  );

  const dirty =
    JSON.stringify(items.map(strip)) !== JSON.stringify(initial.map(strip)) ||
    removedTitles.length > 0;

  const syncedRef = useRef(initial);
  useEffect(() => {
    const userEdited =
      JSON.stringify(items.map(strip)) !==
        JSON.stringify(syncedRef.current.map(strip)) ||
      removedTitles.length > 0;
    syncedRef.current = initial;
    if (userEdited) return;
    setItems(initial);
    setRemovedTitles([]);
    setSaved(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initial]);

  function toPayload(list: Item[]) {
    return list
      .filter((it) => it.title.trim())
      .map((it) => ({
        title: it.title.trim(),
        comment: it.comment.trim() || null,
        isDone: it.isDone,
        isUserAdded: it.isUserAdded,
        notifyLeadMinutes: it.notifyLeadMinutes,
      }));
  }

  function persist(list: Item[]) {
    startTransition(async () => {
      await saveChecklist({ eventId, kind, items: toPayload(list), removedTitles });
      setRemovedTitles([]);
      setSaved(true);
    });
  }

  function update(key: string, patch: Partial<Item>) {
    setItems((prev) =>
      prev.map((it) => (it.key === key ? { ...it, ...patch } : it)),
    );
    setSaved(false);
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
    setItems((prev) => {
      const target = prev.find((it) => it.key === key);
      if (target && originalTitles.has(target.title)) {
        setRemovedTitles((r) =>
          r.includes(target.title) ? r : [...r, target.title],
        );
      }
      return prev.filter((it) => it.key !== key);
    });
    setSaved(false);
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

  return (
    <div className="rounded-2xl bg-surface p-4">
      <ul className="divide-y divide-border">
        {items.map((it) => {
          const c = splitLead(it.notifyLeadMinutes ?? DEFAULT_LEAD);
          const showCustom =
            it.notifyCustom ||
            (it.notifyLeadMinutes != null && !isLeadPreset(it.notifyLeadMinutes));
          const selValue = showCustom
            ? "custom"
            : it.notifyLeadMinutes == null
              ? "none"
              : String(it.notifyLeadMinutes);
          return (
            <li key={it.key} className="flex items-start gap-2.5 py-2.5">
              <input
                type="checkbox"
                checked={it.isDone}
                onChange={(e) => toggleDone(it, e.target.checked)}
                className="mt-1.5 h-4 w-4 shrink-0 accent-[var(--teal)]"
                aria-label="完了"
              />
              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex items-center gap-2">
                  <input
                    value={it.title}
                    onChange={(e) => update(it.key, { title: e.target.value })}
                    placeholder={
                      isBelonging ? "持ち物を書く" : "準備することを書く"
                    }
                    className={`min-w-0 flex-1 rounded-md border border-transparent bg-transparent px-1 py-1 text-sm hover:border-border focus:border-border focus:bg-background ${
                      it.isDone ? "text-muted line-through" : ""
                    }`}
                  />
                  {it.isUserAdded && (
                    <span className="shrink-0 rounded bg-accent-soft px-1.5 py-0.5 text-[10px] text-teal-dark">
                      追加
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() => remove(it.key)}
                    className="shrink-0 rounded px-1.5 py-0.5 text-xs text-muted hover:bg-warn-soft hover:text-warn"
                    aria-label="削除"
                  >
                    削除
                  </button>
                </div>

                <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted">
                  <span>🔔 通知</span>
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

                <input
                  value={it.comment}
                  onChange={(e) => update(it.key, { comment: e.target.value })}
                  placeholder="メモ（任意・学習しません）"
                  className="w-full rounded-md border border-transparent bg-transparent px-1 py-0.5 text-xs text-muted hover:border-border focus:border-border focus:bg-background"
                />
              </div>
            </li>
          );
        })}
      </ul>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={add}
            className="rounded-lg border border-dashed border-border px-3 py-1.5 text-sm text-muted hover:border-teal hover:text-teal-dark"
          >
            ＋ 項目を追加
          </button>
          <button
            type="button"
            onClick={() => {
              setBulkOpen((v) => !v);
              setBulkNote(null);
            }}
            className="rounded-lg border border-dashed border-border px-3 py-1.5 text-sm text-muted hover:border-teal hover:text-teal-dark"
          >
            メモから一括追加
          </button>
        </div>

        <div className="flex items-center gap-3">
          {saved && !dirty && (
            <span className="text-xs text-teal-dark">保存しました</span>
          )}
          <button
            type="button"
            onClick={() => persist(items)}
            disabled={pending || !dirty}
            className="rounded-lg bg-teal px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-teal-dark disabled:opacity-50"
          >
            {pending ? "保存中…" : "保存する"}
          </button>
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
              className="rounded-lg bg-teal px-3 py-1.5 text-sm font-medium text-white hover:bg-teal-dark disabled:opacity-50"
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

      <p className="mt-2 text-[11px] text-muted">
        チェックと通知タイミングは自動保存・自動学習。文言・メモの変更は「保存する」で反映（メモは学習しません）。
      </p>
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
