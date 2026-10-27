// Firebase 초기화. SDK는 gstatic CDN에서 버전을 고정해 불러오고, 서비스 워커가 휴대폰에 저장해 둔다.
import { initializeApp, deleteApp } from 'https://www.gstatic.com/firebasejs/13.0.0/firebase-app.js';
import {
  initializeAuth, indexedDBLocalPersistence, browserLocalPersistence, inMemoryPersistence,
  connectAuthEmulator, onAuthStateChanged, signInWithEmailAndPassword, signOut,
  createUserWithEmailAndPassword, updatePassword, EmailAuthProvider, reauthenticateWithCredential,
  sendPasswordResetEmail,
} from 'https://www.gstatic.com/firebasejs/13.0.0/firebase-auth.js';
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

export function login(email, password) {
  return signInWithEmailAndPassword(auth, email.trim(), password);
}

export function logout() {
  return signOut(auth);
}

export function resetPasswordEmail(email) {
  return sendPasswordResetEmail(auth, email.trim());
}

export async function changePassword(currentPassword, newPassword) {
  const user = auth.currentUser;
  await reauthenticateWithCredential(user, EmailAuthProvider.credential(user.email, currentPassword));
  await updatePassword(user, newPassword);
}

/** 첫 관리자가 스스로 계정을 만든다 (초기 설정 화면에서만 쓴다). */
export function createOwnAccount(email, password) {
  return createUserWithEmailAndPassword(auth, email.trim(), password);
}

/**
 * 관리자가 가족 계정을 만든다.
 * 같은 앱 인스턴스로 만들면 관리자가 새 계정으로 로그인돼 버리므로, 잠깐 쓰는 별도 인스턴스를 만든다.
 */
export async function createAccountForOther(email, password) {
  const secondary = initializeApp(config.firebase, `create-${Date.now()}`);
  try {
    const secondaryAuth = initializeAuth(secondary, { persistence: inMemoryPersistence });
    if (useEmulators) connectAuthEmulator(secondaryAuth, 'http://127.0.0.1:9099', { disableWarnings: true });
    const cred = await createUserWithEmailAndPassword(secondaryAuth, email.trim(), password);
    const uid = cred.user.uid;
    await signOut(secondaryAuth);
    return uid;
  } finally {
    await deleteApp(secondary);
  }
}

/** Cloudflare Worker 호출. 로그인한 사용자의 ID 토큰으로 본인임을 증명한다. */
export async function callWorker(path, body = {}) {
  if (!config.workerUrl) throw new Error('알림 서버(Worker) 주소가 설정되지 않았습니다.');
  const token = await auth.currentUser.getIdToken();
  const res = await fetch(config.workerUrl.replace(/\/$/, '') + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `서버 오류 (${res.status})`);
  return data;
}

const AUTH_MESSAGES = {
  'auth/invalid-credential': '이메일 또는 비밀번호가 맞지 않습니다.',
  'auth/wrong-password': '비밀번호가 맞지 않습니다.',
  'auth/user-not-found': '등록되지 않은 이메일입니다.',
  'auth/invalid-email': '이메일 형식이 올바르지 않습니다.',
  'auth/too-many-requests': '시도가 너무 많습니다. 잠시 후 다시 시도하세요.',
  'auth/network-request-failed': '인터넷 연결을 확인하세요.',
  'auth/email-already-in-use': '이미 사용 중인 이메일입니다.',
  'auth/weak-password': '비밀번호는 6자 이상이어야 합니다.',
  'auth/requires-recent-login': '보안을 위해 다시 로그인한 뒤 시도하세요.',
  'permission-denied': '권한이 없습니다.',
  unavailable: '서버에 연결할 수 없습니다. 연결되면 자동으로 다시 시도합니다.',
};

export function errorMessage(err) {
  return AUTH_MESSAGES[err?.code] || err?.message || String(err);
}
