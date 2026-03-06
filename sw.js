// Ski Dashboard Service Worker v1.0
// Handles: caching, push notifications, background sync

const CACHE_NAME = 'ski-dashboard-v1';
const PUSH_WORKER_URL = 'https://ski-push.westech.com.hk';

// ─── Install: cache shell ───────────────────────────────────────────────────
self.addEventListener('install', event => {
  console.log('[SW] Install');
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll(['/']);
    }).then(() => self.skipWaiting())
  );
});

// ─── Activate: clean old caches ────────────────────────────────────────────
self.addEventListener('activate', event => {
  console.log('[SW] Activate');
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// ─── Fetch: network-first, fallback to cache ───────────────────────────────
self.addEventListener('fetch', event => {
  // Only cache same-origin GET requests
  if (event.request.method !== 'GET') return;
  if (!event.request.url.startsWith(self.location.origin)) return;

  event.respondWith(
    fetch(event.request)
      .then(response => {
        // Clone and cache successful responses
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

  // Map resort name to page index for deep link
  const resortPageMap = {
    'Nakiska': '/?page=0',
    'Sunshine': '/?page=1',
    'Sunshine Village': '/?page=1',
    'Lake Louise': '/?page=2',
    'Norquay': '/?page=3',
    'Calgary': '/?page=4'
  };

  const targetUrl = resortPageMap[data.resort] || data.url || '/';

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
    ? event.notification.data.url
    : '/';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientList => {
      // Focus existing window if open
      for (const client of clientList) {
        if (client.url.includes('dashboard.westech.com.hk') && 'focus' in client) {
          client.navigate(targetUrl);
          return client.focus();
        }
      }
      // Otherwise open new window
      if (clients.openWindow) {
        return clients.openWindow('https://dashboard.westech.com.hk' + targetUrl);
      }
    })
  );
});

// ─── Push Subscription Change ───────────────────────────────────────────────
self.addEventListener('pushsubscriptionchange', event => {
  console.log('[SW] Push subscription changed, re-subscribing...');
  event.waitUntil(
    self.registration.pushManager.subscribe({ userVisibleOnly: true })
      .then(subscription => {
        return fetch(PUSH_WORKER_URL + '/api/subscribe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(subscription.toJSON())
        });
      })
  );
});
