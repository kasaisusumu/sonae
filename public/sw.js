/* 私のマネージャー Service Worker — Web Push の受信のみ（オフラインキャッシュはしない） v5 */

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

function urlFromTag(tag) {
  if (!tag) return null;
  let m = tag.match(/^(?:event|prep|listreminder)-(.+)$/);
  if (m) return "/events/" + m[1];
  m = tag.match(/^failcheck-(.+)$/);
  if (m) return "/events/" + m[1] + "#failure-check";
  return null;
}

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: "私のマネージャー", body: event.data ? event.data.text() : "" };
  }
  const title = data.title || "私のマネージャー";
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

  event.waitUntil(
    (async () => {
      const all = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });
      const sameOrigin = all.filter((c) =>
        c.url.startsWith(self.location.origin),
      );

      // 1) まったく同じ URL（ハッシュまで一致）を開いている窓 → フォーカスするだけ
      const exact = sameOrigin.find((c) => c.url === targetHref);
      if (exact) {
        await exact.focus().catch(() => {});
        return;
      }

      // 2) まず新しく目的 URL を開く。これが一番確実に「その通知のページ」へ着く。
      //    （インストール済み PWA なら PWA 内で開く）
      if (self.clients.openWindow) {
        try {
          const w = await self.clients.openWindow(targetHref);
          if (w) {
            if (typeof w.focus === "function") await w.focus().catch(() => {});
            return;
          }
        } catch {
          /* openWindow 不可（ブロック等）→ 下へ */
        }
      }

      // 3) 開けなかったら、既存の同一オリジン窓を目的ページへ移動する
      const navigable = sameOrigin.find((c) => typeof c.navigate === "function");
      if (navigable) {
        try {
          await navigable.focus().catch(() => {});
          await navigable.navigate(targetHref);
          return;
        } catch {
          /* navigate 不可 → 下へ */
        }
      }

      // 4) 最後の手段: 既存窓をフォーカスだけでもする
      if (sameOrigin[0]) await sameOrigin[0].focus().catch(() => {});
    })(),
  );
});
