import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { base64UrlEncode, base64UrlDecode, verifyIdToken, signServiceJwt } from '../src/google.js';
import { fromDocument } from '../src/firestore.js';
import worker, { notificationKey, notificationContent, pickTokens } from '../src/index.js';

const PROJECT = 'demo-family';
const enc = new TextEncoder();

const { publicKey, privateKey } = await crypto.subtle.generateKey(
  { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
  true, ['sign', 'verify'],
);
const jwk = { ...(await crypto.subtle.exportKey('jwk', publicKey)), kid: 'test-kid', alg: 'RS256', use: 'sig' };
const getKeys = async () => [jwk];

async function makeToken(overrides = {}, key = privateKey) {
  const now = Math.floor(Date.now() / 1000);
  const header = base64UrlEncode(JSON.stringify({ alg: 'RS256', kid: 'test-kid', typ: 'JWT' }));
  const payload = base64UrlEncode(JSON.stringify({
    aud: PROJECT, iss: `https://securetoken.google.com/${PROJECT}`, sub: 'user-1', iat: now - 10, exp: now + 3600, auth_time: now - 10,
    ...overrides,
  }));
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, enc.encode(`${header}.${payload}`));
  return `${header}.${payload}.${base64UrlEncode(sig)}`;
}

test('base64url 왕복', () => {
  const bytes = new Uint8Array([0, 255, 62, 63, 250, 1]);
  assert.deepEqual(base64UrlDecode(base64UrlEncode(bytes)), bytes);
  assert.equal(base64UrlEncode('한글'), Buffer.from('한글').toString('base64url'));
});

test('올바른 ID 토큰은 통과한다', async () => {
  const r = await verifyIdToken(await makeToken(), PROJECT, { getKeys });
  assert.equal(r.uid, 'user-1');
});

test('만료·다른 프로젝트·위조 토큰은 거부한다', async () => {
  const now = Math.floor(Date.now() / 1000);
  await assert.rejects(verifyIdToken(await makeToken({ exp: now - 3600 }), PROJECT, { getKeys }), /만료/);
  await assert.rejects(verifyIdToken(await makeToken({ aud: 'other' }), PROJECT, { getKeys }), /다른 프로젝트/);
  await assert.rejects(verifyIdToken(await makeToken({ iss: 'https://evil' }), PROJECT, { getKeys }), /발급자/);
  await assert.rejects(verifyIdToken(await makeToken({ sub: '' }), PROJECT, { getKeys }), /사용자/);
  const other = await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
  await assert.rejects(verifyIdToken(await makeToken({}, other.privateKey), PROJECT, { getKeys }), /서명/);
  // 내용을 바꾸면 서명이 깨진다
  const [h, , s] = (await makeToken()).split('.');
  const tampered = `${h}.${base64UrlEncode(JSON.stringify({ aud: PROJECT, iss: `https://securetoken.google.com/${PROJECT}`, sub: 'admin', iat: now, exp: now + 99 }))}.${s}`;
  await assert.rejects(verifyIdToken(tampered, PROJECT, { getKeys }), /서명/);
  await assert.rejects(verifyIdToken('not-a-token', PROJECT, { getKeys }), /형식/);
});

test('서비스 계정 JWT 서명', async () => {
  const pkcs8 = Buffer.from(await crypto.subtle.exportKey('pkcs8', privateKey)).toString('base64');
  const pem = `-----BEGIN PRIVATE KEY-----\n${pkcs8.match(/.{1,64}/g).join('\n')}\n-----END PRIVATE KEY-----\n`;
  const jwt = await signServiceJwt({ private_key: pem, client_email: 'sa@x.iam.gserviceaccount.com', private_key_id: 'k' });
  const [h, p, s] = jwt.split('.');
  assert.ok(await crypto.subtle.verify('RSASSA-PKCS1-v1_5', publicKey, base64UrlDecode(s), enc.encode(`${h}.${p}`)));
  assert.equal(JSON.parse(Buffer.from(p, 'base64url')).iss, 'sa@x.iam.gserviceaccount.com');
});

test('Firestore 문서 해석', () => {
  const d = fromDocument({
    name: 'projects/p/databases/(default)/documents/members/abc',
    updateTime: 't',
    fields: {
      name: { stringValue: '엄마' }, active: { booleanValue: true }, declareCredits: { integerValue: '1' },
      last: { mapValue: { fields: { lat: { doubleValue: 37.5 }, note: { nullValue: null } } } },
    },
  });
  assert.deepEqual(d, { id: 'abc', updateTime: 't', name: '엄마', active: true, declareCredits: 1, last: { lat: 37.5, note: null } });
});

test('알림은 비상 상태마다 다른 키를 가진다', () => {
  assert.equal(notificationKey(null), null);
  assert.equal(notificationKey({ active: true, declaredAt: 'T1' }), 'real:T1');
  assert.equal(notificationKey({ active: false, endedAt: 'T2' }), 'off:T2');
  assert.equal(notificationKey({ active: false }), null);
  assert.match(notificationContent({ active: true, type: 'earthquake', declaredByName: '아빠' }).title, /지진/);
  assert.match(notificationContent({ active: false, endedByName: '엄마' }).body, /엄마/);
});

