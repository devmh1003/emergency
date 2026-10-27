// GPS 위치 읽기.
// GPS는 휴대폰이 위성 신호로 직접 계산하므로 인터넷이 없어도 동작한다.
// 다만 인터넷이 없으면 위치 보조(A-GPS)를 못 받아 첫 위치를 잡는 데 1분 가까이 걸릴 수 있어, 오프라인에서는 더 오래 기다린다.
// 웹사이트는 화면이 열려 있을 때만 위치를 읽을 수 있다.
import { t } from './i18n.js';

const GEO_ERRORS = {
  1: '위치 권한이 꺼져 있습니다. 휴대폰 설정에서 이 사이트(또는 브라우저)의 위치 권한을 허용하세요.',
  2: '위치를 찾을 수 없습니다. 하늘이 보이는 건물 밖이나 창가에서 다시 시도하세요.',
  3: '위치 확인 시간이 초과됐습니다. 하늘이 보이는 곳에서 다시 시도하세요.',
};

const LAST_KEY = 'family.lastPosition';

/** 마지막으로 잡힌 위치를 휴대폰에 저장해 둔다 (GPS를 못 잡을 때 참고용). */
function remember(pos) {
  try { localStorage.setItem(LAST_KEY, JSON.stringify(pos)); } catch { /* 저장소를 못 쓰는 환경 */ }
}

/** @returns {{lat, lng, accuracy, at:number}|null} */
export function lastKnownPosition() {
  try {
    const p = JSON.parse(localStorage.getItem(LAST_KEY) || 'null');
    return p && typeof p.lat === 'number' ? p : null;
  } catch {
    return null;
  }
}

function toPos(p) {
  const pos = {
    lat: Number(p.coords.latitude.toFixed(6)),
    lng: Number(p.coords.longitude.toFixed(6)),
    accuracy: Math.round(p.coords.accuracy),
    at: p.timestamp || Date.now(),
  };
  remember(pos);
  return pos;
}

/** @returns {Promise<{lat:number, lng:number, accuracy:number, at:number}>} */
export function getPosition({ timeout = 15000, highAccuracy = true, maximumAge = 30_000 } = {}) {
  return new Promise((resolve, reject) => {
    if (!('geolocation' in navigator)) {
      reject(new Error(t('이 기기는 위치 기능을 지원하지 않습니다.')));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (p) => resolve(toPos(p)),
      (e) => reject(new Error(GEO_ERRORS[e.code] ? t(GEO_ERRORS[e.code]) : e.message)),
      { enableHighAccuracy: highAccuracy, timeout, maximumAge },
    );
  });
}

/**
 * 정밀 GPS를 먼저 시도하고, 실패하면 대략적인 위치라도 가져온다.
 * 오프라인이면 GPS가 위성을 직접 잡아야 하므로 더 오래 기다린다.
 */
export async function getBestPosition() {
  const offline = !navigator.onLine;
  try {
    return await getPosition({ timeout: offline ? 60_000 : 15_000, highAccuracy: true });
  } catch (first) {
    try {
      // 몇 분 이내에 잡았던 위치라도 쓴다.
      return await getPosition({ timeout: 10_000, highAccuracy: false, maximumAge: 5 * 60_000 });
    } catch {
      throw first;
    }
  }
}

/**
 * 계속 위치를 받아 콜백을 부른다 (길찾기 화면용). 반환값을 호출하면 멈춘다.
 * 화면이 꺼지거나 다른 화면으로 가면 브라우저가 멈추므로, 화면을 떠날 때 반드시 멈춘다.
 */
export function watchPosition(onPos, onError) {
  if (!('geolocation' in navigator)) {
    onError?.(new Error(t('이 기기는 위치 기능을 지원하지 않습니다.')));
    return () => {};
  }
  const id = navigator.geolocation.watchPosition(
    (p) => onPos(toPos(p)),
    (e) => onError?.(new Error(GEO_ERRORS[e.code] ? t(GEO_ERRORS[e.code]) : e.message)),
    { enableHighAccuracy: true, timeout: navigator.onLine ? 20_000 : 60_000, maximumAge: 5_000 },
  );
  return () => navigator.geolocation.clearWatch(id);
}
