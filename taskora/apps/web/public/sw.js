// v2: never cache navigation responses — auth redirects must not be cached
const CACHE_NAME = 'taskora-v2';

// Install: skip waiting, no app-shell pre-caching (pages need fresh auth checks)
self.addEventListener('install', (event) => {
  self.skipWaiting();
});

// Activate: clean old caches and claim clients immediately
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Fetch strategy:
//   navigate requests  → always network (never cache — auth redirects must stay fresh)
//   /api/*             → network-first with offline fallback
//   _next/static/*     → cache-first (immutable build assets)
//   everything else    → network only
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  if (event.request.method !== 'GET') return;
  if (url.origin !== self.location.origin) return;

  // Navigation (HTML pages): always fetch from network — never serve a cached redirect
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request).catch(() =>
        new Response(
          '<html><body><h1>Taskora — Offline</h1><p>Please reconnect to use Taskora.</p></body></html>',
          { headers: { 'Content-Type': 'text/html' } }
        )
      )
    );
    return;
  }

  // API calls: network-first
  if (url.pathname.startsWith('/api/')) {
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

  // Next.js build assets (_next/static): cache-first (content-hashed, safe to cache)
  if (url.pathname.startsWith('/_next/static/')) {
    event.respondWith(
      caches.match(event.request).then((cached) => {
        if (cached) return cached;
        return fetch(event.request).then((res) => {
          if (res.ok) {
            const clone = res.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return res;
        });
      })
    );
    return;
  }

  // Everything else: network only
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