test('2급 → 1급으로 바뀌면 알림 키와 내용이 달라지고, 1급만 긴급 알림이다', () => {
  const alert = { active: true, level: 'alert', type: 'war', declaredAt: 'T1', declaredByName: '아빠' };
  const real = { ...alert, level: 'real', realAt: 'T3', escalatedByName: '엄마' };
  assert.equal(notificationKey(alert), 'alert:T1');
  assert.equal(notificationKey(real), 'real:T3');
  assert.match(notificationContent(alert).title, /2급/);
  assert.match(notificationContent(real).title, /1급/);
  assert.equal(notificationContent(alert).urgent, false);
  assert.equal(notificationContent(real).urgent, true);
  assert.match(notificationContent({ active: true, type: 'disaster' }).title, /대형재난/);
  assert.match(notificationContent(real).body, /^엄마:/);
  assert.match(notificationContent({ active: true, type: 'tsunami' }).title, /지진해일/);
});

// ---------- 요청 처리 (Google API는 가짜로 대체) ----------

const ORIGIN = 'https://devmh1003.github.io';
let realFetch;
let calls;
let db;

function fsDoc(path, data) {
  const fields = {};
  for (const [k, v] of Object.entries(data)) {
    fields[k] = typeof v === 'boolean' ? { booleanValue: v } : typeof v === 'number' ? { integerValue: String(v) } : { stringValue: v };
  }
  return { name: `projects/${PROJECT}/databases/(default)/documents/${path}`, updateTime: '2026-10-27T00:00:00Z', fields };
}

beforeEach(async () => {
  realFetch = globalThis.fetch;
  calls = [];
  db = {
    'public/gates': { gen: 5 },
    'members/user-1': { name: '엄마', active: true, role: 'member', gen: 5 },
    'members/user-2': { name: '아빠', active: true, role: 'admin', gen: 5 },
    'members/legacy': { name: '예전 관리자', active: true, role: 'admin' },
    'emergency/current': { active: true, type: 'war', declaredAt: 'T1', declaredByName: '아빠' },
  };
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    calls.push({ url, method: init.method || 'GET', body: init.body });
    const ok = (data) => new Response(JSON.stringify(data), { status: 200, headers: { 'cache-control': 'max-age=60' } });
    if (url.includes('securetoken@system.gserviceaccount.com')) return ok({ keys: [jwk] });
    if (url === 'https://oauth2.googleapis.com/token') return ok({ access_token: 'at', expires_in: 3600 });
    if (url.startsWith('https://fcm.googleapis.com/')) return ok({ name: 'sent' });
    if (url.startsWith('https://identitytoolkit.googleapis.com/')) return ok({});
    const m = /documents\/([^?]+)/.exec(url);
    if (m) {
      const path = decodeURIComponent(m[1]);
      if ((init.method || 'GET') === 'PATCH' || init.method === 'POST') return ok({});
      if (path === 'pushTokens') return ok({ documents: [fsDoc('pushTokens/tok-a', { uid: 'user-1' }), fsDoc('pushTokens/tok-b', { uid: 'gone' })] });
      if (path === 'members') return ok({ documents: Object.entries(db).filter(([k]) => k.startsWith('members/')).map(([k, v]) => fsDoc(k, v)) });
      if (db[path]) return ok(fsDoc(path, db[path]));
      return new Response('{}', { status: 404 });
    }
    throw new Error(`unexpected fetch ${url}`);
  };
});

afterEach(() => { globalThis.fetch = realFetch; });

const pkcs8 = Buffer.from(await crypto.subtle.exportKey('pkcs8', privateKey)).toString('base64');
const env = {
  FIREBASE_PROJECT_ID: PROJECT,
  ALLOWED_ORIGINS: ORIGIN,
  APP_URL: 'https://devmh1003.github.io/emergency/',
  GOOGLE_SERVICE_ACCOUNT: JSON.stringify({
    client_email: 'sa@x.iam.gserviceaccount.com', private_key_id: 'k',
    private_key: `-----BEGIN PRIVATE KEY-----\n${pkcs8}\n-----END PRIVATE KEY-----`,
  }),
};

