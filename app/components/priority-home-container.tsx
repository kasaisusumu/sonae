"use client";

import { useState } from "react";
import { HomePriorityRows, type HomePriorityRowData } from "@/app/components/priority-home-rows";
import { addStandalonePriorityItemAction } from "@/app/actions";

/**
 * 「急ぎ」「そのうち」セクションの外枠。サーバーから渡された2つの一覧を、
 * このページを開いた時点でスナップショットして固定する。両方空でもセクション自体は
 * 常に表示する（「今はありません」と出す。ユーザー指定・2026-10-23）。
 *
 * チェックを入れると toggleChecklistItemDone 等が revalidatePath を呼ぶため、何も
 * しないとこのページに居続けている間に親（Server Component）の再レンダリングで
 * props が更新され、チェックした項目が0件になった瞬間にこのセクション自体が
 * ツリーから消えてしまう（`HomePriorityRows` 側の個別の固定だけでは、親の表示判定
 * 自体が覆ると防げない）。`useState` の初期値は初回マウント時にしか使われないため、
 * 以後 props が変わってもこのスナップショットは変わらない。別ページへ移動して
 * 戻ってくる＝再マウントされたときだけ、最新の一覧（完了済みを除いたもの）で
 * 出し直される（ユーザー指摘により2026-10-23）。
 *
 * 予定に紐づかない項目をこのページから直接追加できる（ユーザー指摘「急ぎ、そのうち
 * リストは、ホームのページから予定に紐づいていなくても項目を好きに追加できるように
 * して」、2026-10-23）。追加は自動保存（保存ボタン無し）で、サーバーの応答を待たず
 * 一覧に足し、応答が来たら本物の id に差し替える。
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

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <section className="rounded-2xl border border-warn/30 bg-warn-soft p-4">
        <h2 className="text-sm font-semibold text-warn">🔥 急ぎ</h2>
        <div className="mt-2">
          <HomePriorityRows rows={frozenUrgent} />
        </div>
        <AddPriorityItemForm onAdd={(title) => addItem("urgent", title)} />
      </section>
      <section className="rounded-2xl border border-teal/30 bg-teal-soft p-4">
        <h2 className="text-sm font-semibold text-teal-dark">🕒 そのうち</h2>
        <div className="mt-2">
          <HomePriorityRows rows={frozenLater} />
        </div>
        <AddPriorityItemForm onAdd={(title) => addItem("later", title)} />
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
