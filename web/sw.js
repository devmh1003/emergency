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
  'js/i18n.js',
  'js/i18n/en-admin.js',
  'js/i18n/en-alarm.js',
  'js/i18n/en-app.js',
  'js/i18n/en-core.js',
  'js/i18n/en-home.js',
  'js/logic.js',
  'js/map.js',
  'js/offline.js',
  'js/push.js',
  'js/siren.js',
  'js/store.js',
  'js/data/contacts.en.js',
  'js/data/contacts.js',
  'js/data/protocols.en.js',
  'js/data/protocols.js',
  'js/views/admin.js',
  'js/views/adminhub.js',
  'js/views/auth.js',
  'js/views/contacts.js',
  'js/views/emergency.js',
  'js/views/family.js',
  'js/views/guide.js',
  'js/views/home.js',
  'js/views/location.js',
  'js/views/meet.js',
  'js/views/protocols.js',
  'js/views/records.js',
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
  'https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.css',
  'https://fonts.googleapis.com/css2?family=Public+Sans:wght@400;600;700;800&display=swap',
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
    // 브라우저의 HTTP 캐시(GitHub Pages는 10분)를 건너뛰고 서버에서 새로 받는다.
    // 그러지 않으면 새 버전 이름으로 옛 CSS·JS가 저장되어 화면이 깨진 채로 남는다.
    await app.addAll(APP_FILES.map((url) => new Request(url, { cache: 'reload' })));
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

// 앱 파일은 이 버전을 설치할 때 한꺼번에 저장한 것만 쓴다. 버전이 섞이면 화면이 깨진다.
async function appFile(request) {
  const cache = await caches.open(APP_CACHE);
  const cached = await cache.match(request, { ignoreSearch: true });
  if (cached) return cached;
  try {
    return await fetch(request);
  } catch {
    return Response.error();
  }
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
    // HTTP 캐시에 남은 옛 화면이 아니라 서버에 새 버전이 있는지 확인한다.
    const res = await fetch(request.url, { cache: 'no-cache', credentials: 'same-origin' });
    // 앱 화면(사이트 첫 주소나 index.html)일 때만 오프라인용으로 저장한다.
    // 다른 파일 주소를 직접 열었을 때 그 내용이 앱 화면 자리에 저장되면 오프라인에서 앱이 안 열린다.
    const path = new URL(request.url).pathname;
    const scope = new URL(self.registration.scope).pathname;
    const isAppPage = path === scope || path === `${scope}index.html`;
    if (res.ok && !res.redirected && isAppPage && (res.headers.get('content-type') || '').includes('text/html')) {
      cache.put('index.html', res.clone());
    }
    if (res.redirected) return Response.redirect(res.url, 302);
    return res;
  } catch {
    return (await cache.match('index.html')) || (await cache.match('./')) || Response.error();
  }
}

// 오프라인 준비: 앱이 집합장소·내 위치 주변 지도 타일 주소를 보내면 미리 받아 둔다 (js/offline.js).
// OpenStreetMap 타일 주소만 받고, 한 번에 600장까지만 받는다.
self.addEventListener('message', (event) => {
  if (event.data?.type !== 'precache-tiles') return;
  const urls = (Array.isArray(event.data.urls) ? event.data.urls : [])
    .filter((u) => {
      try { return new URL(u).hostname === 'tile.openstreetmap.org'; } catch { return false; }
    })
    .slice(0, 600);
  event.waitUntil((async () => {
    const cache = await caches.open(TILE_CACHE);
    let added = 0;
    for (const url of urls) {
      if (await cache.match(url)) continue;
      try {
        // CORS로 받는다 (opaque 응답은 저장 공간을 크게 차지한다). 지도(map.js)도 crossOrigin으로 불러온다.
        const res = await fetch(url, { mode: 'cors', credentials: 'omit' });
        if (res.ok) {
          await cache.put(url, res);
          added++;
        }
      } catch { /* 인터넷이 끊기면 다음에 다시 */ }
    }
    await trimTiles();
    const total = (await cache.keys()).length;
    event.ports[0]?.postMessage({ added, total });
  })());
});

// "evilgoogleapis.com" 같은 다른 도메인이 걸리지 않도록 점(.) 경계까지 확인한다.
function isDomainOrSub(hostname, domain) {
  return hostname === domain || hostname.endsWith(`.${domain}`);
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  // 글꼴 CSS(fonts.googleapis.com)는 버전이 고정된 라이브러리처럼 저장한다.
  if (url.hostname === 'fonts.googleapis.com') {
    event.respondWith(cacheFirst(request, LIB_CACHE));
    return;
  }
  // Firebase 데이터·인증·Worker 요청은 저장하지 않는다 (Firestore가 자체 오프라인 저장소를 쓴다).
  if (isDomainOrSub(url.hostname, 'googleapis.com') || isDomainOrSub(url.hostname, 'workers.dev')) return;

  if (url.hostname === 'tile.openstreetmap.org') {
    event.respondWith(cacheFirst(request, TILE_CACHE, trimTiles));
    return;
  }
  // 버전이 고정된 라이브러리와 글꼴 (글꼴 파일은 처음 쓸 때 저장된다)
  if (['www.gstatic.com', 'cdnjs.cloudflare.com', 'cdn.jsdelivr.net', 'fonts.gstatic.com'].includes(url.hostname)) {
    event.respondWith(cacheFirst(request, LIB_CACHE));
    return;
  }
  if (url.origin === self.location.origin) {
    if (request.mode === 'navigate') event.respondWith(networkFirstPage(request));
    else event.respondWith(appFile(request));
  }
});