async function post(path, { token, origin = ORIGIN, body } = {}) {
  const headers = { Origin: origin, 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await worker.fetch(new Request(`https://w.example${path}`, { method: 'POST', headers, body: JSON.stringify(body || {}) }), env);
  return { status: res.status, data: await res.json(), headers: res.headers };
}

test('허용되지 않은 사이트에서 온 요청은 거부한다', async () => {
  const r = await post('/notify', { origin: 'https://evil.example', token: await makeToken() });
  assert.equal(r.status, 403);
  assert.equal(r.headers.get('Access-Control-Allow-Origin'), null);
});

test('로그인 토큰이 없으면 거부한다', async () => {
  const r = await post('/notify');
  assert.equal(r.status, 401);
});

test('등록되지 않은 사람은 거부한다', async () => {
  const r = await post('/notify', { token: await makeToken({ sub: 'stranger' }) });
  assert.equal(r.status, 403);
});

test('비상 알림은 활성 가족의 기기에만, 한 번만 보낸다', async () => {
  const r = await post('/notify', { token: await makeToken() });
  assert.equal(r.status, 200);
  assert.equal(r.data.sent, 1);
  const fcm = calls.filter((c) => c.url.startsWith('https://fcm.googleapis.com/'));
  assert.equal(fcm.length, 1);
  assert.equal(JSON.parse(fcm[0].body).message.token, 'tok-a');
  const patch = calls.find((c) => c.method === 'PATCH');
  assert.match(patch.url, /currentDocument.updateTime=/);
  // 관리자 기록에 발송 결과가 남는다
  const log = calls.find((c) => c.method === 'POST' && c.url.endsWith('/documents/auditLog'));
  const fields = JSON.parse(log.body).fields;
  assert.equal(fields.action.stringValue, 'notify.emergency');
  assert.equal(fields.by.stringValue, 'user-1');
  assert.match(fields.detail.stringValue, /1건 성공/);
  assert.ok(fields.at.timestampValue);

  db['emergency/current'].notifiedKey = 'real:T1';
  calls = [];
  const again = await post('/notify', { token: await makeToken() });
  assert.equal(again.data.sent, 0);
  assert.equal(calls.filter((c) => c.url.startsWith('https://fcm.googleapis.com/')).length, 0);
});

test('테스트 알람은 관리자만, 테스트마다 한 번만 보낸다', async () => {
  db['alarmTests/t1'] = { by: 'user-2', byName: '아빠', message: '훈련입니다' };
  assert.equal((await post('/drill', { token: await makeToken(), body: { id: 't1' } })).status, 403);
  const admin = await makeToken({ sub: 'user-2' });
  assert.equal((await post('/drill', { token: admin, body: { id: '../x' } })).status, 400);
  assert.equal((await post('/drill', { token: admin, body: { id: 'none' } })).status, 404);
  calls = [];
  const r = await post('/drill', { token: admin, body: { id: 't1' } });
  assert.equal(r.status, 200);
  assert.equal(r.data.sent, 1);
  const fcm = calls.filter((c) => c.url.startsWith('https://fcm.googleapis.com/'));
  const msg = JSON.parse(fcm[0].body).message;
  assert.match(msg.notification.title, /테스트/);
  assert.equal(msg.data.kind, 'test');
  // 소리 지정이 없으면 1급 테스트: 닫을 때까지 화면에 남는다
  assert.equal(msg.webpush.notification.requireInteraction, true);
  const log = calls.find((c) => c.method === 'POST' && c.url.endsWith('/documents/auditLog'));
  assert.equal(JSON.parse(log.body).fields.action.stringValue, 'notify.drill');

  db['alarmTests/t1'].notifiedKey = 'sent';
  calls = [];
  const again = await post('/drill', { token: admin, body: { id: 't1' } });
  assert.equal(again.data.sent, 0);
  assert.equal(calls.filter((c) => c.url.startsWith('https://fcm.googleapis.com/')).length, 0);
});

test('예전 방식(세대가 다른) 계정은 Worker를 쓸 수 없다', async () => {
  const r = await post('/notify', { token: await makeToken({ sub: 'legacy' }) });
  assert.equal(r.status, 403);
});

test('사람마다 최근 기기 2대에만 보낸다 (토큰을 잔뜩 등록해 발송을 막을 수 없다)', () => {
  const junk = Array.from({ length: 60 }, (_, i) => ({ id: `junk-${i}`, uid: 'spammer', at: `2026-10-27T00:00:${String(i).padStart(2, '0')}Z` }));
  const picked = pickTokens([...junk, { id: 'mom-phone', uid: 'mom', at: '2026-10-01T00:00:00Z' }]);
  assert.equal(picked.filter((t) => t.uid === 'spammer').length, 2);
  assert.ok(picked.some((t) => t.id === 'mom-phone'));
  assert.deepEqual(picked.filter((t) => t.uid === 'spammer').map((t) => t.id), ['junk-59', 'junk-58']);
});

test('일반 가족은 관리자 작업을 할 수 없다', async () => {
  const r = await post('/admin/user', { token: await makeToken(), body: { action: 'delete', uid: 'user-2' } });
  assert.equal(r.status, 403);
});

test('관리자는 비밀번호를 초기화할 수 있고, 짧은 비밀번호는 거부된다', async () => {
  const admin = await makeToken({ sub: 'user-2' });
  assert.equal((await post('/admin/user', { token: admin, body: { action: 'setPassword', uid: 'user-1', password: 'short' } })).status, 400);
  const ok = await post('/admin/user', { token: admin, body: { action: 'setPassword', uid: 'user-1', password: 'long-enough-pw' } });
  assert.equal(ok.status, 200);
  assert.equal((await post('/admin/user', { token: admin, body: { action: 'delete', uid: 'user-2' } })).status, 400);
});
