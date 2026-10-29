// 접속 코드 확인과 잠금.
// 접속 코드 3가지(가족·관리자·백업)는 각각 "관문 계정"의 비밀번호다. 예전에는 사이트가 Firebase에 직접 코드를 넣어 봤는데,
// 그러면 횟수를 막을 수 없어서 이제는 알림 서버가 확인한다:
//   - 관문 계정의 이메일은 어디에도 공개하지 않는다 (알림 서버가 uid로 찾는다). 그래서 Firebase에 직접 넣어 볼 수 없다.
//   - 같은 인터넷 주소나 같은 기기에서 3번 틀리면 하루 동안 막는다. 관리자는 관리자 설정에서 잠금을 풀 수 있다.
//   - 맞으면 그 관문 계정의 맞춤 토큰을 돌려주고, 사이트는 그 토큰으로 로그인해 이름 목록을 본다.

export const GATE_KINDS = ['family', 'admin', 'backup'];
export const MAX_FAILS = 3;
export const LOCK_MS = 24 * 3600e3;
export const LOCKS = 'loginLocks';

const enc = new TextEncoder();

async function sha256Hex(s) {
  const buf = await crypto.subtle.digest('SHA-256', enc.encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** 관리자 화면에 보여 줄 인터넷 주소 앞부분 ("211.234.*.*", IPv6는 앞 두 묶음) */
export function maskIp(ip) {
  if (/^\d+\.\d+\.\d+\.\d+$/.test(ip)) return ip.split('.').slice(0, 2).join('.') + '.*.*';
  if (ip.includes(':')) return ip.split(':').slice(0, 2).join(':') + ':…';
  return '알 수 없음';
}

/** 잠금을 셀 단위: 인터넷 주소, 그리고 사이트가 보낸 기기 id (있으면). 문서 id 에는 원래 값 대신 해시를 쓴다. */
export async function lockKeys(projectId, ip, device) {
  const keys = [{ id: `ip-${(await sha256Hex(`${projectId}:ip:${ip}`)).slice(0, 32)}`, kind: 'ip', label: maskIp(ip) }];
  if (typeof device === 'string' && /^[a-z0-9]{16,40}$/.test(device)) {
    keys.push({ id: `dev-${(await sha256Hex(`${projectId}:dev:${device}`)).slice(0, 32)}`, kind: 'device', label: `${device.slice(0, 4)}…` });
  }
  return keys;
}

const ms = (v) => (v instanceof Date ? v.getTime() : Date.parse(v || ''));

/** 지금 잠겨 있으면 풀리는 시각(밀리초), 아니면 0 */
export function lockedUntil(doc, now) {
  const until = ms(doc?.lockedUntil);
  return Number.isFinite(until) && until > now ? until : 0;
}

/**
 * 이번 시도를 실패 하나로 미리 센 문서 (코드를 확인하기 전에 먼저 저장한다. 동시에 여러 번 보내 횟수를 넘기지 못하게).
 * 코드가 맞으면 잠금 문서를 지운다. 3번째 시도면 미리 잠가 둔다.
 */
export function countAttempt(doc, key, now) {
  const first = ms(doc?.firstFailAt);
  // 처음 틀렸거나, 첫 실패가 하루 넘게 지났거나, 잠금이 풀린 뒤면 새로 센다.
  const lockOver = Number.isFinite(ms(doc?.lockedUntil)) && !lockedUntil(doc, now);
  const fresh = !Number.isFinite(first) || now - first > LOCK_MS || lockOver;
  const fails = (fresh ? 0 : Number(doc?.fails) || 0) + 1;
  return {
    kind: key.kind,
    label: key.label,
    fails,
    firstFailAt: new Date(fresh ? now : first),
    lastAt: new Date(now),
    lockedUntil: fails >= MAX_FAILS ? new Date(now + LOCK_MS) : null,
  };
}

/** 관문 계정의 이메일을 uid로 찾는다 (관리자 API). */
export async function lookupEmails(projectId, accessToken, uids, fetchImpl = fetch) {
  const res = await fetchImpl(`https://identitytoolkit.googleapis.com/v1/projects/${projectId}/accounts:lookup`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ localId: uids }),
  });
  if (!res.ok) throw new Error(`계정 조회 실패 (${res.status})`);
  const data = await res.json();
  return new Map((data.users || []).map((u) => [u.localId, u.email]));
}

/** 관리자 API로 계정 하나를 바꾼다 (이메일 또는 비밀번호). */
export async function updateAccount(projectId, accessToken, payload, fetchImpl = fetch) {
  const res = await fetchImpl(`https://identitytoolkit.googleapis.com/v1/projects/${projectId}/accounts:update`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return res.ok;
}

/**
 * 이 이메일·비밀번호가 맞는가. 'ok' | 'wrong' | 'unavailable'(Firebase가 잠시 막았거나 연결이 안 됨 — 실패로 세지 않는다)
 * Firebase 웹 API 키가 필요하다 (사이트의 config.js 에 있는 공개 값과 같다).
 */
export async function passwordWorks(apiKey, email, password, referer, fetchImpl = fetch) {
  if (!email) return 'wrong';
  let res;
  try {
    res = await fetchImpl(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${encodeURIComponent(apiKey)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(referer ? { Referer: referer } : {}) },
      body: JSON.stringify({ email, password, returnSecureToken: false }),
    });
  } catch {
    return 'unavailable';
  }
  if (res.ok) return 'ok';
  const err = await res.json().catch(() => ({}));
  const msg = String(err?.error?.message || '');
  if (res.status >= 500 || /TOO_MANY_ATTEMPTS|QUOTA|API_KEY|PERMISSION_DENIED/.test(msg)) return 'unavailable';
  return 'wrong';
}

/** 추측할 수 없는 이메일 (메일이 오가지 않는 내부 주소) */
export function hiddenEmail(prefix, projectId) {
  const chars = 'abcdefghijkmnpqrstuvwxyz23456789';
  const id = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => chars[b % chars.length]).join('');
  return `${prefix}-${id}@${projectId}.firebaseapp.com`;
}

/** 사람 계정의 새 로그인 열쇠 (사이트의 randomToken 과 같은 모양) */
export function randomKey(length = 28) {
  const chars = 'abcdefghijkmnpqrstuvwxyz23456789';
  return Array.from(crypto.getRandomValues(new Uint8Array(length)), (b) => chars[b % chars.length]).join('');
}
