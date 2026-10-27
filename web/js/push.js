// 비상선언 알림 (Firebase Cloud Messaging 웹 푸시).
// 아이폰은 사이트를 홈 화면에 추가하고 그 아이콘으로 열었을 때만 알림을 받을 수 있다.
import { getMessaging, getToken, deleteToken, isSupported } from 'https://www.gstatic.com/firebasejs/13.0.0/firebase-messaging.js';
import { app, config } from './firebase.js';
import { savePushToken, deletePushToken } from './store.js';
import { isIOS, isStandalone, nativeApp } from './dom.js';
import { t } from './i18n.js';

const TOKEN_KEY = 'family.pushToken';

function storedToken() {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

function storeToken(token) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch { /* 저장소를 못 쓰는 환경(사생활 보호 모드)은 무시 */ }
}

function appPermissions() {
  try { return JSON.parse(nativeApp.permissions()); } catch { return {}; }
}

export function pushStatus() {
  if (nativeApp) return appPermissions().notifications && nativeApp.getPushToken() && storedToken() ? 'on' : 'off';
  if (!('Notification' in window)) {
    return isIOS && !isStandalone ? 'ios-needs-install' : 'unsupported';
  }
  if (Notification.permission === 'denied') return 'denied';
  if (Notification.permission === 'granted' && storedToken()) return 'on';
  return 'off';
}

async function currentToken() {
  if (!config.vapidKey) throw new Error(t('알림 키(vapidKey)가 설정되지 않았습니다.'));
  if (!(await isSupported())) {
    throw new Error(isIOS && !isStandalone
      ? t('아이폰은 먼저 공유 버튼 → "홈 화면에 추가"를 한 뒤, 홈 화면 아이콘으로 열어서 알림을 켜세요.')
      : t('이 브라우저는 알림을 지원하지 않습니다.'));
  }
  const registration = await navigator.serviceWorker.ready;
  return getToken(getMessaging(app), { vapidKey: config.vapidKey, serviceWorkerRegistration: registration });
}

export async function enablePush(uid) {
  if (nativeApp) {
    if (!appPermissions().notifications) {
      nativeApp.openPermissions();
      throw new Error(t('앱 권한 화면에서 알림을 허용한 뒤 다시 누르세요.'));
    }
    const token = nativeApp.getPushToken();
    if (!token) throw new Error(t('알림 등록을 준비하는 중입니다. 잠시 뒤 다시 누르세요.'));
    await savePushToken(uid, token);
    storeToken(token);
    return token;
  }
  if (!('Notification' in window)) await currentToken(); // 지원하지 않는 이유를 오류로 알려준다
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error(t('알림 권한이 거부됐습니다. 휴대폰 설정에서 이 사이트의 알림을 허용하세요.'));
  const token = await currentToken();
  await savePushToken(uid, token);
  storeToken(token);
  return token;
}

/** 앱을 열 때마다 토큰을 다시 등록한다 (토큰은 가끔 바뀐다). */
export async function refreshPushToken(uid) {
  try {
    if (nativeApp) {
      const token = nativeApp.getPushToken();
      if (!token) return;
      const previous = storedToken();
      if (previous && previous !== token) await deletePushToken(previous).catch(() => {});
      await savePushToken(uid, token);
      storeToken(token);
      return;
    }
    if (!('Notification' in window) || Notification.permission !== 'granted' || !config.vapidKey) return;
    const token = await currentToken();
    const previous = storedToken();
    if (previous && previous !== token) await deletePushToken(previous).catch(() => {});
    await savePushToken(uid, token);
    storeToken(token);
  } catch (err) {
    console.warn('알림 토큰 갱신 실패', err);
  }
}

/** 로그아웃 전에 호출: 이 기기로 더 이상 알림이 오지 않게 한다. */
export async function disablePush() {
  const token = storedToken();
  if (!token) return;
  await deletePushToken(token).catch(() => {});
  if (nativeApp) { storeToken(null); return; }
  try {
    if (await isSupported()) await deleteToken(getMessaging(app));
  } catch { /* 이미 지워진 경우 */ }
  storeToken(null);
}
