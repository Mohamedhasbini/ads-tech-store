/* ADS Tech service worker — conservative caching.
 * Images & fonts: cache-first. Pages: network-first with offline fallback. */
var VERSION = "ads-v2";
var IMG_CACHE = VERSION + "-img";
var PAGE_CACHE = VERSION + "-page";

self.addEventListener("install", function (e) { self.skipWaiting(); });
self.addEventListener("activate", function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k.indexOf(VERSION) !== 0; })
      .map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

self.addEventListener("fetch", function (e) {
  var req = e.request;
  if (req.method !== "GET") return;
  var url = new URL(req.url);

  var isImg = /\.(webp|avif|png|jpe?g|svg|gif)$/.test(url.pathname);
  var isFont = url.hostname === "fonts.gstatic.com" || url.hostname === "fonts.googleapis.com";

  if (isImg || isFont) {
    e.respondWith(caches.open(IMG_CACHE).then(function (c) {
      return c.match(req).then(function (hit) {
        return hit || fetch(req).then(function (res) {
          if (res.ok) c.put(req, res.clone());
          return res;
        });
      });
    }));
    return;
  }

  if (req.mode === "navigate") {
    e.respondWith(fetch(req).then(function (res) {
      var copy = res.clone();
      caches.open(PAGE_CACHE).then(function (c) { c.put(req, copy); });
      return res;
    }).catch(function () { return caches.match(req); }));
  }
});
