/* GMT Devamsızlık — Service Worker
 * - App-shell caching (offline-first)
 * - Background Sync tetikleyicisi (client'a mesaj gönderir)
 * - Web Push bildirimleri
 */
// SÜRÜMÜ ARTIR: statik dosyaları (ikon/logo gibi) değiştirdiğinde bunu bir
// artır — activate eski cache'leri siler. v12'de logolar donup kalmıştı.
const CACHE = "gmt-cache-v15";
const APP_SHELL = ["/", "/manifest.webmanifest", "/icons/gmt-logo-mark.png"];

// /_next/static/* dosyalarının adında içerik hash'i var: içerik değişince URL
// de değişir, yani bunları süresiz cache'lemek güvenli.
const isImmutable = (url) => url.pathname.startsWith("/_next/static/");

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(APP_SHELL)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Network-first for navigations, cache-first for static assets.
self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req, { cache: "no-store" })
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
          }
          return res;
        })
        .catch(() => caches.match(req).then((r) => r || caches.match("/")))
    );
    return;
  }

  const store = (res) => {
    // Never cache error responses (404/5xx) — a transient server hiccup
    // would otherwise get poisoned into the cache permanently.
    if (res && res.ok) {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
    }
    return res;
  };

  // İçerik hash'li dosyalar: cache-first. İçerik değişirse URL de değiştiği
  // için bayat kalmaları mümkün değil.
  if (isImmutable(url)) {
    event.respondWith(
      caches.match(req).then((cached) => cached || fetch(req).then(store)),
    );
    return;
  }

  // Sabit URL'li dosyalar (/icons/*, /manifest.webmanifest):
  // stale-while-revalidate. Cache'teki kopya anında döner (offline çalışır),
  // ama arka planda ağdan tazelenir; böylece yeni bir logo en geç bir sonraki
  // açılışta görünür. Eski davranış (süresiz cache-first) logoyu, URL hiç
  // değişmediği için, sonsuza dek donduruyordu.
  event.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req).then(store).catch(() => cached);
      return cached || network;
    }),
  );
});

// Background Sync: tell open clients to flush their sync queue.
self.addEventListener("sync", (event) => {
  if (event.tag === "gmt-sync") {
    event.waitUntil(
      self.clients.matchAll({ includeUncontrolled: true }).then((clients) => {
        clients.forEach((c) => c.postMessage({ type: "gmt-flush-sync" }));
      })
    );
  }
});

// Web Push
self.addEventListener("push", (event) => {
  let data = { title: "GMT Devamsızlık", body: "" };
  try {
    if (event.data) data = { ...data, ...event.data.json() };
  } catch (_) {
    if (event.data) data.body = event.data.text();
  }
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: "/icons/gmt-logo-mark.png",
      badge: "/icons/gmt-logo-mark.png",
      tag: data.tag || "gmt-alert",
      data: data,
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      for (const c of clients) {
        if ("focus" in c) return c.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow("/");
    })
  );
});
