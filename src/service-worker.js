// Filled by the Vite build with a content hash and the complete app shell.
const CACHE_NAME = "__DAYBOOK_CACHE__";
const PRECACHE = [/* __DAYBOOK_ASSETS__ */];
const paths = new Set(PRECACHE);

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    try {
      await cache.addAll(PRECACHE.map((url) => new Request(url, { cache: "reload" })));
    } catch (error) {
      await caches.delete(CACHE_NAME);
      throw error;
    }
    // Wait for existing sessions to close; never replace an open puzzle's build.
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) {
      if (key.startsWith("daybook-shell-") && key !== CACHE_NAME) await caches.delete(key);
    }
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const request = event.request, url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin) return;
  const path = url.pathname === "/index.html" ? "/" : url.pathname;
  if (!paths.has(path)) return;
  event.respondWith((async () => {
    const cached = await (await caches.open(CACHE_NAME)).match(path);
    return cached || fetch(request);
  })());
});
