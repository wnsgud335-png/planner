// 앱 파일은 인터넷이 되면 항상 최신으로 받습니다. VERSION은 캐시를 통째로 비우고 싶을 때 올리세요.
const VERSION = "v3";
const SHELL = `planner-shell-${VERSION}`;
const CDN = "planner-cdn";
const FILES = ["./", "index.html", "manifest.webmanifest", "icons/icon-192.png", "icons/icon-512.png", "icons/apple-touch-icon.png", "firebase-config.js", "firebase-sync.js"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(SHELL).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k.startsWith("planner-shell-") && k !== SHELL).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  // 글꼴과 Firebase 라이브러리: 캐시를 먼저 쓰고 뒤에서 갱신 (오프라인에서도 실행)
  if (url.host === "fonts.googleapis.com" || url.host === "fonts.gstatic.com" || (url.host === "www.gstatic.com" && url.pathname.startsWith("/firebasejs/"))) {
    e.respondWith(caches.open(CDN).then(async c => {
      const hit = await c.match(req);
      const net = fetch(req).then(r => { if (r.ok || r.type === "opaque") c.put(req, r.clone()); return r; }).catch(() => hit);
      return hit || net;
    }));
    return;
  }

  if (url.origin !== location.origin) return;

  // 앱 파일: 인터넷이 되면 항상 최신 파일, 오프라인이면 저장해 둔 파일
  const key = req.mode === "navigate" ? "index.html" : req;
  e.respondWith(fetch(req).then(r => {
    if (r.ok) { const copy = r.clone(); caches.open(SHELL).then(c => c.put(key, copy)); }
    return r;
  }).catch(() => caches.match(key, { ignoreSearch: true })));
});
