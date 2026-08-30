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
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clientList) => {
        // 既にアプリの窓が開いていれば、それを対象ページへ移動してフォーカス
        for (const client of clientList) {
          if (client.url.startsWith(self.location.origin) && "focus" in client) {
            return client
              .focus()
              .then(() =>
                "navigate" in client ? client.navigate(targetUrl) : client,
              );
          }
        }
        // 無ければ新しく開く（インストール済み PWA なら PWA で開く）
        if (self.clients.openWindow) return self.clients.openWindow(targetUrl);
      }),
  );
});
