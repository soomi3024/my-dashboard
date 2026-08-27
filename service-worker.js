const CACHE_NAME = "taco-booth-manager-v2";

const FILES_TO_CACHE = [
  "/",
  "/index.html",
  "/profit-sync.js"
];

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(FILES_TO_CACHE))
  );

  self.skipWaiting();
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(key => key !== CACHE_NAME)
          .map(key => caches.delete(key))
      )
    )
  );

  self.clients.claim();
});

self.addEventListener("fetch", event => {
  const request = event.request;

  // HTML 응답에 월별 손익 Supabase 연결 스크립트를 주입한다.
  if (request.method === "GET" && request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then(async response => {
          const contentType = response.headers.get("content-type") || "";
          if (!contentType.includes("text/html")) return response;

          const html = await response.text();
          if (html.includes("/profit-sync.js")) return new Response(html, {
            status: response.status,
            statusText: response.statusText,
            headers: response.headers
          });

          const injected = html.replace(
            /<\/body>/i,
            '<script src="/profit-sync.js"></script></body>'
          );

          const headers = new Headers(response.headers);
          headers.set("content-type", "text/html; charset=utf-8");
          headers.delete("content-length");

          return new Response(injected, {
            status: response.status,
            statusText: response.statusText,
            headers
          });
        })
        .catch(() => caches.match(request))
    );
    return;
  }

  event.respondWith(
    fetch(request)
      .catch(() => caches.match(request))
  );
});
