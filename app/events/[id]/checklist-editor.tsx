"use client";

import { useMemo, useState, useTransition } from "react";
import { saveChecklist, toggleChecklistItemDone } from "@/app/actions";

interface Item {
  key: string;
  id: string | null;
  title: string;
  timingLabel: string;
  comment: string;
  isDone: boolean;
  isUserAdded: boolean;
  notifyLeadMinutes: number | null; // 予定開始の何分前に通知するか。null = しない
  notifyCustom: boolean; // カスタム入力（時間・分）を出しているか（UIのみ）
}

interface InitialItem {
  id: string | null;
  title: string;
  timingLabel: string | null;
  comment: string | null;
  isDone: boolean;
  isUserAdded: boolean;
  notifyLeadMinutes: number | null;
}

const TIMING_PRESETS = [
  "1週間前",
  "3日前",
  "前日",
  "前日夜",
  "当日朝",
  "当日",
  "30分前",
  "出発1時間前",
];

const NOTIFY_PRESETS: { label: string; minutes: number | null }[] = [
  { label: "通知なし", minutes: null },
  { label: "10分前", minutes: 10 },
  { label: "30分前", minutes: 30 },
  { label: "1時間前", minutes: 60 },
  { label: "2時間前", minutes: 120 },
  { label: "3時間前", minutes: 180 },
  { label: "6時間前", minutes: 360 },
  { label: "12時間前", minutes: 720 },
  { label: "前日（24時間前）", minutes: 1440 },
  { label: "2日前", minutes: 2880 },
  { label: "3日前", minutes: 4320 },
  { label: "1週間前", minutes: 10080 },
];

const isNotifyPreset = (m: number | null) =>
  NOTIFY_PRESETS.some((p) => p.minutes === m);

let counter = 0;
const nextKey = () => `it-${counter++}`;

const normTitle = (s: string) => s.toLowerCase().replace(/\s+/g, "").trim();

