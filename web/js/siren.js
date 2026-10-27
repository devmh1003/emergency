// 1급 비상 경보음: 오르내리는 사이렌(sounds/siren.wav, tools/make-sounds.py 로 만든다)을 반복 재생한다.
// <audio> 로 재생하므로 한 번 울리기 시작하면 화면이 꺼져도 계속 울린다 (휴대폰이 허락하는 한).
// 경보 대기 모드: 같은 <audio> 로 무음을 계속 재생해 화면이 꺼져도 앱이 잠들지 않게 하고,
// 1급 경보가 오면 그 자리에서 경보음으로 바꾼다. 앱을 완전히 닫으면 웹으로는 소리를 낼 수 없다.
// 브라우저는 화면을 한 번 누르기 전에는 소리를 막는다. 그때는 경보 화면의 "경보음 켜기" 버튼이 소리를 켠다.
import { t } from './i18n.js';

const SIREN_SRC = new URL('../sounds/siren.wav', import.meta.url).href;
const SILENCE_SRC = new URL('../sounds/silence.wav', import.meta.url).href;
const STANDBY_KEY = 'family.standby';

let audio = null;
let mode = 'off'; // off | siren | standby
let vibrateTimer = null;
let wakeLock = null;

function player() {
  if (!audio) {
    audio = new Audio();
    audio.loop = true;
    audio.preload = 'auto';
  }
  return audio;
}

function mediaInfo(title) {
  try {
    if ('mediaSession' in navigator) {
      navigator.mediaSession.metadata = title ? new MediaMetadata({ title, artist: t('우리 가족 비상연락') }) : null;
    }
  } catch { /* 지원하지 않는 브라우저 */ }
}

async function keepScreenOn() {
  try {
    if ('wakeLock' in navigator && document.visibilityState === 'visible') wakeLock = await navigator.wakeLock.request('screen');
  } catch { /* 배터리 절약 모드 등으로 거부될 수 있다 */ }
}

function releaseScreen() {
  wakeLock?.release().catch(() => {});
  wakeLock = null;
}

/** 경보음을 낸다. 소리가 났으면 true, 브라우저가 막았으면 false. */
export async function startSiren() {
  const a = player();
  mode = 'siren';
  a.src = SIREN_SRC;
  a.volume = 1;
  mediaInfo(t('🚨 1급 비상 경보'));
  if (navigator.vibrate && navigator.userActivation?.hasBeenActive !== false) {
    const pattern = [600, 300, 600, 300, 600];
    clearInterval(vibrateTimer);
    navigator.vibrate(pattern);
    vibrateTimer = setInterval(() => navigator.vibrate(pattern), 3000);
  }
  keepScreenOn();
  try {
    await a.play();
    return true;
  } catch (err) {
    console.warn('경보음을 낼 수 없습니다', err);
    return false;
  }
}

export function isPlaying() {
  return mode === 'siren' && Boolean(audio) && !audio.paused;
}

/** 경보음을 멈춘다. 경보 대기 모드였으면 다시 무음 대기로 돌아간다. */
export function stopSiren() {
  clearInterval(vibrateTimer);
  vibrateTimer = null;
  if (navigator.vibrate) navigator.vibrate(0);
  releaseScreen();
  if (mode !== 'siren') return;
  mode = 'off';
  if (standbyWanted()) {
    startStandby().catch(() => {});
  } else {
    audio?.pause();
    mediaInfo(null);
  }
}

// ---------- 경보 대기 모드 (이 휴대폰에만 저장) ----------

export function standbyWanted() {
  try { return localStorage.getItem(STANDBY_KEY) === '1'; } catch { return false; }
}

export function standbyActive() {
  return mode === 'standby' && Boolean(audio) && !audio.paused;
}

/** 화면을 누른 직후(사용자 동작 안에서) 불러야 한다. 켜졌으면 true. */
export async function startStandby() {
  try { localStorage.setItem(STANDBY_KEY, '1'); } catch { /* 무시 */ }
  if (mode === 'siren') return true;
  const a = player();
  mode = 'standby';
  if (a.src !== SILENCE_SRC) a.src = SILENCE_SRC;
  mediaInfo(t('🛡 경보 대기 중'));
  try {
    await a.play();
    return true;
  } catch {
    return false;
  }
}

export function stopStandby() {
  try { localStorage.removeItem(STANDBY_KEY); } catch { /* 무시 */ }
  if (mode !== 'standby') return;
  audio?.pause();
  mode = 'off';
  mediaInfo(null);
}
