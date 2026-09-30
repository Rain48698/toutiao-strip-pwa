/* 头条图片去水印 — Service Worker
 * 版本化预缓存应用壳（cache-first），离线可用；activate 清理旧缓存。
 * 注意：SW 仅在 HTTPS（或 localhost）下注册；局域网 http 调试时核心功能不受影响。
 */
const VERSION = 'v1.0.4';
const CACHE_NAME = `toutiao-strip-${VERSION}`;
const PRECACHE = [
  './',
  './index.html',
  './css/style.css',
  './js/strip.js',
  './js/app.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-192.png',
  './icons/icon-maskable-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    // 逐个 add，单个资源失败不阻断安装
    await Promise.allSettled(PRECACHE.map((url) => cache.add(url)));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith((async () => {
    const cached = await caches.match(req, { ignoreSearch: req.mode === 'navigate' });
    if (cached) return cached;
    try {
      const res = await fetch(req);
      if (res && res.ok && res.type === 'basic') {
        const cache = await caches.open(CACHE_NAME);
        cache.put(req, res.clone());
      }
      return res;
    } catch (err) {
      // 离线时导航请求回退到应用壳
      const shell = await caches.match('./index.html');
      if (shell) return shell;
      throw err;
    }
  })());
});
