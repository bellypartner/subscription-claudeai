// Service Worker — MealBox PWA
const CACHE_NAME = 'mealbox-v3';
const STATIC_ASSETS = [
  '/manifest.json',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css',
  'https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=Playfair+Display:wght@700&display=swap'
];

// Install — cache static assets only
self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache =>
      cache.addAll(STATIC_ASSETS).catch(() => {})
    )
  );
});

// Activate — clean old caches
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Fetch — network first for API, cache first for static assets
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Always network for API calls
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(fetch(event.request).catch(() =>
      new Response(JSON.stringify({ error: 'Offline — no connection' }), {
        status: 503, headers: { 'Content-Type': 'application/json' }
      })
    ));
    return;
  }

  // Cache first for fonts and icons (CDN assets)
  if (url.hostname.includes('cdnjs') || url.hostname.includes('fonts.g')) {
    event.respondWith(
      caches.match(event.request).then(cached =>
        cached || fetch(event.request).then(resp => {
          const clone = resp.clone();
          caches.open(CACHE_NAME).then(c => c.put(event.request, clone));
          return resp;
        })
      )
    );
    return;
  }

  // Network first for HTML pages — show cached if offline
  if (event.request.mode === 'navigate' || event.request.headers.get('accept')?.includes('text/html')) {
    event.respondWith(
      fetch(event.request)
        .then(resp => {
          const clone = resp.clone();
          caches.open(CACHE_NAME).then(c => c.put(event.request, clone));
          return resp;
        })
        .catch(() => caches.match(event.request).then(cached =>
          cached || new Response('<h2>You are offline</h2><p>Please check your internet connection.</p>',
            { headers: { 'Content-Type': 'text/html' } })
        ))
    );
    return;
  }

  // Default — network with cache fallback
  event.respondWith(
    fetch(event.request).catch(() => caches.match(event.request))
  );
});

// Push notifications (for future use)
self.addEventListener('push', event => {
  const data = event.data?.json() || {};
  event.waitUntil(
    self.registration.showNotification(data.title || 'MealBox', {
      body: data.body || 'You have a new notification',
      icon: '/manifest.json',
      badge: '/manifest.json',
      data: data.url || '/',
    })
  );
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(clients.openWindow(event.notification.data || '/'));
});