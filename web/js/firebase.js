// Firebase 초기화. SDK는 gstatic CDN에서 버전을 고정해 불러오고, 서비스 워커가 휴대폰에 저장해 둔다.
import { initializeApp, deleteApp } from 'https://www.gstatic.com/firebasejs/13.0.0/firebase-app.js';
import {
  initializeAuth, indexedDBLocalPersistence, browserLocalPersistence, inMemoryPersistence,
  connectAuthEmulator, onAuthStateChanged, signInWithEmailAndPassword, signOut,
  createUserWithEmailAndPassword,
} from 'https://www.gstatic.com/firebasejs/13.0.0/firebase-auth.js';
import { t } from './i18n.js';
import {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager, memoryLocalCache,
  connectFirestoreEmulator,
} from 'https://www.gstatic.com/firebasejs/13.0.0/firebase-firestore.js';

export const config = self.FAMILY_CONFIG || {};
export const isConfigured = Boolean(config.firebase?.apiKey && config.firebase?.projectId);

const useEmulators = Boolean(config.useEmulators) && ['localhost', '127.0.0.1'].includes(location.hostname);

export let app = null;
export let auth = null;
export let db = null;

if (isConfigured) {
  app = initializeApp(config.firebase);
  // 로그인 상태를 휴대폰에 저장해 오프라인에서도, 비밀번호를 잊어도 계속 열리게 한다.
  auth = initializeAuth(app, { persistence: [indexedDBLocalPersistence, browserLocalPersistence] });
  try {
    // 받은 데이터와 보내지 못한 쓰기를 휴대폰에 저장한다. 오프라인에서 누른 생존신고는 연결되면 자동 전송된다.
    db = initializeFirestore(app, {
      localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
    });
  } catch (err) {
    console.warn('오프라인 저장소를 쓸 수 없어 메모리 캐시로 동작합니다.', err);
    db = initializeFirestore(app, { localCache: memoryLocalCache() });
  }
  if (useEmulators) {
    connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
    connectFirestoreEmulator(db, '127.0.0.1', 8080);
  }
}

export function watchAuth(cb) {
  return onAuthStateChanged(auth, cb);
}

// ---------- 접속 코드 ----------
// 접속 코드 3가지(가족·관리자·백업)는 각각 "관문 계정"의 비밀번호다.
// 관문 계정으로 코드를 확인하면 이름 목록이 보이고, 이름을 고르면 그 사람 계정(무작위 열쇠)으로 로그인한다.
// 계정 이메일은 메일이 오가지 않는 내부 주소다: g-family-xxxx@프로젝트.firebaseapp.com

/** 추측할 수 없는 무작위 문자열 (영문 소문자 + 숫자) */
export function randomToken(length = 24) {
  const chars = 'abcdefghijkmnpqrstuvwxyz23456789';
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => chars[b % chars.length]).join('');
}

export function newAccountEmail(prefix) {
  return `${prefix}-${randomToken(12)}@${config.firebase.projectId}.firebaseapp.com`;
}

export function signIn(email, password) {
  return signInWithEmailAndPassword(auth, email, password);
}

export function logout() {
  return signOut(auth);
}

/** 지금 로그인을 건드리지 않도록 잠깐 쓰는 별도 인스턴스에서 인증 작업을 한다. */
async function withSecondaryAuth(fn) {
  const secondary = initializeApp(config.firebase, `tmp-${randomToken(8)}`);
  try {
    const secondaryAuth = initializeAuth(secondary, { persistence: inMemoryPersistence });
    if (useEmulators) connectAuthEmulator(secondaryAuth, 'http://127.0.0.1:9099', { disableWarnings: true });
    return await fn(secondaryAuth);
  } finally {
    await deleteApp(secondary);
  }
}

/** 새 계정을 만들고 uid를 돌려준다 (지금 로그인한 사람은 그대로). */
export function createAccount(email, password) {
  return withSecondaryAuth(async (a) => {
    const cred = await createUserWithEmailAndPassword(a, email, password);
    await signOut(a);
    return cred.user.uid;
  });
}

/** 이 이메일·비밀번호가 맞는지만 확인한다 (지금 로그인한 사람은 그대로). */
export function credentialWorks(email, password) {
  return withSecondaryAuth(async (a) => {
    try {
      await signInWithEmailAndPassword(a, email, password);
      await signOut(a);
      return true;
    } catch {
      return false;
    }
  });
}

/** Cloudflare Worker 호출. 로그인한 사용자의 ID 토큰으로 본인임을 증명한다. */
export async function callWorker(path, body = {}) {
  if (!config.workerUrl) throw new Error(t('알림 서버(Worker) 주소가 설정되지 않았습니다.'));
  const token = await auth.currentUser.getIdToken();
  const res = await fetch(config.workerUrl.replace(/\/$/, '') + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || t('서버 오류 ({status})', { status: res.status }));
  return data;
}

const AUTH_MESSAGES = {
  'auth/invalid-credential': '접속 코드가 맞지 않습니다.',
  'auth/wrong-password': '접속 코드가 맞지 않습니다.',
  'auth/user-not-found': '접속 코드가 맞지 않습니다.',
  'auth/invalid-email': '계정 정보가 올바르지 않습니다.',
  'auth/missing-password': '접속 코드를 입력하세요.',
  'auth/too-many-requests': '시도가 너무 많습니다. 잠시 후 다시 시도하세요.',
  'auth/network-request-failed': '인터넷 연결을 확인하세요.',
  'auth/email-already-in-use': '이미 있는 계정입니다. 다시 시도하세요.',
  'auth/weak-password': '접속 코드는 6자 이상이어야 합니다.',
  'auth/requires-recent-login': '보안을 위해 다시 로그인한 뒤 시도하세요.',
  'permission-denied': '권한이 없습니다.',
  unavailable: '서버에 연결할 수 없습니다. 연결되면 자동으로 다시 시도합니다.',
};

export function errorMessage(err) {
  return AUTH_MESSAGES[err?.code] ? t(AUTH_MESSAGES[err.code]) : err?.message || String(err);
}
