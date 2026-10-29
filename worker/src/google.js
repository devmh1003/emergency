// Google 서비스 호출에 필요한 인증. 외부 라이브러리 없이 Web Crypto만 쓴다.
//  - verifyIdToken: 사이트에서 보낸 Firebase 로그인 토큰이 진짜인지 확인
//  - getAccessToken: 서비스 계정으로 Google API 접근 토큰 발급

const enc = new TextEncoder();

export function base64UrlEncode(input) {
  const bytes = typeof input === 'string' ? enc.encode(input) : new Uint8Array(input);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function base64UrlDecode(str) {
  const b64 = str.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (str.length % 4)) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function decodeJson(part) {
  return JSON.parse(new TextDecoder().decode(base64UrlDecode(part)));
}

// ---------- Firebase ID 토큰 검증 ----------

const JWKS_URL = 'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';
let jwksCache = { keys: null, expires: 0 };

export async function fetchFirebaseJwks(fetchImpl = fetch) {
  if (jwksCache.keys && Date.now() < jwksCache.expires) return jwksCache.keys;
  const res = await fetchImpl(JWKS_URL);
  if (!res.ok) throw new Error('Google 공개키를 가져오지 못했습니다');
  const { keys } = await res.json();
  const maxAge = Number(/max-age=(\d+)/.exec(res.headers.get('cache-control') || '')?.[1] || 3600);
  jwksCache = { keys, expires: Date.now() + maxAge * 1000 };
  return keys;
}

/**
 * Firebase ID 토큰 검증 (https://firebase.google.com/docs/auth/admin/verify-id-tokens#verify_id_tokens_using_a_third-party_jwt_library)
 * @returns {Promise<{uid:string, email?:string}>}
 */
export async function verifyIdToken(token, projectId, { getKeys = fetchFirebaseJwks, now = Date.now() } = {}) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) throw new AuthError('토큰 형식이 잘못됐습니다');
  const [h, p, s] = parts;
  const header = decodeJson(h);
  const payload = decodeJson(p);
  if (header.alg !== 'RS256') throw new AuthError('지원하지 않는 서명 방식입니다');

  const keys = await getKeys();
  const jwk = keys.find((k) => k.kid === header.kid);
  if (!jwk) throw new AuthError('알 수 없는 서명 키입니다');
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, base64UrlDecode(s), enc.encode(`${h}.${p}`));
  if (!ok) throw new AuthError('서명이 올바르지 않습니다');

  const sec = Math.floor(now / 1000);
  const skew = 60;
  if (payload.aud !== projectId) throw new AuthError('다른 프로젝트의 토큰입니다');
  if (payload.iss !== `https://securetoken.google.com/${projectId}`) throw new AuthError('발급자가 올바르지 않습니다');
  if (typeof payload.sub !== 'string' || !payload.sub || payload.sub.length > 128) throw new AuthError('사용자 정보가 없습니다');
  if (!(payload.exp > sec - skew)) throw new AuthError('토큰이 만료됐습니다. 다시 시도하세요');
  if (!(payload.iat <= sec + skew)) throw new AuthError('토큰 발급 시각이 올바르지 않습니다');
  if (payload.auth_time && payload.auth_time > sec + skew) throw new AuthError('로그인 시각이 올바르지 않습니다');
  return { uid: payload.sub, email: payload.email };
}

export class AuthError extends Error {
  constructor(message) {
    super(message);
    this.status = 401;
  }
}

// ---------- 서비스 계정 접근 토큰 ----------

// 실제 권한은 서비스 계정에 준 IAM 역할로 제한한다 (README 참고).
const SCOPES = [
  'https://www.googleapis.com/auth/cloud-platform',
  'https://www.googleapis.com/auth/datastore',
  'https://www.googleapis.com/auth/firebase.messaging',
  'https://www.googleapis.com/auth/identitytoolkit',
].join(' ');

let tokenCache = { token: null, expires: 0 };

function pemToPkcs8(pem) {
  const body = pem.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
  return base64UrlDecode(body.replace(/\+/g, '-').replace(/\//g, '_'));
}

export async function signServiceJwt(sa, now = Date.now()) {
  const iat = Math.floor(now / 1000);
  const header = base64UrlEncode(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid: sa.private_key_id }));
  const claims = base64UrlEncode(JSON.stringify({
    iss: sa.client_email,
    scope: SCOPES,
    aud: 'https://oauth2.googleapis.com/token',
    iat,
    exp: iat + 3600,
  }));
  const key = await crypto.subtle.importKey('pkcs8', pemToPkcs8(sa.private_key), { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, enc.encode(`${header}.${claims}`));
  return `${header}.${claims}.${base64UrlEncode(sig)}`;
}

/** Firebase 맞춤 토큰: 사이트가 이 토큰으로 그 계정에 로그인한다 (접속 코드는 알림 서버가 확인). */
export async function createCustomToken(sa, uid, now = Date.now()) {
  const iat = Math.floor(now / 1000);
  const header = base64UrlEncode(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid: sa.private_key_id }));
  const claims = base64UrlEncode(JSON.stringify({
    iss: sa.client_email,
    sub: sa.client_email,
    aud: 'https://identitytoolkit.googleapis.com/google.identity.identitytoolkit.v1.IdentityToolkit',
    iat,
    exp: iat + 3600,
    uid,
  }));
  const key = await crypto.subtle.importKey('pkcs8', pemToPkcs8(sa.private_key), { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, enc.encode(`${header}.${claims}`));
  return `${header}.${claims}.${base64UrlEncode(sig)}`;
}

export async function getAccessToken(sa) {
  if (tokenCache.token && Date.now() < tokenCache.expires) return tokenCache.token;
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: await signServiceJwt(sa),
    }),
  });
  if (!res.ok) throw new Error(`Google 접근 토큰 발급 실패 (${res.status})`);
  const data = await res.json();
  tokenCache = { token: data.access_token, expires: Date.now() + (data.expires_in - 120) * 1000 };
  return tokenCache.token;
}
