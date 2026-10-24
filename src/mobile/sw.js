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