/** メモ帳などから貼り付けたテキストを、1行1項目に分解する。記号・番号・末尾の（目安）は落とす。 */
function parseBulk(text: string): { title: string; timingLabel: string }[] {
  let lines = text.split(/\r?\n/);
  // 1行だけで「、」や「,」区切りなら、それで分ける
  if (lines.length === 1 && /[、,]/.test(lines[0])) {
    lines = lines[0].split(/[、,]/);
  }
  const out: { title: string; timingLabel: string }[] = [];
  const seen = new Set<string>();
  for (const raw of lines) {
    let line = raw.replace(/[　 ]/g, " ").trim();
    if (!line) continue;
    // 行頭の箇条書き記号・チェックボックス・番号
    line = line
      .replace(
        /^(?:[-*・•‣▸▹>＞○●◦]|\[[ xX]\]|[☐☑✅⬜◻◼■□▪▫]|\d+[.)、]|[（(]\d+[）)])\s*/,
        "",
      )
      .trim();
    // 行頭の「済 / done / ✓」など
    line = line.replace(/^(?:済み?|done|[✓✔☑])\s*[:：\-]?\s*/i, "").trim();
    if (!line) continue;
    // 末尾の（目安）→ タイミングに
    let timingLabel = "";
    const m = line.match(/^(.*?)[（(]\s*([^（()）]{1,16})\s*[）)]\s*$/);
    if (m && m[1].trim()) {
      line = m[1].trim();
      timingLabel = m[2].trim();
    }
    if (!line) continue;
    const key = normTitle(line);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push({ title: line.slice(0, 120), timingLabel });
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
        timingLabel: it.timingLabel ?? "",
        comment: it.comment ?? "",
        isDone: it.isDone,
        isUserAdded: it.isUserAdded,
        notifyLeadMinutes: it.notifyLeadMinutes ?? null,
        notifyCustom:
          it.notifyLeadMinutes != null && !isNotifyPreset(it.notifyLeadMinutes),
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

  // isDone は個別に自動保存するので dirty 判定から除外
  const dirty =
    JSON.stringify(items.map(strip)) !== JSON.stringify(initial.map(strip)) ||
    removedTitles.length > 0;

  function toPayload(list: Item[]) {
    return list
      .filter((it) => it.title.trim())
      .map((it) => ({
        title: it.title.trim(),
        timingLabel: it.timingLabel.trim() || null,
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

  // カスタムの「X時間 Y分前」→ 分に合成（両方 0 なら通知なし）
  function setCustomLead(key: string, hoursRaw: string, minsRaw: string) {
    const h = Math.max(0, Math.min(336, Math.floor(Number(hoursRaw) || 0)));
    const m = Math.max(0, Math.min(59, Math.floor(Number(minsRaw) || 0)));
    const total = h * 60 + m;
    update(key, { notifyLeadMinutes: total > 0 ? total : null });
  }

  function onNotifySelect(it: Item, value: string) {
    if (value === "custom") {
      update(it.key, {
        notifyCustom: true,
        notifyLeadMinutes: it.notifyLeadMinutes ?? 60,
      });
    } else if (value === "none") {
      update(it.key, { notifyCustom: false, notifyLeadMinutes: null });
    } else {
      update(it.key, { notifyCustom: false, notifyLeadMinutes: Number(value) });
    }
  }

  // チェックはその場で保存（「保存する」ボタン不要）
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
        timingLabel: "",
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
        timingLabel: p.timingLabel,
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
        {items.map((it) => (
          <li key={it.key} className="flex items-start gap-3 py-3">
            <input
              type="checkbox"
              checked={it.isDone}
              onChange={(e) => toggleDone(it, e.target.checked)}
              className="mt-2 h-4 w-4 shrink-0 accent-[var(--teal)]"
              aria-label="完了"
            />
            <div className="flex-1 space-y-1">
              <input
                value={it.title}
                onChange={(e) => update(it.key, { title: e.target.value })}
                placeholder={isBelonging ? "持ち物を書く" : "準備することを書く"}
                className={`w-full rounded-md border border-transparent bg-transparent px-1 py-1 text-sm hover:border-border focus:border-border focus:bg-background ${
                  it.isDone ? "text-muted line-through" : ""
                }`}
              />
              <div className="flex items-center gap-2">
                <input
                  value={it.timingLabel}
                  onChange={(e) =>
                    update(it.key, { timingLabel: e.target.value })
                  }
                  list={`timing-presets-${kind}`}
                  placeholder={isBelonging ? "用意する目安" : "タイミング"}
                  className="w-32 rounded-md border border-transparent bg-transparent px-1 py-0.5 text-xs text-muted hover:border-border focus:border-border focus:bg-background"
                />
                {it.isUserAdded && (
                  <span className="rounded bg-accent-soft px-1.5 py-0.5 text-[10px] text-teal-dark">
                    追加
                  </span>
                )}
              </div>

              {/* 通知（予定の何時間何分前 / なし）。内容とセットで学習される */}
              <div className="flex flex-wrap items-center gap-1 text-xs text-muted">
                <span className="text-[11px]">🔔 通知</span>
                <select
                  value={
                    it.notifyCustom || !isNotifyPreset(it.notifyLeadMinutes)
                      ? "custom"
                      : it.notifyLeadMinutes === null
                        ? "none"
                        : String(it.notifyLeadMinutes)
                  }
                  onChange={(e) => onNotifySelect(it, e.target.value)}
                  className="rounded-md border border-transparent bg-transparent px-1 py-0.5 text-xs hover:border-border focus:border-border focus:bg-background"
                >
                  {NOTIFY_PRESETS.map((p) => (
                    <option
                      key={p.label}
                      value={p.minutes === null ? "none" : String(p.minutes)}
                    >
                      {p.label}
                    </option>
                  ))}
                  <option value="custom">カスタム…</option>
                </select>
                {(it.notifyCustom || !isNotifyPreset(it.notifyLeadMinutes)) && (
                  <span className="inline-flex items-center gap-1">
                    <input
                      type="number"
                      min={0}
                      max={336}
                      value={Math.floor((it.notifyLeadMinutes ?? 0) / 60) || ""}
                      onChange={(e) =>
                        setCustomLead(
                          it.key,
                          e.target.value,
                          String((it.notifyLeadMinutes ?? 0) % 60),
                        )
                      }
                      className="w-12 rounded border bg-background px-1 py-0.5 text-xs"
                      aria-label="時間"
                    />
                    時間
                    <input
                      type="number"
                      min={0}
                      max={59}
                      value={(it.notifyLeadMinutes ?? 0) % 60 || ""}
                      onChange={(e) =>
                        setCustomLead(
                          it.key,
                          String(Math.floor((it.notifyLeadMinutes ?? 0) / 60)),
                          e.target.value,
                        )
                      }
                      className="w-12 rounded border bg-background px-1 py-0.5 text-xs"
                      aria-label="分"
                    />
                    分前
                  </span>
                )}
              </div>

              <input
                value={it.comment}
                onChange={(e) => update(it.key, { comment: e.target.value })}
                placeholder="コメント（任意・学習しません）"
                className="w-full rounded-md border border-transparent bg-transparent px-1 py-0.5 text-xs text-muted hover:border-border focus:border-border focus:bg-background"
              />
            </div>
            <button
              type="button"
              onClick={() => remove(it.key)}
              className="mt-1 shrink-0 rounded px-1.5 py-0.5 text-xs text-muted hover:bg-warn-soft hover:text-warn"
              aria-label="削除"
            >
              削除
            </button>
          </li>
        ))}
      </ul>

      <datalist id={`timing-presets-${kind}`}>
        {TIMING_PRESETS.map((t) => (
          <option key={t} value={t} />
        ))}
      </datalist>

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
                ? "メモを貼り付け。1行に1つ。例:\n充電器\nモバイルバッテリー\n常備薬（前日夜）"
                : "メモを貼り付け。1行に1つ。例:\n宿の予約を確認する（1週間前）\n・切符を用意する\n1. 戸締まりチェック"
            }
            className="w-full rounded-lg border bg-surface px-3 py-2 text-sm"
          />
          <p className="mt-1 text-[11px] text-muted">
            行頭の「・」「-」「1.」やチェック記号、末尾の（目安）は自動で取り除きます。重複はスキップします。
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
        チェックは自動保存。文言・タイミング・コメントの変更は「保存する」で反映（コメントは学習しません）。
      </p>
    </div>
  );
}

function strip(it: Item) {
  return {
    title: it.title.trim(),
    timingLabel: it.timingLabel.trim(),
    comment: it.comment.trim(),
    notifyLeadMinutes: it.notifyLeadMinutes,
  };
}
