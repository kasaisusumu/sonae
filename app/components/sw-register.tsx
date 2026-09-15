"use client";

import { useEffect } from "react";

const DB_NAME = "sonae-nav";
const STORE = "kv";
// これより古い保留は無視する（別の理由でアプリを開いた可能性が高いため）。
const MAX_AGE_MS = 60_000;

function openDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    if (!("indexedDB" in window)) {
      resolve(null);
      return;
    }
    try {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(STORE)) {
          req.result.createObjectStore(STORE);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

/**
 * sw.js の notificationclick が控えた「通知タップの行き先」を読んで消費する
 * （読んだら消す・1回きり）。60秒より古ければ無視する。
 */
function consumePendingNav(): Promise<string | null> {
  return openDb().then(
    (db) =>
      new Promise<string | null>((resolve) => {
        if (!db) {
          resolve(null);
          return;
        }
        try {
          const tx = db.transaction(STORE, "readwrite");
          const store = tx.objectStore(STORE);
          const getReq = store.get("pending");
          getReq.onsuccess = () => {
            const rec = getReq.result as
              | { url?: string; at?: number }
              | undefined;
            store.delete("pending");
            tx.oncomplete = () => {
              db.close();
              if (rec?.url && rec.at && Date.now() - rec.at < MAX_AGE_MS) {
                resolve(rec.url);
              } else {
                resolve(null);
              }
            };
            tx.onerror = () => {
              db.close();
              resolve(null);
            };
          };
          getReq.onerror = () => {
            db.close();
            resolve(null);
          };
        } catch {
          db.close();
          resolve(null);
        }
      }),
  );
}

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

    // 上の postMessage は「このタブの JS が今動いている」前提。インストール済み
    // PWA（特に iOS）はバックグラウンドの窓が一時停止していて、通知タップで
    // フォアグラウンドに戻ってもすぐには処理できないことがある。そのケースでも
    // 拾えるよう、アプリが見えるようになるたびに sw.js が控えた行き先
    // （IndexedDB）を確認する。
    const applyPendingNav = () => {
      consumePendingNav().then((url) => {
        if (url && url !== window.location.href) {
          window.location.assign(url);
        }
      });
    };
    applyPendingNav();
    const onVisible = () => {
      if (document.visibilityState === "visible") applyPendingNav();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      navigator.serviceWorker.removeEventListener("message", onMsg);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);
  return null;
}
