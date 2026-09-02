"use client";

import { useEffect } from "react";

/** アプリ全体でサービスワーカーを登録する（UI なし）。 */
export function SwRegister() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker
      .register("/sw.js")
      .then((reg) => reg.update())
      .catch(() => {});

    // 通知タップ時、SW が既存タブを navigate() できなかった場合の保険。
    // SW から届いた行き先へこのタブを移動する。
    const onMsg = (e: MessageEvent) => {
      const d = e.data;
      if (d && d.type === "navigate" && typeof d.url === "string") {
        window.location.assign(d.url);
      }
    };
    navigator.serviceWorker.addEventListener("message", onMsg);
    return () =>
      navigator.serviceWorker.removeEventListener("message", onMsg);
  }, []);
  return null;
}
