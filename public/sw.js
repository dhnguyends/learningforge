/*
 * PolyLingue service worker: installable app, offline lessons and reminders.
 *
 * - PolyLingue pages: network first; the last copy is kept for offline use.
 * - Next.js static files: network first, cached copy offline.
 * - Lesson audio (/api/polylingue/speech): the copy saved for offline first.
 * - Everything else (the rest of LearningForge, other APIs) is not touched.
 * - Push: shows the reminder; a click opens (or focuses) PolyLingue.
 */
const PAGES = "polylingue-pages-v1";
const STATIC = "polylingue-static-v1";
const OFFLINE = "polylingue-offline";

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keep = new Set([PAGES, STATIC, OFFLINE]);
      for (const key of await caches.keys()) if (key.startsWith("polylingue-") && !keep.has(key)) await caches.delete(key);
      await self.clients.claim();
    })(),
  );
});

const OFFLINE_PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>PolyLingue — offline</title><style>body{font-family:system-ui,sans-serif;margin:0;display:grid;place-items:center;min-height:100vh;background:#f8fafc;color:#0f172a}
main{max-width:28rem;padding:1.5rem;text-align:center}a{color:#0f766e}</style></head><body><main><h1>You are offline</h1>
<p>This page was not saved for offline use. Lessons saved on your course page ("Available offline") can be played without a connection.</p>
<p><a href="/polylingue">Back to PolyLingue</a></p></main></body></html>`;

async function networkFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const response = await fetch(request);
    if (response.ok && !response.redirected && response.type === "basic") cache.put(request, response.clone());
    return response;
  } catch (err) {
    const cached = (await cache.match(request)) || (await caches.match(request, { ignoreSearch: false }));
    if (cached) return cached;
    throw err;
  }
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(networkFirst(request, STATIC));
    return;
  }
  if (url.pathname === "/api/polylingue/speech") {
    event.respondWith(
      (async () => {
        const saved = await (await caches.open(OFFLINE)).match(request);
        return saved || fetch(request);
      })(),
    );
    return;
  }
  if (request.mode === "navigate" && (url.pathname === "/polylingue" || url.pathname.startsWith("/polylingue/"))) {
    event.respondWith(
      networkFirst(request, PAGES).catch(
        async () => (await caches.match(url.pathname, { ignoreSearch: true })) || new Response(OFFLINE_PAGE, { headers: { "Content-Type": "text/html; charset=utf-8" } }),
      ),
    );
  }
});

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : "" };
  }
  event.waitUntil(
    self.registration.showNotification(data.title || "PolyLingue", {
      body: data.body || "",
      tag: data.tag || "polylingue",
      icon: "/icons/polylingue-192.png",
      badge: "/icons/polylingue-192.png",
      data: { url: data.url || "/polylingue" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL((event.notification.data && event.notification.data.url) || "/polylingue", self.location.origin).href;
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const w of windows) {
        if (w.url === target && "focus" in w) return w.focus();
      }
      for (const w of windows) {
        if (new URL(w.url).pathname.startsWith("/polylingue") && "navigate" in w) {
          await w.navigate(target);
          return w.focus();
        }
      }
      return self.clients.openWindow(target);
    })(),
  );
});
