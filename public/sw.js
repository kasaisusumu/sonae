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
  const rawUrl =
    (event.notification.data && event.notification.data.url) || "/";
  const target = new URL(rawUrl, self.location.origin);
  const targetHref = target.href;
  const samePath = (u) => {
    try {
      return new URL(u).pathname === target.pathname;
    } catch {
      return false;
    }
  };

  event.waitUntil(
    (async () => {
      const all = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });
      const sameOrigin = all.filter((c) => c.url.startsWith(self.location.origin));

      // 1) すでに目的のページを開いている窓 → フォーカスするだけ
      const onTarget = sameOrigin.find((c) => samePath(c.url));
      if (onTarget) {
        await onTarget.focus().catch(() => {});
        return;
      }

      // 2) 別ページを開いている窓 → その窓を目的ページへ移動（できる環境なら）
      for (const c of sameOrigin) {
        if (typeof c.navigate === "function") {
          try {
            const nav = await c.navigate(targetHref);
            await (nav || c).focus().catch(() => {});
            return;
          } catch {
            /* iOS PWA など navigate 不可 → 下の openWindow へ */
          }
        }
      }

      // 3) 目的 URL を開く（インストール済み PWA なら PWA 内で開く）
      if (self.clients.openWindow) {
        const w = await self.clients.openWindow(targetHref);
        if (w && typeof w.focus === "function") await w.focus().catch(() => {});
        return;
      }

      // 4) 最後の手段: 既存窓をフォーカスだけでもする
      if (sameOrigin[0]) await sameOrigin[0].focus().catch(() => {});
    })(),
  );
});
