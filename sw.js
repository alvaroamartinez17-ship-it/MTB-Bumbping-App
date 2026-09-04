/*
 * sw.js — makes the recorder work with no network at all.
 *
 * This is the piece that makes a SIM-less phone viable. Everything the
 * recorder needs is precached on first load over Wi-Fi; after that the app
 * opens at the trailhead with the radio finding nothing.
 *
 * iOS 15 supports service workers (they landed in 11.3). Note that iOS evicts
 * caches for sites you haven't opened in a few weeks, so open the app on
 * Wi-Fi occasionally, or add it to the Home Screen, which makes eviction much
 * less likely.
 *
 * Once installed, this worker serves everything from cache and never contacts
 * the network on its own. The only connection to GitHub is the one you ask for
 * by tapping Check for updates.
 *
 * No analytics, no fonts, no API calls. Ride data never passes through here
 * because it never travels at all. Satellite tiles, if you switch them on,
 * bypass this worker entirely.
 */

const VERSION = 'mtbbump-v8';
const BUILD = '2026-08-31';

const PRECACHE = [
  './',
  './index.html',
  './analyse.html',
  './css/app.css',
  './js/analysis.js',
  './js/trails.js',
  './js/i18n.js',
  './js/setup.js',
  './js/tiles.js',
  './js/appmanage.js',
  './js/store.js',
  './js/crypto.js',
  './js/backup.js',
  './js/trackmap.js',
  './js/recorder.js',
  './js/descent.js',
  './manifest.json',
  './icon.svg',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(VERSION)
      .then((c) => c.addAll(PRECACHE))
  );
  // Deliberately no skipWaiting() here. A new worker taking over mid-session
  // would reload the page and lose the descent being recorded. The page asks
  // for the swap when it is safe — see the message handler below.
});

self.addEventListener('message', (e) => {
  if (e.data && e.data.type === 'SKIP_WAITING') self.skipWaiting();
  if (e.data && e.data.type === 'VERSION') {
    e.source.postMessage({ type: 'VERSION', version: VERSION, build: BUILD });
  }
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);

  // Only this app's own origin is handled here. Map tiles are the one
  // cross-origin request the app can make, and they are left to the browser's
  // own HTTP cache.
  if (url.origin !== self.location.origin) return;
  if (e.request.method !== 'GET') return;

  // CACHE ONLY. A cached hit is served and the network is never touched, not
  // even in the background.
  //
  // The obvious alternative -- serve the cache, then quietly refetch for next
  // time -- means every screen you open reaches out to GitHub. That is a steady
  // trickle of requests announcing when and how often you use the app, and it
  // buys nothing: the app only changes when you push to the repo. Updates are
  // an explicit action instead. See appmanage.js.
  //
  // The fallback below fires only for a same-origin file missing from the
  // cache entirely, which in practice means a file added since the last
  // update. Offline it fails, and that is the correct outcome.
  e.respondWith(
    caches.match(e.request).then((hit) => hit || fetch(e.request))
  );
});
