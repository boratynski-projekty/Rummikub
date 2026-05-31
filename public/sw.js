// Service worker dla Next.js (PWA) — sieć z fallbackiem do cache.
const CACHE = "rummikub-v1";
const ASSETS = ["/", "/manifest.webmanifest", "/icon.svg", "/icon-192.png", "/icon-512.png", "/apple-touch-icon.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).catch(() => {}).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
// ===== WEB PUSH =====
self.addEventListener("push", (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { body: e.data && e.data.text() }; }
  e.waitUntil(self.registration.showNotification(d.title || "Rummikub", {
    body: d.body || "", icon: "/icon-192.png", badge: "/icon-192.png",
    vibrate: [150, 80, 150], data: { url: d.url || "/app" },
  }));
});
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || "/app";
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
    for (const c of list) { if ("focus" in c) { c.navigate(url); return c.focus(); } }
    return self.clients.openWindow(url);
  }));
});

self.addEventListener("fetch", (e) => {
  const url = e.request.url;
  // nie cache'ujemy Supabase, auth ani żądań nie-GET
  if (url.includes("supabase.co") || url.includes("/auth/") || url.includes("/_next/") || e.request.method !== "GET") return;
  e.respondWith(
    fetch(e.request).then((res) => {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(e.request, copy)).catch(() => {});
      return res;
    }).catch(() => caches.match(e.request).then((hit) => hit || caches.match("/")))
  );
});
