// 오프라인 준비: 설치하거나 처음 들어왔을 때, 인터넷이 끊겨도 쓸 수 있도록 미리 해 둔다.
//  1) 저장 공간 고정: 브라우저가 공간이 부족할 때 앱 저장본·지도·데이터를 지우지 않게 요청한다.
//  2) 앱 화면·라이브러리·글꼴·대처법(한국어/영어): 서비스 워커가 설치할 때 저장한다 (sw.js).
//  3) 지도: 집합장소와 내 위치 주변 지도를 미리 받아 둔다.
//  4) 가족·집합장소·대처법 데이터: Firestore가 휴대폰에 보관한다 (로그인해 있는 동안 자동).
//  5) 위치 권한: 미리 허용받아 두면 오프라인에서도 바로 GPS를 쓴다.
import { lastKnownPosition, getBestPosition } from './geo.js';

const PREP_KEY = 'family.offlinePrep';
const TILE_HOST = 'https://tile.openstreetmap.org';
// 동네(12)부터 골목(16)까지. 장소마다 가운데 칸과 둘레 한 칸씩(3×3)이라 장소 하나에 45장 정도.
const ZOOMS = [12, 13, 14, 15, 16];

function readPrep() {
  try { return JSON.parse(localStorage.getItem(PREP_KEY) || 'null'); } catch { return null; }
}

function writePrep(v) {
  try { localStorage.setItem(PREP_KEY, JSON.stringify(v)); } catch { /* 무시 */ }
}

/** 위도·경도 주변 지도 타일 주소 */
export function tileUrlsAround(lat, lng, zooms = ZOOMS, radius = 1) {
  const urls = [];
  for (const z of zooms) {
    const n = 2 ** z;
    const rad = (lat * Math.PI) / 180;
    const x = Math.floor(((lng + 180) / 360) * n);
    const y = Math.floor(((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * n);
    for (let dx = -radius; dx <= radius; dx++) {
      for (let dy = -radius; dy <= radius; dy++) {
        const tx = x + dx;
        const ty = y + dy;
        if (tx >= 0 && ty >= 0 && tx < n && ty < n) urls.push(`${TILE_HOST}/${z}/${tx}/${ty}.png`);
      }
    }
  }
  return urls;
}

async function requestPersistence() {
  try {
    if (!navigator.storage?.persist) return false;
    if (await navigator.storage.persisted()) return true;
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}

/** 서비스 워커에게 지도 타일을 받아 두라고 부탁하고 결과를 기다린다. */
async function precacheTiles(urls) {
  if (!urls.length || !('serviceWorker' in navigator)) return null;
  const reg = await navigator.serviceWorker.ready;
  if (!reg.active) return null;
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    const timer = setTimeout(() => resolve(null), 120_000);
    channel.port1.onmessage = (e) => { clearTimeout(timer); resolve(e.data); };
    reg.active.postMessage({ type: 'precache-tiles', urls }, [channel.port2]);
  });
}

function placesToMap(state) {
  const places = (state.meetingPoints || []).filter((p) => typeof p.lat === 'number' && typeof p.lng === 'number');
  const me = lastKnownPosition();
  if (me) places.push({ lat: me.lat, lng: me.lng });
  return places;
}

/**
 * 오프라인 준비를 한다. 인터넷이 될 때만 의미가 있다.
 * askLocation: 사용자가 버튼을 눌렀을 때만 위치 권한을 묻는다 (자동 실행 때는 묻지 않는다).
 */
export async function prepareOffline(state, { askLocation = false } = {}) {
  const result = { at: Date.now(), persisted: await requestPersistence(), tiles: null, location: null };
  if (askLocation) {
    try {
      await getBestPosition();
      result.location = 'granted';
    } catch (err) {
      result.location = err?.code === 1 ? 'denied' : 'failed';
    }
  }
  const urls = [...new Set(placesToMap(state).flatMap((p) => tileUrlsAround(p.lat, p.lng)))];
  const r = await precacheTiles(urls);
  result.tiles = r ? r.total : null;
  result.placesKey = placesKey(state);
  writePrep(result);
  return result;
}

function placesKey(state) {
  return placesToMap(state).map((p) => `${p.lat.toFixed(3)},${p.lng.toFixed(3)}`).sort().join('|');
}

/** 하루에 한 번, 또는 집합장소가 바뀌었을 때 조용히 다시 준비한다. */
export function maybeAutoPrepare(state) {
  if (!navigator.onLine) return;
  const prev = readPrep();
  const stale = !prev || Date.now() - prev.at > 86_400_000 || prev.placesKey !== placesKey(state);
  if (stale) prepareOffline(state).catch((err) => console.warn('오프라인 준비 실패', err));
}

/** 설정 화면에 보여줄 준비 상태 */
export async function offlineStatus() {
  const status = {
    serviceWorker: Boolean(navigator.serviceWorker?.controller),
    appSaved: false,
    persisted: false,
    tiles: 0,
    location: 'unknown',
    lastPosition: lastKnownPosition(),
    prep: readPrep(),
  };
  try {
    const keys = await caches.keys();
    status.appSaved = keys.some((k) => k.startsWith('family-app-'));
    if (keys.includes('family-tiles-v1')) status.tiles = (await (await caches.open('family-tiles-v1')).keys()).length;
  } catch { /* 저장소를 못 쓰는 환경 */ }
  try { status.persisted = Boolean(await navigator.storage?.persisted?.()); } catch { /* 무시 */ }
  try { status.location = (await navigator.permissions.query({ name: 'geolocation' })).state; } catch { /* 지원 안 함 */ }
  return status;
}
