/*
 * LevelUp dashboard service worker: makes the app installable and shows the
 * team's push notifications (new member, new message). A notification only
 * says what happened and which page to open; the content stays in the app.
 * No offline cache: the dashboard always shows live data.
 */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = {};
  }
  const title = typeof data.title === 'string' ? data.title.slice(0, 80) : 'LevelUp';
  const url = typeof data.url === 'string' && data.url.startsWith('/') ? data.url : '/dashboard';
  event.waitUntil(
    self.registration.showNotification(title, {
      body: typeof data.body === 'string' ? data.body.slice(0, 200) : '',
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      tag: typeof data.tag === 'string' ? data.tag : undefined,
      renotify: true,
      data: { url }
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || '/dashboard', self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((wins) => {
      for (const win of wins) {
        if (new URL(win.url).origin === self.location.origin && 'focus' in win) {
          return win.navigate(url).then((w) => (w || win).focus());
        }
      }
      return self.clients.openWindow(url);
    })
  );
});
