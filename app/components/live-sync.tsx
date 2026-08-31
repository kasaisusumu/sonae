"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { pullCalendarChanges } from "@/app/actions";

/**
 * アプリを開いている間、Google カレンダーとの同期を“生”に保つ。
 * - マウント直後に 1 回
 * - タブがアクティブに戻ったとき／ウィンドウにフォーカスが戻ったとき
 * - オフラインからオンラインに復帰したとき（電波が無い間に追加された予定をここで一括処理）
 * - 表示中は intervalMs おき（既定 15 秒）
 * 差分取り込み＋新規通知に加え、新規予定があれば準備リストの生成もまとめて走らせる。
 * 変化があったときだけ router.refresh() して画面を最新化する。
 */
export function LiveSync({ intervalMs = 15000 }: { intervalMs?: number }) {
  const router = useRouter();
  const busy = useRef(false);
  const lastRun = useRef(0);

  useEffect(() => {
    const run = async (force: boolean) => {
      if (busy.current) return;
      if (typeof document !== "undefined" && document.visibilityState !== "visible")
        return;
      if (!force && Date.now() - lastRun.current < intervalMs - 1000) return;
      busy.current = true;
      lastRun.current = Date.now();
      try {
        const { changed } = await pullCalendarChanges();
        if (changed) router.refresh();
      } catch {
        /* オフライン等は無視。次のティックで再試行 */
      } finally {
        busy.current = false;
      }
    };

    const timer = window.setInterval(() => void run(false), intervalMs);
    const onVisible = () => {
      if (document.visibilityState === "visible") void run(true);
    };
    const onFocus = () => void run(true);
    const onOnline = () => void run(true);
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onFocus);
    window.addEventListener("online", onOnline);

    void run(true);

    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("online", onOnline);
    };
  }, [router, intervalMs]);

  return null;
}
