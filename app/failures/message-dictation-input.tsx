"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { previewDictatedMessages, saveDictatedMessages } from "@/app/actions";

type Draft = { body: string; keywords: string };

/**
 * スマホのキーボードのマイクキーで「いつか思い出したいこと」を話し、AI で
 * 本文・キーワード・ジャンルに分ける。その場で確認・修正してから保存する
 * （いきなり保存しない）。複数話しても、確認するのは常に1件ずつ。
 * 予定への紐づけは、キーワード一致による自動結びつけに任せる（手動で予定を
 * 選ぶ UI は持たない。2026-10 に撤去。クイック記録の最中に予定を選ばせるのは
 * 手間になるだけという判断。eventId を渡したときだけ、その予定に固定で紐づける）。
 */
export function MessageDictationInput({
  eventId = null,
}: {
  /** 予定に紐づけて記録したいとき（固定。予定詳細から呼ぶときに渡す）。 */
  eventId?: string | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<"input" | "review">("input");
  const [text, setText] = useState("");
  const [draft, setDraft] = useState<Draft>({ body: "", keywords: "" });
  const [moreCount, setMoreCount] = useState(0);
  const [note, setNote] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function reset() {
    setPhase("input");
    setText("");
    setDraft({ body: "", keywords: "" });
    setMoreCount(0);
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
      const res = await previewDictatedMessages(t);
      if (res.ok) {
        const [first, ...rest] = res.items;
        setDraft({
          body: first.body,
          keywords: first.keywords.join("、"),
        });
        setMoreCount(rest.length);
        setPhase("review");
      } else {
        setErr(res.error ?? "うまくいきませんでした。");
      }
    });
  }

  function confirmSave() {
    if (pending) return;
    const body = draft.body.trim();
    if (!body) {
      setErr("内容がありません。");
      return;
    }
    if (!draft.keywords.trim()) {
      const ok = window.confirm(
        "キーワードが未設定です。このままだと、似た予定が来ても自動では思い出せません。このまま保存しますか？",
      );
      if (!ok) return;
    }
    setErr(null);
    startTransition(async () => {
      const res = await saveDictatedMessages({
        eventId,
        items: [
          {
            body,
            keywords: draft.keywords.split(/[、,，]/).map((s) => s.trim()).filter(Boolean),
          },
        ],
      });
      if (res.ok) {
        const where = eventId
          ? "この予定の「未来の自分へ」に追加しました。"
          : "下の「▸ 登録したメッセージを見る」に追加しました。";
        setNote(`記録しました。${where}`);
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
        data-coach="message-dictation"
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
                  スマホのキーボードの<strong>マイクキー</strong>で、次に思い出したい
                  ことを話してください。人名・会社名など、次回その予定を見分けるのに
                  使えそうな語があれば<strong>キーワード</strong>として自動で拾います。
                  1回につき1件、確認してから記録します。複数あれば、記録したあとに
                  もう一度話してください。
                </p>
                <p className="rounded-lg bg-surface-muted px-3 py-2 text-[11px] text-muted">
                  例: 「<strong className="text-foreground">田中さん</strong>とは前回の
                  ギブアンドテイクがあるから、次に会うときは忘れない」→
                  キーワード「<strong className="text-foreground">田中さん</strong>」
                </p>
                <textarea
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  rows={4}
                  placeholder="例: 田中さんとは前回のギブアンドテイクがあるから、次に会うときは忘れない。"
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
                {moreCount > 0 && (
                  <p className="rounded-lg bg-surface-muted px-3 py-2 text-[11px] text-muted">
                    ほかにも話した内容があるようです。まず1件目を確認してください。
                    残りは記録したあと、もう一度「🎤 話して記録する」からどうぞ。
                  </p>
                )}

                <p className="rounded-lg bg-surface-muted px-3 py-2 text-[11px] text-muted">
                  {eventId
                    ? "この予定に紐づけて記録します。"
                    : "キーワードが一致する予定があれば、あとで自動で結びつきます。"}
                </p>

                <label className="block text-xs text-muted">
                  次に思い出したいこと
                  <textarea
                    value={draft.body}
                    onChange={(e) => setDraft((d) => ({ ...d, body: e.target.value }))}
                    rows={2}
                    className="mt-1 w-full rounded-lg border bg-background px-2.5 py-1.5 text-sm text-foreground"
                  />
                </label>
                <label className="block text-xs text-muted">
                  キーワード（あれば複数・読点区切り・無くてもよい）
                  <input
                    value={draft.keywords}
                    onChange={(e) => setDraft((d) => ({ ...d, keywords: e.target.value }))}
                    className="mt-1 w-full rounded-lg border bg-background px-2.5 py-1.5 text-sm text-foreground"
                  />
                </label>

                <div className="flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    onClick={confirmSave}
                    disabled={pending || !draft.body.trim()}
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
