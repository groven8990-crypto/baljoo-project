// 푸시 알림을 받아서 띄우고, 누르면 앱을 엽니다.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('push', (e) => {
  let msg = { title: '발주 알리미', body: '새 알림이 있습니다', url: './' };
  try { msg = { ...msg, ...e.data.json() }; } catch (_) {}
  e.waitUntil(self.registration.showNotification(msg.title, {
    body: msg.body,
    tag: msg.tag,
    renotify: !!msg.tag,
    icon: 'icon-192.png',
    badge: 'icon-192.png',
    data: { url: msg.url },
  }));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = new URL(e.notification.data?.url || './', self.registration.scope).href;
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const w of wins) {
      if (w.url.startsWith(self.registration.scope)) { await w.focus(); w.navigate(url); return; }
    }
    await self.clients.openWindow(url);
  })());
});

// 앱 파일은 매번 서버에 새 버전이 있는지 확인하고 받습니다 (홈 화면 앱이 예전 파일을 붙들고 있어
// 화면 일부만 새 버전으로 보이는 문제 방지 — 바뀐 게 없으면 304 로 바로 끝남)
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  e.respondWith(fetch(req, { cache: 'no-cache' }).catch(() => fetch(req)));
});
