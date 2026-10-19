/* 私のマニュアル「そなえ」さん Service Worker — Web Push の受信のみ（オフラインキャッシュはしない） v17 */

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

// 通知タップの行き先を IndexedDB にも控えておく（postMessage/navigate() が効かない保険）。
// PWA（特に iOS）はバックグラウンドの窓の JS が一時停止していて、通知タップで
// フォアグラウンドに戻っても postMessage をすぐには処理できないことがある。
// その場合でもアプリ側（sw-register.tsx）が可視化のたびに IndexedDB を見て
// 「読んだら消す」1件キューとして拾えるようにする。
function rememberPendingNav(url) {
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open("sonae-nav", 1);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains("kv")) {
          req.result.createObjectStore("kv");
        }
      };
      req.onsuccess = () => {
        const db = req.result;
        try {
          const tx = db.transaction("kv", "readwrite");
          tx.objectStore("kv").put({ url, at: Date.now() }, "pending");
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onerror = () => {
            db.close();
            resolve();
          };
        } catch {
          db.close();
          resolve();
        }
      };
      req.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}

// 通知の tag から行き先 URL を復元する（payload に url が無かったときの保険）。
// 送信側（lib/notify-items.ts, lib/sync.ts, lib/future-messages.ts, lib/failures.ts,
// app/actions.ts）の tag 命名と必ず対応させること。機能モード切替（2026-10-14〜）で
// 本番版（failcheck-）・テスト版（futuremsg-/msgreview-）どちらのタグも受け取ることが
// あるため、両方を認識する（ユーザーが過去に別モードで受け取った通知を開く場合もある）。
function urlFromTag(tag) {
  if (!tag) return null;
  let m = tag.match(/^futuremsg-(.+)$/);
  if (m) return "/events/" + m[1] + "#message-review";
  m = tag.match(/^msgreview-(.+)$/);
  if (m) return "/events/" + m[1] + "#message-review";
  m = tag.match(/^failcheck-(.+)$/);
  if (m) return "/events/" + m[1] + "#failure-check";
  m = tag.match(/^(?:event|prep|listreminder)-(.+)$/);
  if (m) return "/events/" + m[1];
  // 繰り返し予定の通知は series-<recurringEventId>。個別の予定 id は SW からは
  // 引けないので、確実に開ける予定一覧へ。
  if (/^series-/.test(tag)) return "/events";
  // test など未知の tag は呼び出し側で "/" にフォールバックさせる。
  return null;
}

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = {
      title: "私のマニュアル「そなえ」さん",
      body: event.data ? event.data.text() : "",
    };
  }
  const title = data.title || "私のマニュアル「そなえ」さん";
  const url = data.url || urlFromTag(data.tag) || "/";
  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || "",
      icon: "/icons/icon-192.png",
      badge: "/icons/badge-72.png",
      tag: data.tag || undefined,
      renotify: Boolean(data.tag),
      data: { url },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const d = event.notification.data || {};
  const rawUrl = d.url || urlFromTag(event.notification.tag) || "/";
  const target = new URL(rawUrl, self.location.origin);
  const targetHref = target.href;
  // ハッシュを外した比較用（/events/x と /events/x#failure-check を同じ窓扱いにする）
  const targetNoHash = target.origin + target.pathname + target.search;

  // IndexedDB への保存は保険であり、本命の画面遷移を待たせてはいけない
  // （ユーザー指摘により2026-10-19再修正: 以前はこの書き込みを await してから
  // openWindow/navigate を呼んでいたため、SW のコールドスタート時にIndexedDBの
  // 往復が遅いと、notificationclick が持つ「ユーザー操作」としての有効期限が
  // 切れてしまい、openWindow が静かに失敗する＝通知タップが何も起こさない、
  // という不具合が起きていた。保存は並行して走らせ、完了は待たずに遷移を試みる）。
  const rememberPromise = rememberPendingNav(targetHref);

  event.waitUntil(
    (async () => {
      const all = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });
      const wins = all.filter((c) => c.url.startsWith(self.location.origin));
      // フォーカス中／可視の窓を先に試す（matchAll の順序は不定なので明示的に並べる）。
      const ordered = wins.slice().sort((a, b) => {
        const av = (a.focused ? 2 : 0) + (a.visibilityState === "visible" ? 1 : 0);
        const bv = (b.focused ? 2 : 0) + (b.visibilityState === "visible" ? 1 : 0);
        return bv - av;
      });

      // 既存の同一オリジン窓が1つも無い（アプリが完全に閉じている）→ 新規に開く。
      if (ordered.length === 0) {
        if (self.clients.openWindow) {
          const w = await self.clients.openWindow(targetHref).catch(() => null);
          if (w && "focus" in w) await w.focus().catch(() => {});
        }
        await rememberPromise;
        return;
      }

      // 既存の窓がある（バックグラウンドで開いている場合も含む）→ 新規の窓は増やさず、
      // 最優先の窓をまず前面に出す。navigate の成否に関わらず必ず focus を試みる
      // （ユーザー指摘により2026-10-19再修正: 以前は navigate が失敗した窓は
      // focus すら試みていなかったため、バックグラウンドで開いていた窓が
      // 通知タップでも前面に出てこないことがあった）。
      const primary = ordered[0];
      if ("focus" in primary) await primary.focus().catch(() => {});

      // すでに目的ページ（ハッシュまで完全一致）ならこれで完了。
      if (primary.url === targetHref || primary.url === targetHref + "/") {
        await rememberPromise;
        return;
      }

      // 既存の同一オリジン窓を、目的ページへ移動する（動く窓が見つかるまで順に試す）。
      for (const c of ordered) {
        // 同じパスでハッシュ違いだけ → 全リロードせずページ内遷移をページ側に依頼。
        if (
          (c.url === targetNoHash || c.url === targetNoHash + "/") &&
          target.hash
        ) {
          if (c !== primary && "focus" in c) await c.focus().catch(() => {});
          c.postMessage({ type: "navigate", url: targetHref });
          await rememberPromise;
          return;
        }
        if (typeof c.navigate === "function") {
          try {
            await c.navigate(targetHref);
            if (c !== primary && "focus" in c) await c.focus().catch(() => {});
            await rememberPromise;
            return;
          } catch {
            /* この窓は navigate 不可（未制御など）→ 次の窓へ */
          }
        }
      }

      // どの窓も navigate できなかった。前面に出した primary へページ内遷移を依頼しつつ、
      // それでも効かない場合に備え、ページ側の IndexedDB フォールバック
      // （focus 済みなので visibilitychange/focus/pageshow で拾われる）に委ねる。
      // 既存窓があるのに openWindow で新規窓を増やすと、古い窓と新しい窓が
      // 両方残って混乱するため、ここでは増やさない。
      primary.postMessage({ type: "navigate", url: targetHref });
      await rememberPromise;
    })(),
  );
});
