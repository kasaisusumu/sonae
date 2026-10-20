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
    // 長時間バックグラウンドのまま（＝再読み込みされない）PWA は、登録直後の
    // この1回だけでは古い sw.js のまま長く取り残されうる（ユーザー指摘により
    // 2026-10-20: 通知タップで前面には来るが古い遷移ロジックのまま、という
    // 事例があった）。アプリが見えるようになるたびにも更新確認する。
    const updateSw = () => {
      navigator.serviceWorker
        .getRegistration()
        .then((reg) => reg?.update())
        .catch(() => {});
    };
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
    let cancelled = false;
    const applyPendingNav = () => {
      consumePendingNav().then((url) => {
        if (url && url !== window.location.href) {
          window.location.assign(url);
        }
      });
    };
    // 通知タップでアプリが新規に（コールドで）立ち上がった直後は、SW 側の
    // IndexedDB 書き込みがまだ終わっていない可能性がある（ユーザー指摘により
    // 2026-10-19再修正: 1回だけの確認だと間に合わないタイミングがあった）。
    // 起動直後だけ、短い間隔で数回リトライする（見つかれば以降は何もしない）。
    const retryDelaysMs = [300, 800, 1500, 3000];
    for (const delay of retryDelaysMs) {
      setTimeout(() => {
        if (!cancelled) applyPendingNav();
      }, delay);
    }
    applyPendingNav();
    const onAppVisible = () => {
      applyPendingNav();
      updateSw();
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") onAppVisible();
    };
    // visibilitychange だけでは足りない（ユーザー指摘により2026-10-19再調査:
    // 通知タップでそのページへ飛ばない事例があった）。iOS の PWA は、ホーム画面・
    // アプリスイッチャーから前面に戻ったときに visibilitychange が発火しない
    // ことがあるため、pageshow（bfcache からの復帰含む）・focus も合わせて
    // 「見えるようになった」の検知に使う。
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("pageshow", onAppVisible);
    window.addEventListener("focus", onAppVisible);

    // 上のイベント頼みだけでは足りないケースがあった（ユーザー指摘により2026-10-20:
    // 通知タップでアプリは前面に来る（SW の client.focus() 自体は効いている）のに、
    // 以前開いていたページのまま変わらなかった）。SW からの client.focus() は
    // OS/ブラウザ側で前面化はするが、このタブの focus/visibilitychange/pageshow が
    // 必ず発火するとは限らない（特に長時間バックグラウンドだった後の復帰）。
    // イベントに頼らず、タブが開いている間は低頻度（2秒おき）で保険のポーリングも行う
    // （見つかったときだけ画面遷移するので、何も無ければ負荷はごく小さい）。
    const pollId = setInterval(applyPendingNav, 2000);

    return () => {
      cancelled = true;
      navigator.serviceWorker.removeEventListener("message", onMsg);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("pageshow", onAppVisible);
      window.removeEventListener("focus", onAppVisible);
      clearInterval(pollId);
    };
  }, []);
  return null;
}
