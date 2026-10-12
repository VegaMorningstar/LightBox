/* LightBox service worker: makes the page work offline and load fast on repeat visits.
 *
 *  - The app itself (page, scripts, styles, manifest, icons) is kept in a cache and served from it straight away, then
 *    quietly refreshed from the network, so an update shows up on the next visit without ever blocking this one.
 *  - Photos are cached as they are first looked at and served from the cache after that (they never change under the
 *    same name). The cache is trimmed, so it cannot grow without limit.
 *  - Anything else (the recordings used for local testing, other sites) is left alone.
 *
 * Bump VERSION when the list of files below changes; old caches are deleted when the new worker takes over.
 */
const VERSION = "lightbox-v1";
const APP = `${VERSION}-app`;
const PHOTOS = `${VERSION}-photos`;
const MAX_PHOTOS = 160;            // thumbnails and mid-size frames kept at most

const SHELL = [
  "./", "index.html", "photos.json", "manifest.webmanifest",
  "lightbox/lightbox.css", "lightbox/lightbox.js", "lightbox/dial.js", "lightbox/dust.js", "lightbox/film.js",
  "lightbox/glass.js", "lightbox/raster.js", "lightbox/sounds.js",
  "icons/icon-192.png", "icons/icon-512.png", "icons/icon.svg",
  "audio/glass-lift.wav", "audio/glass-place.wav",
];

self.addEventListener("install", (event) => {
  // the app, plus the thumbnails, so the very first visit can be reopened offline
  event.waitUntil((async () => {
    const app = await caches.open(APP);
    await app.addAll(SHELL);
    try {
      const { photos } = await (await fetch("photos.json", { cache: "no-store" })).json();
      const cache = await caches.open(PHOTOS);
      await Promise.all(photos.map((p) => cache.add(p.replace(/([^/]+)$/, "thumb/$1")).catch(() => {})));
    } catch { /* offline thumbnails are a bonus; the app still installs */ }
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (!key.startsWith(VERSION)) await caches.delete(key);
    await self.clients.claim();
  })());
});

async function trim(cache) {
  const keys = await cache.keys();
  for (const k of keys.slice(0, Math.max(0, keys.length - MAX_PHOTOS))) await cache.delete(k);   // oldest first
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;                         // only this site
  if (url.pathname.includes("/local-audio/")) return;                 // local test recordings are never cached

  // photos: cache first
  if (/\/sample-photos\/|\.(?:jpe?g|png|webp|avif)$/i.test(url.pathname) && !url.pathname.includes("/icons/")) {
    event.respondWith((async () => {
      const cache = await caches.open(PHOTOS);
      const hit = await cache.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok) { cache.put(req, res.clone()); trim(cache); }
      return res;
    })());
    return;
  }

  // the app: from the cache at once, refreshed in the background
  event.respondWith((async () => {
    const cache = await caches.open(APP);
    const hit = await cache.match(req, { ignoreSearch: true });
    const refresh = fetch(req).then((res) => { if (res.ok) cache.put(req, res.clone()); return res; });
    if (hit) { refresh.catch(() => {}); return hit; }
    try { return await refresh; }
    catch { return req.mode === "navigate" ? (await cache.match("index.html")) ?? Response.error() : Response.error(); }
  })());
});
