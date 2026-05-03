const CACHE_NAME = 'taskora-v1';
const STATIC_SHELL = [
  '/',
  '/daily-brief',
  '/tasks',
  '/war-room',
  '/initiatives',
  '/programs',
  '/gantt',
  '/reports',
  '/analytics',
  '/templates',
];

// Install: pre-cache app shell
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_SHELL).catch(() => {});
    })
  );
  self.skipWaiting();
});

// Activate: clean old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Fetch: network-first for API, cache-first for static
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Skip non-GET and cross-origin requests
  if (event.request.method !== 'GET') return;
  if (url.origin !== self.location.origin) return;

  if (url.pathname.startsWith('/api/')) {
    // Network-first for API calls
    event.respondWith(
      fetch(event.request).catch(() =>
        new Response(
          JSON.stringify({ error: 'offline', message: 'No internet connection' }),
          { status: 503, headers: { 'Content-Type': 'application/json' } }
        )
      )
    );
    return;
  }

  // Cache-first for everything else (static assets, pages)
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).then((res) => {
        if (res.ok) {
          const clone = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return res;
      }).catch(() => {
        // Offline fallback for navigations
        if (event.request.mode === 'navigate') {
          return caches.match('/daily-brief') ||
            new Response('<html><body><h1>Taskora — Offline</h1><p>Please reconnect to use Taskora.</p></body></html>',
              { headers: { 'Content-Type': 'text/html' } });
        }
      });
    })
  );
});

// Push notification handler
self.addEventListener('push', (event) => {
  if (!event.data) return;
  const data = event.data.json();
  event.waitUntil(
    self.registration.showNotification(data.title || 'Taskora', {
      body: data.body || '',
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      data: data.data || {},
    })
  );
});

// Notification click
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const taskId = event.notification.data?.task_id;
  const url = taskId ? `/tasks/${taskId}` : '/daily-brief';
  event.waitUntil(clients.openWindow(url));
});
