// 通知を受け取って表示するだけの Service Worker。
// iPhone はホーム画面に追加しないと、この経路そのものが使えない。

self.addEventListener('install', (e) => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = { title: '費用メモ', body: event.data ? event.data.text() : '' }; }

  event.waitUntil((async () => {
    await self.registration.showNotification(data.title || '費用メモ', {
      body: data.body || '',
      tag: data.tag || 'onegai',
      icon: './icon.png',
      badge: './icon.png',
      lang: 'ja',
      data,
    });
    // テスト通知は「実際に届いた」ことを画面へ知らせ、ペアリングの完了条件にする。
    if (data.verify) {
      const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const c of all) c.postMessage({ type: 'push-verified' });
    }
  })());
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of all) { if ('focus' in c) return c.focus(); }
    if (self.clients.openWindow) return self.clients.openWindow('./');
  })());
});
