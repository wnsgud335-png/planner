// 앱 파일은 인터넷이 되면 항상 최신으로 받습니다. VERSION은 캐시를 통째로 비우고 싶을 때 올리세요.
const VERSION = "v5";
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
  // cache: "no-cache" → GitHub Pages가 10분간 붙잡는 옛 파일 대신 매번 새 버전인지 서버에 확인
  const key = req.mode === "navigate" ? "index.html" : req;
  const fresh = req.mode === "navigate" ? fetch(req.url, { cache: "no-cache", credentials: "same-origin" }) : fetch(req, { cache: "no-cache" });
  e.respondWith(fresh.then(r => {
    if (r.ok) { const copy = r.clone(); caches.open(SHELL).then(c => c.put(key, copy)); }
    return r;
  }).catch(() => caches.match(key, { ignoreSearch: true })));
});

// 푸시 알림: 알림 서버가 보낸 제목·내용을 그대로 보여 줍니다.
self.addEventListener("push", e => {
  let p = {};
  try { p = e.data ? e.data.json() : {}; } catch(err) { p = { data: { title: e.data && e.data.text() } }; }
  const d = p.data || p.notification || p;
  e.waitUntil(self.registration.showNotification(d.title || "스케줄 플래너", {
    body: d.body || "", tag: d.tag || undefined, icon: "icons/icon-192.png", badge: "icons/icon-192.png",
    data: { url: d.url || "./#day" }, renotify: !!d.tag
  }));
});
self.addEventListener("notificationclick", e => {
  e.notification.close();
  const url = new URL(e.notification.data?.url || "./", self.registration.scope).href;
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(list => {
    for (const c of list) if (c.url.startsWith(self.registration.scope)) { c.focus(); return c.navigate ? c.navigate(url) : null; }
    return self.clients.openWindow(url);
  }));
});
