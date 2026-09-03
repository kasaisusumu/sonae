"use client";

import { useEffect, useState } from "react";

const PREFIX = "mm_seen_";

/**
 * 「その機能に初めて出会ったとき」だけ、1回きりの説明ポップアップを出す。
 * 概念チュートリアル・はじめかた・コーチマークが出ている間は割り込まず、
 * 次にその機能へ来たときに出す。表示するかは親が制御する
 * （機能が実際に画面に出ているときだけ <FirstSeen> をマウントする）。
 */
export function FirstSeen({
  id,
  title,
  children,
  cta = "わかった",
}: {
  id: string;
  title: string;
  children: React.ReactNode;
  cta?: string;
}) {
  const [show, setShow] = useState(false);

  useEffect(() => {
    let ok = false;
    try {
      if (localStorage.getItem(PREFIX + id) != null) return;
      // 他のポップアップ／案内が出ている間は出さない（次の機会に）。
      const busy =
        !!document.querySelector(
          "[data-mm-tutorial],[data-mm-coach],[data-mm-guided]",
        ) || !localStorage.getItem("mm_tutorial_v3");
      ok = !busy;
    } catch {
      ok = false;
    }
    if (ok) queueMicrotask(() => setShow(true));
  }, [id]);

  function close() {
    try {
      localStorage.setItem(PREFIX + id, "1");
    } catch {
      /* ignore */
    }
    setShow(false);
  }

  if (!show) return null;

  return (
    <div
      data-mm-firstseen
      className="fixed inset-0 z-[58] flex items-center justify-center bg-black/45 p-4"
      onClick={close}
    >
      <div
        className="w-full max-w-sm rounded-2xl bg-surface p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-base font-semibold text-foreground">{title}</h2>
        <div className="mt-2 text-sm leading-relaxed text-muted">{children}</div>
        <div className="mt-4 flex justify-end">
          <button
            type="button"
            onClick={close}
            className="rounded-lg bg-foreground px-4 py-2 text-sm font-semibold text-white [text-decoration:none]"
          >
            {cta}
          </button>
        </div>
      </div>
    </div>
  );
}
