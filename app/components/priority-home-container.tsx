"use client";

import { useState } from "react";
import { HomePriorityRows, type HomePriorityRowData } from "@/app/components/priority-home-rows";

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
 */
export function PriorityHomeContainer({
  urgent,
  later,
}: {
  urgent: HomePriorityRowData[];
  later: HomePriorityRowData[];
}) {
  const [frozenUrgent] = useState(urgent);
  const [frozenLater] = useState(later);

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <section className="rounded-2xl border border-warn/30 bg-warn-soft p-4">
        <h2 className="text-sm font-semibold text-warn">🔥 急ぎ</h2>
        <div className="mt-2">
          <HomePriorityRows rows={frozenUrgent} />
        </div>
      </section>
      <section className="rounded-2xl border border-teal/30 bg-teal-soft p-4">
        <h2 className="text-sm font-semibold text-teal-dark">🕒 そのうち</h2>
        <div className="mt-2">
          <HomePriorityRows rows={frozenLater} />
        </div>
      </section>
    </div>
  );
}
