"use client";

import { useEffect } from "react";

/** アプリ全体でサービスワーカーを登録する（UI なし）。 */
export function SwRegister() {
  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker
        .register("/sw.js")
        .then((reg) => reg.update())
        .catch(() => {});
    }
  }, []);
  return null;
}
