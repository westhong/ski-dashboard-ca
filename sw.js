// Ski Dashboard Service Worker v4.2.1
// Architecture: All-in-One Cloudflare Worker
// Push endpoints are now same-origin (/api/subscribe, /api/unsubscribe)

const CACHE_NAME = 'ski-dashboard-v4.2.1';

// ─── Install ────────────────────────────────────────────────────────────────
self.addEventListener('install', event => {
  console.log('[SW] Install v4.2.1');
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll(['/']);
    }).then(() => self.skipWaiting())
  );
});

// ─── Activate: clean old caches ────────────────────────────────────────────
self.addEventListener('activate', event => {
  console.log('[SW] Activate v4.2.1');
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// ─── Fetch: network-first, fallback to cache ───────────────────────────────
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  if (!event.request.url.startsWith(self.location.origin)) return;

  event.respondWith(
    fetch(event.request)
      .then(response => {
        if (response && response.status === 200) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});

// ─── Push: receive and show notification ───────────────────────────────────
self.addEventListener('push', event => {
  console.log('[SW] Push received');

  let data = {
    title: '❄️ Ski Dashboard',
    body: '有新的滑雪場資訊更新',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    tag: 'ski-snow-alert',
    resort: '',
    url: '/'
  };

  if (event.data) {
    try {
      const payload = event.data.json();
      data = { ...data, ...payload };
    } catch (e) {
      data.body = event.data.text();
    }
  }

    const targetUrl = data.url || '/';

  const options = {
    body: data.body,
    icon: data.icon || '/icon-192.png',
    badge: '/icon-192.png',
    tag: data.tag || 'ski-alert',
    renotify: true,
    requireInteraction: false,
    silent: false,
    data: { url: targetUrl },
    actions: [
      { action: 'open', title: '查看詳情 →' },
      { action: 'dismiss', title: '關閉' }
    ],
    vibrate: [200, 100, 200]
  };

  event.waitUntil(
    self.registration.showNotification(data.title, options)
  );
});

// ─── Notification Click ─────────────────────────────────────────────────────
self.addEventListener('notificationclick', event => {
  event.notification.close();
  if (event.action === 'dismiss') return;

  const targetUrl = (event.notification.data && event.notification.data.url)
    ? event.notification.data.url : '/';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientList => {
      for (const client of clientList) {
        const currentUrl = new URL(client.url);
        const desiredUrl = new URL(targetUrl, currentUrl.origin).toString();
        if (currentUrl.origin === self.location.origin && 'focus' in client) {
          if (client.url !== desiredUrl && 'navigate' in client) client.navigate(desiredUrl);
          return client.focus();
        }
      }
      if (clients.openWindow) {
        return clients.openWindow(new URL(targetUrl, self.location.origin).toString());
      }
    })
  );
});

// ─── Push Subscription Change (same-origin endpoint) ───────────────────────
self.addEventListener('pushsubscriptionchange', event => {
  console.log('[SW] Push subscription changed, re-subscribing...');
  event.waitUntil(
    self.registration.pushManager.subscribe({ userVisibleOnly: true })
      .then(subscription => {
        return fetch('/api/subscribe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(subscription.toJSON())
        });
      })
  );
});
