"use client";

import { useState } from "react";
import { HomePriorityRows, type HomePriorityRowData } from "@/app/components/priority-home-rows";
import {
  addStandalonePriorityItemAction,
  loadCompletedPriorityItemsAction,
  toggleStandalonePriorityItemAction,
  toggleFutureMessageDoneAction,
  toggleChecklistItemDone,
  type CompletedPriorityRowData,
} from "@/app/actions";
import { formatDateShort } from "@/lib/format";

interface CompletedState {
  open: boolean;
  rows: CompletedPriorityRowData[] | null;
  loading: boolean;
}

const INITIAL_COMPLETED: CompletedState = { open: false, rows: null, loading: false };

/**
 * 「急ぎ」「そのうち」セクションの外枠。サーバーから渡された2つの一覧を、
 * このページを開いた時点でスナップショットして固定する。両方空でもセクション自体は
 * 常に表示する（「今はありません」と出す。ユーザー指定・2026-10-23）。
 *
 * チェックを入れると toggleChecklistItemDone 等が revalidatePath を呼ぶため、何も
 * しないとこのページに居続けている間に親（Server Component）の再レンダリングで
 * props が更新され、チェックした項目が0件になった瞬間にこのセクション自体が
 * ツリーから消えてしまう。`useState` の初期値は初回マウント時にしか使われないため、
 * 以後 props が変わってもこのスナップショットは変わらない。別ページへ移動して
 * 戻ってくる＝再マウントされたときだけ、最新の一覧で出し直される。
 *
 * 予定に紐づかない項目をこのページから直接追加できる（ユーザー指定・2026-10-23）。
 *
 * 完了した項目は、チェックした瞬間にこの一覧から消え「完了した項目を見る」コーナーへ
 * すぐ移る（`completeItem`）。「完了した項目を見る」コーナーで復活させると、その瞬間に
 * 通常の一覧へ即座に戻る（`reviveToActive`）。以前は「チェックしてもページを出るまで
 * 消さない」方針だったが、完了コーナーができたことで、消えてもすぐ見返せる・戻せる
 * ため、この一覧に限りその方針を外した（ユーザー指摘「完了した項目を見るコーナーが
 * できたから、完了した時にページを出るまでそのままにするやつ無くしていいよ。すぐ完了
 * コーナーに行っていいよ」、2026-10-24）。
 */
export function PriorityHomeContainer({
  urgent,
  later,
}: {
  urgent: HomePriorityRowData[];
  later: HomePriorityRowData[];
}) {
  const [frozenUrgent, setFrozenUrgent] = useState(urgent);
  const [frozenLater, setFrozenLater] = useState(later);
  const [completedUrgent, setCompletedUrgent] = useState<CompletedState>(INITIAL_COMPLETED);
  const [completedLater, setCompletedLater] = useState<CompletedState>(INITIAL_COMPLETED);

  function addItem(priority: "urgent" | "later", title: string) {
    const t = title.trim();
    if (!t) return;
    const tempId = `tmp:${Date.now()}:${Math.random().toString(36).slice(2)}`;
    const row: HomePriorityRowData = {
      key: `standalone:${tempId}`,
      title: t,
      eventId: null,
      eventTitle: null,
      eventDate: null,
      isPast: false,
      isMessage: false,
      isStandalone: true,
      toggleId: tempId,
    };
    const setList = priority === "urgent" ? setFrozenUrgent : setFrozenLater;
    setList((prev) => [row, ...prev]);
    void addStandalonePriorityItemAction(t, priority).then((res) => {
      if (!res.ok || !res.id) {
        setList((prev) => prev.filter((r) => r.key !== row.key));
        return;
      }
      const realId = res.id;
      setList((prev) =>
        prev.map((r) =>
          r.key === row.key ? { ...r, key: `standalone:${realId}`, toggleId: realId } : r,
        ),
      );
    });
  }

  function reviveToActive(priority: "urgent" | "later", row: HomePriorityRowData) {
    const setList = priority === "urgent" ? setFrozenUrgent : setFrozenLater;
    setList((prev) => (prev.some((r) => r.key === row.key) ? prev : [row, ...prev]));
  }

  /** 急ぎ/そのうち一覧でチェックした瞬間に呼ばれる。その一覧からは `HomePriorityRows`
   * 側で即座に消える（`removed`）ので、ここでは「完了した項目を見る」コーナーが
   * 既に開いている・取得済みなら、そちらの先頭にも足す（開いていなければ何もしない。
   * 次に開いたときにサーバーから取り直した一覧に、この完了も反映されている）。 */
  function completeItem(priority: "urgent" | "later", row: CompletedPriorityRowData) {
    const setCompleted = priority === "urgent" ? setCompletedUrgent : setCompletedLater;
    setCompleted((s) => (s.rows ? { ...s, rows: [row, ...s.rows] } : s));
  }

  async function toggleCompletedOpen(priority: "urgent" | "later") {
    const state = priority === "urgent" ? completedUrgent : completedLater;
    const setState = priority === "urgent" ? setCompletedUrgent : setCompletedLater;
    if (!state.open && state.rows === null) {
      setState((s) => ({ ...s, loading: true }));
      const res = await loadCompletedPriorityItemsAction(priority);
      setState((s) => ({ ...s, rows: res, loading: false, open: true }));
      return;
    }
    setState((s) => ({ ...s, open: !s.open }));
  }

  function reviveFromCompleted(priority: "urgent" | "later", row: CompletedPriorityRowData) {
    const setState = priority === "urgent" ? setCompletedUrgent : setCompletedLater;
    setState((s) => ({
      ...s,
      rows: s.rows ? s.rows.filter((x) => x.key !== row.key) : s.rows,
    }));
    reviveToActive(priority, row);
    if (row.isStandalone) {
      void toggleStandalonePriorityItemAction(row.toggleId, false);
    } else if (row.isMessage) {
      void toggleFutureMessageDoneAction(row.toggleId, false);
    } else {
      void toggleChecklistItemDone(row.toggleId, false);
    }
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <section className="rounded-2xl border border-warn/30 bg-warn-soft p-4">
        <h2 className="text-sm font-semibold text-warn">🔥 急ぎ</h2>
        <div className="mt-2">
          <HomePriorityRows
            rows={frozenUrgent}
            onComplete={(row) => completeItem("urgent", row)}
          />
        </div>
        <AddPriorityItemForm onAdd={(title) => addItem("urgent", title)} />
        <CompletedPriorityItemsToggle
          state={completedUrgent}
          onToggleOpen={() => toggleCompletedOpen("urgent")}
          onRevive={(row) => reviveFromCompleted("urgent", row)}
        />
      </section>
      <section className="rounded-2xl border border-teal/30 bg-teal-soft p-4">
        <h2 className="text-sm font-semibold text-teal-dark">🕒 そのうち</h2>
        <div className="mt-2">
          <HomePriorityRows
            rows={frozenLater}
            onComplete={(row) => completeItem("later", row)}
          />
        </div>
        <AddPriorityItemForm onAdd={(title) => addItem("later", title)} />
        <CompletedPriorityItemsToggle
          state={completedLater}
          onToggleOpen={() => toggleCompletedOpen("later")}
          onRevive={(row) => reviveFromCompleted("later", row)}
        />
      </section>
    </div>
  );
}

