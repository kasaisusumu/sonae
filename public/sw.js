/* 私の準備マニュアル Service Worker — Web Push の受信のみ（オフラインキャッシュはしない） v8 */

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

function urlFromTag(tag) {
  if (!tag) return null;
  let m = tag.match(/^failcheck-(.+)$/);
  if (m) return "/events/" + m[1] + "#failure-check";
  m = tag.match(/^(?:event|prep|listreminder)-(.+)$/);
  if (m) return "/events/" + m[1];
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

      // 1) すでに目的ページを開いている窓 → フォーカスするだけ
      const exact = wins.find(
        (c) => c.url === targetHref || c.url === targetHref + "/",
      );
      if (exact) {
        if ("focus" in exact) await exact.focus().catch(() => {});
        return;
      }

      // 2) 既存の窓があれば、新しく増やさずその窓を目的ページへ移動する。
      //    （インストール済み PWA でも確実に「その通知のページ」へ着くように）
      for (const c of wins) {
        try {
          if ("focus" in c) await c.focus().catch(() => {});
        } catch {
          /* ignore */
        }
        // 同じパスを既に開いているなら、ハッシュだけ postMessage で送って終わり
        if (
          (c.url === targetNoHash || c.url === targetNoHash + "/") &&
          target.hash
        ) {
          c.postMessage({ type: "navigate", url: targetHref });
          return;
        }
        if (typeof c.navigate === "function") {
          try {
            const nav = await c.navigate(targetHref);
            const w = nav || c;
            if (w && "focus" in w) await w.focus().catch(() => {});
            return;
          } catch {
            /* この窓は navigate 不可 → 次へ */
          }
        }
        // navigate が使えない窓 → ページ側リスナーに遷移を依頼して終了
        c.postMessage({ type: "navigate", url: targetHref });
        return;
      }

      // 3) 窓が1つも無い → 新しく開く
      if (self.clients.openWindow) {
        const w = await self.clients.openWindow(targetHref).catch(() => null);
        if (w && "focus" in w) await w.focus().catch(() => {});
      }
    })(),
  );
});
