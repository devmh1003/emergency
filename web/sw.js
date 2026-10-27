// 서비스 워커: 앱을 휴대폰에 저장해 인터넷이 없어도 열리게 하고, 비상선언 알림을 받는다.
// BUILD 값은 배포할 때 커밋 해시로 바뀐다 (.github/workflows/pages.yml). 바뀌면 새 버전을 받아 저장한다.
const BUILD = 'dev';
const APP_CACHE = `family-app-${BUILD}`;
const LIB_CACHE = 'family-libs-v1';
const TILE_CACHE = 'family-tiles-v1';
const MAX_TILES = 1500;

// 앱 화면에 필요한 모든 파일. 파일을 추가하면 여기에도 추가한다 (tests/sw.test.js 가 검사한다).
const APP_FILES = [
  './',
  'index.html',
  'manifest.webmanifest',
  'css/app.css',
  'icons/icon.svg',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'js/config.js',
  'js/app.js',
  'js/dom.js',
  'js/firebase.js',
  'js/geo.js',
  'js/logic.js',
  'js/map.js',
  'js/push.js',
  'js/siren.js',
  'js/store.js',
  'js/data/protocols.js',
  'js/views/admin.js',
  'js/views/auth.js',
  'js/views/emergency.js',
  'js/views/family.js',
  'js/views/home.js',
  'js/views/meet.js',
  'js/views/protocols.js',
  'js/views/settings.js',
];

const FIREBASE = 'https://www.gstatic.com/firebasejs/13.0.0';
const LIB_FILES = [
  `${FIREBASE}/firebase-app.js`,
  `${FIREBASE}/firebase-auth.js`,
  `${FIREBASE}/firebase-firestore.js`,
  `${FIREBASE}/firebase-messaging.js`,
  'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css',
];

// ---------- 알림 (Firebase Cloud Messaging) ----------
// 알림 내용(notification)이 담긴 메시지는 SDK가 자동으로 표시하고, 누르면 사이트를 연다.
try {
  importScripts('js/config.js');
  const cfg = self.FAMILY_CONFIG;
  if (cfg?.firebase?.apiKey) {
    importScripts(`${FIREBASE}/firebase-app-compat.js`, `${FIREBASE}/firebase-messaging-compat.js`);
    self.firebase.initializeApp(cfg.firebase);
    self.firebase.messaging();
  }
} catch (err) {
  // 오프라인 등으로 SDK를 못 불러와도 앱 저장 기능은 계속 동작해야 한다.
  console.warn('알림 SDK를 불러오지 못했습니다', err);
}

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = new URL('./', self.registration.scope).href;
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const existing = all.find((c) => c.url.startsWith(target));
    if (existing) return existing.focus();
    return self.clients.openWindow(target);
  })());
});

// ---------- 저장 ----------

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const app = await caches.open(APP_CACHE);
    await app.addAll(APP_FILES);
    const libs = await caches.open(LIB_CACHE);
    // 외부 라이브러리는 하나가 실패해도 설치를 막지 않는다.
    await Promise.all(LIB_FILES.map(async (url) => {
      if (await libs.match(url)) return;
      try {
        const res = await fetch(url, { mode: 'cors', credentials: 'omit' });
        if (res.ok) await libs.put(url, res);
      } catch { /* 다음에 다시 시도 */ }
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keep = [APP_CACHE, LIB_CACHE, TILE_CACHE];
    for (const key of await caches.keys()) {
      if (key.startsWith('family-') && !keep.includes(key)) await caches.delete(key);
    }
    await self.clients.claim();
  })());
});

async function trimTiles() {
  const cache = await caches.open(TILE_CACHE);
  const keys = await cache.keys();
  for (let i = 0; i < keys.length - MAX_TILES; i++) await cache.delete(keys[i]);
}

// 저장본을 먼저 보여주고, 뒤에서 새 버전을 받아 둔다.
async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request, { ignoreSearch: true });
  const network = fetch(request).then((res) => {
    if (res.ok) cache.put(request, res.clone());
    return res;
  }).catch(() => null);
  return cached || (await network) || Response.error();
}

// 버전이 고정된 파일은 한 번 받으면 바뀌지 않는다.
async function cacheFirst(request, cacheName, onStore) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;
  try {
    const res = await fetch(request);
    if (res.ok) {
      await cache.put(request, res.clone());
      if (onStore) onStore();
    }
    return res;
  } catch {
    return Response.error();
  }
}

// 화면(HTML)은 최신을 먼저 시도하고, 안 되면 저장본.
async function networkFirstPage(request) {
  const cache = await caches.open(APP_CACHE);
  try {
    const res = await fetch(request);
    if (res.ok) cache.put('index.html', res.clone());
    return res;
  } catch {
    return (await cache.match('index.html')) || (await cache.match('./')) || Response.error();
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  // Firebase 데이터·인증·Worker 요청은 저장하지 않는다 (Firestore가 자체 오프라인 저장소를 쓴다).
  if (url.hostname.endsWith('googleapis.com') || url.hostname.endsWith('workers.dev')) return;

  if (url.hostname === 'tile.openstreetmap.org') {
    event.respondWith(cacheFirst(request, TILE_CACHE, trimTiles));
    return;
  }
  if (url.hostname === 'www.gstatic.com' || url.hostname === 'cdnjs.cloudflare.com') {
    event.respondWith(cacheFirst(request, LIB_CACHE));
    return;
  }
  if (url.origin === self.location.origin) {
    if (request.mode === 'navigate') event.respondWith(networkFirstPage(request));
    else event.respondWith(staleWhileRevalidate(request, APP_CACHE));
  }
});
