"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { pullCalendarChanges } from "@/app/actions";

/**
 * アプリを開いている間、Google カレンダーとの同期を“生”に保つ。
 * - マウント直後に 1 回
 * - タブがアクティブに戻ったとき／ウィンドウにフォーカスが戻ったとき
 * - 表示中は intervalMs おき（既定 15 秒）
 * サーバー側は差分同期＋新規通知のみで生成(OpenAI)は回さないので軽い。
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
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onFocus);

    void run(true);

    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onFocus);
    };
  }, [router, intervalMs]);

  return null;
}