function AddPriorityItemForm({ onAdd }: { onAdd: (title: string) => void }) {
  const [value, setValue] = useState("");

  function submit() {
    if (!value.trim()) return;
    onAdd(value);
    setValue("");
  }

  return (
    <div className="mt-2 flex items-center gap-1.5">
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            submit();
          }
        }}
        maxLength={120}
        placeholder="項目を追加"
        className="min-w-0 flex-1 rounded-md border border-border bg-background px-2 py-1 text-xs"
      />
      <button
        type="button"
        onClick={submit}
        disabled={!value.trim()}
        className="shrink-0 rounded-md border border-foreground bg-foreground px-2 py-1 text-xs font-medium text-surface hover:opacity-90 disabled:opacity-50"
      >
        ＋追加
      </button>
    </div>
  );
}

/**
 * 「完了した項目を見る」（2026-10-24追加・ユーザー指定）。押すまでは何も取得しない
 * （`loadCompletedPriorityItemsAction` は初回展開時に1回だけ呼ぶ）。状態は親
 * （`PriorityHomeContainer`）が持つ（`completeItem` で急ぎ/そのうち一覧からの完了を
 * その場で反映できるようにするため）。
 * チェックは常に「オン」から始まり、外すと復活（予定に紐づく項目は
 * toggleChecklistItemDone／toggleFutureMessageDoneAction、予定に紐づかない項目は
 * toggleStandalonePriorityItemAction。これらが実データの isDone を直接更新し、
 * 予定に紐づく項目はカレンダー説明欄への反映も既存の仕組みでそのまま行われる）。
 * 外した**その瞬間**に、この一覧から取り除くのと同時に、通常の急ぎ/そのうち一覧にも
 * 即座に戻す。
 */
function CompletedPriorityItemsToggle({
  state,
  onToggleOpen,
  onRevive,
}: {
  state: CompletedState;
  onToggleOpen: () => void;
  onRevive: (row: CompletedPriorityRowData) => void;
}) {
  const { open, rows, loading } = state;

  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={onToggleOpen}
        className="text-xs text-muted underline hover:text-foreground"
      >
        {open ? "▾" : "▸"} 完了した項目を見る{rows ? `（${rows.length}件）` : ""}
      </button>
      {open && (
        <div className="mt-1.5">
          {loading ? (
            <p className="text-xs text-muted">読み込み中…</p>
          ) : rows && rows.length === 0 ? (
            <p className="text-xs text-muted">完了した項目はありません。</p>
          ) : (
            <ul className="space-y-1">
              {rows?.map((r) => (
                <li
                  key={r.key}
                  className="flex items-start gap-2 rounded-lg bg-surface px-2 py-1.5"
                >
                  <input
                    type="checkbox"
                    checked
                    onChange={() => onRevive(r)}
                    aria-label="完了を取り消して復活させる"
                    className="mt-1 h-5 w-5 shrink-0 accent-[var(--teal)]"
                  />
                  <span className="min-w-0 flex-1 py-0.5">
                    <span className="block text-sm text-muted line-through">{r.title}</span>
                    {!r.isStandalone && r.eventTitle && (
                      <span className="block text-[11px] text-muted">
                        {r.eventTitle}
                        {r.eventDate ? ` ・ ${formatDateShort(r.eventDate)}` : ""}
                        {r.isPast ? "（過去）" : ""}
                      </span>
                    )}
                    {r.isStandalone && (
                      <span className="block text-[11px] text-muted">手動で追加</span>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
