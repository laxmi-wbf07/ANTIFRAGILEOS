/* ============================================================
   sw.js — offline shell and notification delivery

   Bump CACHE when you change any file. The app shows a small
   "update ready" bar rather than swapping code underneath you
   mid-session, because losing a running focus timer to a silent
   reload would be worse than waiting.
   ============================================================ */

const CACHE = 'engine-v21';

const ASSETS = [
  './',
  './index.html',
  './learn.html',
  './manifest.webmanifest',
  './css/app.css',
  './js/app.js',
  './js/util.js',
  './js/store.js',
  './js/state.js',
  './js/srs.js',
  './js/game.js',
  './js/money.js',
  './js/next.js',
  './js/plan.js',
  './js/ui.js',
  './js/notify.js',
  './js/session.js',
  './js/views/cards.js',
  './js/views/reel.js',
  './js/views/focus.js',
  './js/views/plan.js',
  './js/views/money.js',
  './js/views/you.js',
  './js/views/settings.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
  './icons/badge-72.png',
  './icons/favicon.svg',
];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // Add individually so one missing file cannot fail the whole install.
    await Promise.all(ASSETS.map(url =>
      cache.add(new Request(url, { cache: 'reload' })).catch(() => {})
    ));
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)));
    if (self.registration.navigationPreload) {
      await self.registration.navigationPreload.enable().catch(() => {});
    }
    await self.clients.claim();
  })());
});

self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Navigations: try the network briefly, fall back to the cached shell.
  // This is what makes the app open instantly on a bad campus connection.
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const preload = await event.preloadResponse;
        if (preload) return preload;
        const net = await fetch(req);
        const cache = await caches.open(CACHE);
        cache.put('./index.html', net.clone()).catch(() => {});
        return net;
      } catch (e) {
        const cache = await caches.open(CACHE);
        return (await cache.match('./index.html'))
          || (await cache.match('./'))
          || new Response('<h1>Offline</h1>', { headers: { 'Content-Type': 'text/html' } });
      }
    })());
    return;
  }

  // Everything else: serve from cache immediately, refresh in the background.
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const hit = await cache.match(req);
    const network = fetch(req).then(res => {
      if (res && res.status === 200 && res.type === 'basic') cache.put(req, res.clone()).catch(() => {});
      return res;
    }).catch(() => null);
    return hit || (await network) || new Response('', { status: 504 });
  })());
});

/* ---------- notifications ----------
   Every nudge carries up to two buttons, and a button is only worth
   having if it does the thing rather than opening a screen with the
   thing on it. So each action maps to a route the app knows how to act
   on the moment it boots, whether or not a window was already open. */
const ROUTE = {
  start: './#/focus/start',
  open: './#/cards',
  cards: './#/cards',
  log: './#/money/add',
};

self.addEventListener('notificationclick', event => {
  const act = event.action;
  event.notification.close();
  if (act === 'later') return;               // dismissed on purpose

  const data = event.notification.data || {};
  const target = ROUTE[act] || data.url || './';

  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const scope = self.registration.scope;
    for (const client of all) {
      if (client.url.startsWith(scope)) {
        await client.focus();
        client.postMessage({ type: 'navigate', url: target });
        return;
      }
    }
    await self.clients.openWindow(target);
  })());
});

self.addEventListener('notificationclose', () => {});

/* Where the browser has it, this wakes the worker on its own schedule.
   It is Chrome-only and installed-only, so it is a bonus layer rather
   than the one anything depends on: a client that is already open does
   its own scheduling. */
self.addEventListener('periodicsync', event => {
  if (event.tag !== 'engine-nudge') return;
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of all) client.postMessage({ type: 'nudge' });
  })());
});
