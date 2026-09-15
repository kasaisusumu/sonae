"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { previewDictatedFailures, saveDictatedFailures } from "@/app/actions";
import { formatDateOnly } from "@/lib/format";

type DraftItem = { description: string; countermeasure: string };

/**
 * スマホのキーボードのマイクキーで「何があった・どんな対策を考えたか」を
 * 思いつくまま話し、AI で「何が起きたか」「有効だった対策」に分ける。
 * 準備リストの `DictationInput` と同じ考え方だが、失敗ログは記録が残る性質上、
 * AI が整えた内容をその場で確認・修正してから保存する（いきなり保存しない）。
 */
export function FailureDictationInput({
  eventId = null,
  events,
}: {
  /** 予定に紐づけて記録したいとき（固定。選択 UI は出さない）。 */
  eventId?: string | null;
  /** 紐づける予定を選べるようにしたいとき（例: /failures ページ）に渡す。eventId 指定時は無視。 */
  events?: { id: string; title: string; eventDatetime: Date }[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<"input" | "review">("input");
  const [text, setText] = useState("");
  const [selectedEventId, setSelectedEventId] = useState("");
  const [items, setItems] = useState<DraftItem[]>([]);
  const [note, setNote] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const showEventPicker = !eventId && !!events && events.length > 0;

  function reset() {
    setPhase("input");
    setText("");
    setSelectedEventId("");
    setItems([]);
    setErr(null);
  }

  function openPopup() {
    reset();
    setNote(null);
    setOpen(true);
  }

  function preview() {
    const t = text.trim();
    if (!t || pending) return;
    setErr(null);
    startTransition(async () => {
      const res = await previewDictatedFailures(t);
      if (res.ok) {
        setItems(
          res.items.map((it) => ({
            description: it.description,
            countermeasure: it.countermeasure ?? "",
          })),
        );
        setPhase("review");
      } else {
        setErr(res.error ?? "うまくいきませんでした。");
      }
    });
  }

  function updateItem(i: number, patch: Partial<DraftItem>) {
    setItems((cur) => cur.map((it, idx) => (idx === i ? { ...it, ...patch } : it)));
  }

  function removeItem(i: number) {
    setItems((cur) => cur.filter((_, idx) => idx !== i));
  }

  function confirmSave() {
    if (pending) return;
    const cleanItems = items
      .map((it) => ({
        description: it.description.trim(),
        countermeasure: it.countermeasure.trim() || null,
      }))
      .filter((it) => it.description.length > 0);
    if (cleanItems.length === 0) {
      setErr("内容がありません。");
      return;
    }
    const targetEventId = eventId ?? (selectedEventId || null);
    const linkedEvent = !eventId
      ? events?.find((e) => e.id === selectedEventId)
      : null;
    setErr(null);
    startTransition(async () => {
      const res = await saveDictatedFailures({
        eventId: targetEventId,
        items: cleanItems,
      });
      if (res.ok) {
        const where = eventId
          ? "この予定の「考えられる失敗」に追加しました。"
          : linkedEvent
            ? `「${linkedEvent.title}」に追加しました。`
            : "下の「▸ 予定に紐づかない記録を見る」に追加しました。";
        setNote(
          `${res.added > 1 ? `${res.added}件、` : ""}記録しました。${where}`,
        );
        reset();
        router.refresh();
      } else {
        setErr(res.error ?? "うまくいきませんでした。");
      }
    });
  }

  return (
    <>
      <button
        type="button"
        data-coach="fail-dictation"
        onClick={openPopup}
        className="inline-flex items-center gap-1 rounded-lg border border-border bg-surface px-2.5 py-1.5 text-xs text-foreground hover:bg-surface-muted"
      >
        🎤 話して記録する
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => setOpen(false)}
        >
          <div
            className="max-h-[85vh] w-full max-w-sm space-y-3 overflow-y-auto rounded-2xl bg-surface p-5 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-sm font-semibold text-foreground">
              🎤 話して記録する
            </h3>

            {phase === "input" ? (
              <>
                <p className="text-[11px] text-muted">
                  スマホのキーボードの<strong>マイクキー</strong>で、何があったか、
                  思いついた対策があればそれも合わせて話してください。複数あれば
                  まとめて話してもOK、<strong>それぞれ別々に</strong>記録します。
                </p>
                <textarea
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  rows={4}
                  placeholder={
                    "例: 集合時間に遅刻しちゃった。あと保険証も忘れた。次からは前日にリマインダーを設定しておこうと思う。"
                  }
                  className="w-full rounded-lg border bg-background px-3 py-2 text-sm"
                />
                <div className="flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    onClick={preview}
                    disabled={pending || !text.trim()}
                    className="rounded-lg bg-foreground px-4 py-2 text-sm font-medium text-surface shadow-sm transition-colors hover:opacity-90 disabled:opacity-50"
                  >
                    {pending ? "整えています…" : "AIで整えて確認する"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setOpen(false)}
                    className="text-xs text-muted underline hover:text-foreground"
                  >
                    閉じる
                  </button>
                </div>
              </>
            ) : (
              <>
                <p className="text-xs font-medium text-foreground">
                  この内容でよろしいですか？
                </p>
                <p className="text-[11px] text-muted">
                  内容はその場で直せます。不要な項目は「削除」で外せます。
                </p>

                {showEventPicker && (
                  <label className="block text-xs text-muted">
                    どの予定？
                    <select
                      value={selectedEventId}
                      onChange={(e) => setSelectedEventId(e.target.value)}
                      className="mt-1 w-full rounded-lg border bg-background px-3 py-2 text-sm text-foreground"
                    >
                      <option value="">
                        — 紐づけない（カテゴリ全体の記録）—
                      </option>
                      {events!.map((e) => (
                        <option key={e.id} value={e.id}>
                          {formatDateOnly(e.eventDatetime)} {e.title}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                {!!eventId && (
                  <p className="rounded-lg bg-surface-muted px-3 py-2 text-[11px] text-muted">
                    この予定に紐づけて記録します。
                  </p>
                )}

                <div className="space-y-3">
                  {items.map((it, i) => (
                    <div
                      key={i}
                      className="space-y-1.5 rounded-lg border border-border p-2.5"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[11px] text-muted">
                          {items.length > 1 ? `${i + 1}件目` : "内容"}
                        </span>
                        {items.length > 1 && (
                          <button
                            type="button"
                            onClick={() => removeItem(i)}
                            className="text-[11px] text-muted underline hover:text-warn"
                          >
                            削除
                          </button>
                        )}
                      </div>
                      <textarea
                        value={it.description}
                        onChange={(e) =>
                          updateItem(i, { description: e.target.value })
                        }
                        rows={2}
                        placeholder="何が起きたか"
                        className="w-full rounded-lg border bg-background px-2.5 py-1.5 text-sm"
                      />
                      <textarea
                        value={it.countermeasure}
                        onChange={(e) =>
                          updateItem(i, { countermeasure: e.target.value })
                        }
                        rows={1}
                        placeholder="有効だった対策（あれば・任意）"
                        className="w-full rounded-lg border bg-background px-2.5 py-1.5 text-sm"
                      />
                    </div>
                  ))}
                  {items.length === 0 && (
                    <p className="text-[11px] text-muted">
                      すべて削除しました。「戻る」からやり直せます。
                    </p>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    onClick={confirmSave}
                    disabled={pending || items.length === 0}
                    className="rounded-lg bg-foreground px-4 py-2 text-sm font-medium text-surface shadow-sm transition-colors hover:opacity-90 disabled:opacity-50"
                  >
                    {pending ? "記録中…" : "この内容で記録する"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setPhase("input")}
                    disabled={pending}
                    className="text-xs text-muted underline hover:text-foreground"
                  >
                    戻る
                  </button>
                  <button
                    type="button"
                    onClick={() => setOpen(false)}
                    disabled={pending}
                    className="text-xs text-muted underline hover:text-foreground"
                  >
                    閉じる
                  </button>
                </div>
              </>
            )}

            {note && <p className="text-[11px] text-teal-dark">{note}</p>}
            {err && <p className="text-[11px] text-warn">{err}</p>}
            <p className="text-[10px] text-muted">
              記録された内容は、いつも通りその場で直したり消したりできます。
            </p>
          </div>
        </div>
      )}
    </>
  );
}
