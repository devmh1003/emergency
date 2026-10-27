// GPS 위치 읽기. 웹사이트는 화면이 열려 있을 때만 위치를 읽을 수 있다.

const GEO_ERRORS = {
  1: '위치 권한이 꺼져 있습니다. 휴대폰 설정에서 이 사이트의 위치 권한을 허용하세요.',
  2: '위치를 찾을 수 없습니다. 건물 밖이나 창가에서 다시 시도하세요.',
  3: '위치 확인 시간이 초과됐습니다. 다시 시도하세요.',
};

/** @returns {Promise<{lat:number, lng:number, accuracy:number}>} */
export function getPosition({ timeout = 15000, highAccuracy = true } = {}) {
  return new Promise((resolve, reject) => {
    if (!('geolocation' in navigator)) {
      reject(new Error('이 기기는 위치 기능을 지원하지 않습니다.'));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({
        lat: Number(p.coords.latitude.toFixed(6)),
        lng: Number(p.coords.longitude.toFixed(6)),
        accuracy: Math.round(p.coords.accuracy),
      }),
      (e) => reject(new Error(GEO_ERRORS[e.code] || e.message)),
      { enableHighAccuracy: highAccuracy, timeout, maximumAge: 30_000 },
    );
  });
}

/** 정밀 위치를 먼저 시도하고, 실패하면 대략적인 위치라도 가져온다. */
export async function getBestPosition() {
  try {
    return await getPosition({ timeout: 12000, highAccuracy: true });
  } catch (first) {
    try {
      return await getPosition({ timeout: 8000, highAccuracy: false });
    } catch {
      throw first;
    }
  }
}
