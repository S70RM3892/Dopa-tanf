// オフライン用サービスワーカー（GitHub Pages 版）
// - このサイトのファイル: ネット優先。2.5秒応答がなければ保存済みの版で動かす（電車の中でも使える）
// - Google Fonts: 保存済みを優先
// BUILD はデプロイ時に GitHub Actions がコミットIDに置き換える。変わると古い保存分を捨てる。
const BUILD = "__BUILD__";
const CACHE = "dopa-site-" + BUILD;
const FONTS = "dopa-fonts-v1";
const CORE = [
  "./",
  "index.html",
  "app.js",
  "manifest.webmanifest",
  "icons/icon.svg",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/icon-maskable-512.png",
  "icons/apple-touch-icon.png",
  "words/poly.js",
  "words/poly2.js",
  "words/abstract.js",
  "words/verbs.js",
  "words/verbs2.js",
  "words/verbs3.js",
  "words/adjs1.js",
  "words/adjs2.js",
  "words/nouns1.js",
  "words/nouns2.js",
  "words/tech.js",
  "words/idioms.js",
  "words/synonyms.js",
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => c.addAll(CORE.map((u) => new Request(u, { cache: "reload" }))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("dopa-site-") && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

async function networkFirst(req) {
  const cache = await caches.open(CACHE);
  const net = fetch(req).then((res) => {
    if (res.ok) cache.put(req, res.clone());
    return res;
  });
  net.catch(() => {});
  try {
    return await Promise.race([net, new Promise((_, reject) => setTimeout(reject, 2500))]);
  } catch {
    const hit = (await cache.match(req, { ignoreSearch: true })) || (req.mode === "navigate" ? await cache.match("index.html") : undefined);
    if (hit) return hit;
    return net.catch(() => Response.error());
  }
}

async function cacheFirst(req) {
  const cache = await caches.open(FONTS);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok || res.type === "opaque") cache.put(req, res.clone());
  return res;
}

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin === self.location.origin) e.respondWith(networkFirst(req));
  else if (url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com") e.respondWith(cacheFirst(req));
});
