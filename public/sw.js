/* 私のマネージャー Service Worker — Web Push の受信のみ（オフラインキャッシュはしない） */

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: "私のマネージャー", body: event.data ? event.data.text() : "" };
  }
  const title = data.title || "私のマネージャー";
  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || "",
      icon: "/icons/icon-192.png",
      badge: "/icons/badge-72.png",
      tag: data.tag || undefined,
      renotify: Boolean(data.tag),
      data: { url: data.url || "/" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetPath =
    (event.notification.data && event.notification.data.url) || "/";
  const targetUrl = new URL(targetPath, self.location.origin).href;

  event.waitUntil(
    (async () => {
      const all = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });

      // 1) 既に目的のページを開いている窓があればフォーカスするだけ
      for (const c of all) {
        if (c.url === targetUrl && "focus" in c) return c.focus();
      }

      // 2) 同一オリジンの窓があれば、その窓を目的ページへ移動する
      for (const c of all) {
        if (!c.url.startsWith(self.location.origin)) continue;
        if (typeof c.navigate === "function") {
          try {
            await c.navigate(targetUrl);
            return c.focus();
          } catch {
            /* navigate 不可の環境（iOS PWA 等）は下のフォールバックへ */
          }
        }
        await c.focus().catch(() => {});
        return self.clients.openWindow
          ? self.clients.openWindow(targetUrl)
          : undefined;
      }

      // 3) 開いている窓が無ければ新しく開く（インストール済み PWA なら PWA で開く）
      if (self.clients.openWindow) return self.clients.openWindow(targetUrl);
    })(),
  );
});
