/* 私の準備マニュアル Service Worker — Web Push の受信のみ（オフラインキャッシュはしない） v9 */

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

// 通知の tag から行き先 URL を復元する（payload に url が無かったときの保険）。
// 送信側（lib/notify-items.ts, lib/sync.ts, lib/failures.ts, app/actions.ts）の
// tag 命名と必ず対応させること。
function urlFromTag(tag) {
  if (!tag) return null;
  let m = tag.match(/^failcheck-(.+)$/);
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
      title: "私の準備マニュアル",
      body: event.data ? event.data.text() : "",
    };
  }
  const title = data.title || "私の準備マニュアル";
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

      // 1) すでに目的ページ（ハッシュまで完全一致）を開いている窓 → フォーカスだけ。
      const exact = ordered.find(
        (c) => c.url === targetHref || c.url === targetHref + "/",
      );
      if (exact) {
        if ("focus" in exact) await exact.focus().catch(() => {});
        return;
      }

      // 2) 既存の同一オリジン窓を、新規に増やさず目的ページへ移動する。
      //    （インストール済み PWA でも確実に「その通知のページ」へ着くように）
      //    最初の窓で諦めず、動く窓が見つかるまで順に試す。
      let handled = false;
      for (const c of ordered) {
        // 同じパスでハッシュ違いだけ → 全リロードせずページ内遷移をページ側に依頼。
        if (
          (c.url === targetNoHash || c.url === targetNoHash + "/") &&
          target.hash
        ) {
          if ("focus" in c) await c.focus().catch(() => {});
          c.postMessage({ type: "navigate", url: targetHref });
          handled = true;
          break;
        }
        if (typeof c.navigate === "function") {
          try {
            const w = (await c.navigate(targetHref)) || c;
            if (w && "focus" in w) await w.focus().catch(() => {});
            handled = true;
            break;
          } catch {
            /* この窓は navigate 不可（未制御など）→ 次の窓へ */
          }
        }
      }
      if (handled) return;

      // 3) どの既存窓も移動できなかった。フォーカス中の窓にページ内遷移を依頼しつつ、
      //    それでも着かない場合に備えて新規窓も必ず開く（「開いても何も起きない」を防ぐ）。
      if (ordered[0]) {
        if ("focus" in ordered[0]) await ordered[0].focus().catch(() => {});
        ordered[0].postMessage({ type: "navigate", url: targetHref });
      }
      if (self.clients.openWindow) {
        const w = await self.clients.openWindow(targetHref).catch(() => null);
        if (w && "focus" in w) await w.focus().catch(() => {});
      }
    })(),
  );
});
