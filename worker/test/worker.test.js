import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { base64UrlEncode, base64UrlDecode, verifyIdToken, signServiceJwt } from '../src/google.js';
import { fromDocument } from '../src/firestore.js';
import worker, { notificationKey, notificationContent, pickTokens, pushMessage, alarmAck, checkDisasterMessages } from '../src/index.js';
import {
  classifyMessage, disasterSettings, regionMatches, pickHit, parseKst, kstDate, fetchDisasterMessages,
} from '../src/disaster.js';

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

  // 받을 사람을 골랐으면 그 사람의 기기에만 보낸다
  db['alarmTests/t2'] = { by: 'user-2', byName: '아빠', message: '훈련', targets: ['someone-else'] };
  calls = [];
  assert.equal((await post('/drill', { token: admin, body: { id: 't2' } })).data.sent, 0);
  db['alarmTests/t3'] = { by: 'user-2', byName: '아빠', message: '훈련', targets: ['user-1'] };
  assert.equal((await post('/drill', { token: admin, body: { id: 't3' } })).data.sent, 1);
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

test('안드로이드 앱 기기에는 데이터 메시지로 보내고, 확인 키는 사이트 형식과 같다', () => {
  const at = '2026-10-27T13:07:12.345678Z';
  const real = { active: true, level: 'real', type: 'earthquake', declaredAt: at, realAt: at, declaredByName: '아빠' };
  assert.equal(alarmAck(real), `real:${Date.UTC(2026, 9, 27, 13, 7, 12, 345)}`);
  const app = pushMessage({}, { id: 'tok-app', platform: 'Mozilla/5.0 (Linux; Android 14) FamilyEmergencyApp/1.0' }, notificationContent(real));
  assert.equal(app.notification, undefined);
  assert.equal(app.android.priority, 'HIGH');
  assert.equal(app.data.kind, 'emergency');
  assert.equal(app.data.level, 'real');
  assert.equal(app.data.ack, alarmAck(real));
  assert.ok(Object.values(app.data).every((v) => typeof v === 'string'));
  // 2급은 앱에서도 보통 알림
  const alertMsg = pushMessage({}, { id: 'tok-app', platform: 'FamilyEmergencyApp/1.0' }, notificationContent({ ...real, level: 'alert' }));
  assert.equal(alertMsg.data.level, 'alert');
  // 웹 브라우저 기기는 그대로 웹 푸시
  const web = pushMessage({ APP_URL: 'https://example.test/' }, { id: 'tok-web', platform: 'Mozilla/5.0 Chrome' }, notificationContent(real));
  assert.equal(web.notification.title, notificationContent(real).title);
  assert.equal(web.webpush.notification.requireInteraction, true);
});

// ---------- 정부 긴급재난문자 ----------

const ALL = disasterSettings(null);
const msg = (o = {}) => ({
  SN: 100, CRT_DT: '2026/10/29 12:00:00', EMRG_STEP_NM: '긴급재난', DST_SE_NM: '지진',
  RCPTN_RGN_NM: '서울특별시 전체 ,경기도 전체 ', MSG_CN: '[기상청] 경북 경주시 규모4.3 지진발생/낙하물 주의', ...o,
});
const NOON = parseKst('2026/10/29 12:00:00');

test('재난문자 시각은 한국 시각으로 읽는다', () => {
  assert.equal(new Date(NOON).toISOString(), '2026-10-29T03:00:00.000Z');
  assert.equal(kstDate(Date.parse('2026-10-28T15:30:00Z')), '20261029');
});

test('위급재난과 지진·지진해일·민방공만 1급, 안전안내·훈련·해제로는 울리지 않는다', () => {
  assert.equal(classifyMessage(msg(), ALL).level, 'real');
  assert.equal(classifyMessage(msg(), ALL).type, 'earthquake');
  assert.equal(classifyMessage(msg({ EMRG_STEP_NM: '위급재난', DST_SE_NM: '민방공', MSG_CN: '공습경보 발령. 지하 대피소로 대피하십시오' }), ALL).type, 'war');
  assert.equal(classifyMessage(msg({ EMRG_STEP_NM: '위급재난', DST_SE_NM: '산사태', MSG_CN: '즉시 대피' }), ALL).level, 'real');
  assert.equal(classifyMessage(msg({ DST_SE_NM: '지진해일' }), ALL).type, 'tsunami');
  assert.equal(classifyMessage(msg({ EMRG_STEP_NM: '안전안내' }), ALL), null);
  // 그 밖의 긴급재난은 2급 알림을 켰을 때만
  const rain = msg({ DST_SE_NM: '호우', MSG_CN: '시간당 50mm 강한 비' });
  assert.equal(classifyMessage(rain, ALL), null);
  const lv2 = classifyMessage(rain, disasterSettings({ level2: true }));
  assert.deepEqual([lv2.level, lv2.type], ['alert', 'flood']);
  // 훈련 안내, 해제·복귀 안내
  assert.equal(classifyMessage(msg({ MSG_CN: '금일 보라매병원 일대에서 실제 재난상황을 가정한 안전한국훈련을 실시합니다' }), ALL), null);
  assert.equal(classifyMessage(msg({ EMRG_STEP_NM: '위급재난', DST_SE_NM: '민방공', MSG_CN: '경계경보 해제' }), ALL), null);
  assert.equal(classifyMessage(msg({ EMRG_STEP_NM: '위급재난', DST_SE_NM: '민방공', MSG_CN: '위험범위 이탈, 주민들은 일상으로 복귀 바랍니다' }), ALL), null);
  assert.equal(classifyMessage(msg({ MSG_CN: '이것은 훈련이 아닙니다. 실제 상황입니다' }), ALL).level, 'real');
});

test('지역: 비우면 전국, 줄임말과 시·군·구까지 맞춘다', () => {
  assert.equal(regionMatches('인천광역시 옹진군 백령면', []), true);
  assert.equal(regionMatches('인천광역시 옹진군 백령면', ['서울']), false);
  assert.equal(regionMatches('서울특별시 광진구 ', ['서울']), true);
  assert.equal(regionMatches('경기도 전체 ,강원특별자치도 전체 ', ['경기 수원']), true);
  assert.equal(regionMatches('경기도 수원시 장안구', ['경기도 수원시']), true);
  assert.equal(regionMatches('경기도 성남시 분당구', ['경기 수원']), false);
  assert.equal(regionMatches('경상북도 경주시', ['경북']), true);
  assert.equal(regionMatches('경상남도 전체 ', ['경북']), false);
  assert.equal(classifyMessage(msg({ RCPTN_RGN_NM: '부산광역시 전체 ' }), disasterSettings({ regions: ['서울'] })), null);
  assert.equal(disasterSettings({ enabled: false }).enabled, false);
});

test('새 문자 중 30분 안의 것만, 1급을 먼저 고른다', () => {
  const items = [
    msg({ SN: 99 }),
    msg({ SN: 101, DST_SE_NM: '호우', MSG_CN: '강한 비' }),
    msg({ SN: 102, CRT_DT: '2026/10/29 11:00:00' }),
    msg({ SN: 103 }),
  ];
  const lv2 = disasterSettings({ level2: true });
  assert.equal(pickHit(items, 100, NOON + 60e3, lv2).sn, 103);
  assert.equal(pickHit(items, 103, NOON + 60e3, lv2), null);
  assert.equal(pickHit(items.slice(0, 2), 100, NOON + 60e3, lv2).level, 'alert');
  assert.equal(pickHit(items, 100, NOON + 31 * 60e3, lv2), null);
});

test('재난문자 조회: 키가 틀리면 오류, 많으면 마지막 쪽까지 읽는다', async () => {
  const urls = [];
  const fake = (pages) => async (url) => {
    urls.push(url);
    const p = Number(new URL(url).searchParams.get('pageNo'));
    return new Response(JSON.stringify({ header: { resultCode: '00' }, totalCount: pages * 1000 - 10, body: [{ SN: p }] }));
  };
  assert.deepEqual((await fetchDisasterMessages('k', NOON, fake(1))).map((m) => m.SN), [1]);
  assert.match(urls[0], /serviceKey=k/);
  assert.match(urls[0], /crtDt=20261029/);
  assert.deepEqual((await fetchDisasterMessages('k', NOON, fake(3))).map((m) => m.SN), [2, 3]);
  const bad = async () => new Response(JSON.stringify({ header: { resultCode: '30', errorMsg: '등록되지 않은 서비스키' } }));
  await assert.rejects(fetchDisasterMessages('bad', NOON, bad), /서비스키/);
});

function disasterFetch({ emergency = null, settings = null, feed = null, items = [], commitOk = true } = {}) {
  const docs = { 'config/disasterAlerts': settings, 'config/disasterFeed': feed, 'emergency/current': emergency };
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    calls.push({ url, method: init.method || 'GET', body: init.body });
    const ok = (data) => new Response(JSON.stringify(data), { status: 200 });
    if (url === 'https://oauth2.googleapis.com/token') return ok({ access_token: 'at', expires_in: 3600 });
    if (url.startsWith('https://www.safetydata.go.kr/')) return ok({ header: { resultCode: '00' }, totalCount: items.length, body: items });
    if (url.startsWith('https://fcm.googleapis.com/')) return ok({ name: 'sent' });
    if (url.endsWith('/documents:batchGet')) {
      return ok(JSON.parse(init.body).documents.map((name) => {
        const path = name.split('/documents/')[1];
        return docs[path] ? { found: fsDoc(path, docs[path]) } : { missing: name };
      }));
    }
    if (url.endsWith('/documents:commit')) return commitOk ? ok({}) : new Response('{}', { status: 409 });
    if (url.includes('/documents/members')) return ok({ documents: [fsDoc('members/user-1', { active: true })] });
    if (url.includes('/documents/pushTokens')) {
      return ok({ documents: [fsDoc('pushTokens/tok-a', { uid: 'user-1', platform: 'Android FamilyEmergencyApp/1.1' })] });
    }
    if (init.method === 'POST' && url.endsWith('/documents/auditLog')) return ok({});
    throw new Error(`unexpected fetch ${url}`);
  };
}

const commits = () => calls.filter((c) => c.url.endsWith('/documents:commit')).map((c) => JSON.parse(c.body).writes);
const fcmCalls = () => calls.filter((c) => c.url.startsWith('https://fcm.googleapis.com/'));
const denv = { ...env, SAFETY_DATA_KEY: 'test-key' };

test('지진 재난문자가 오면 1급 비상을 자동 선언하고 앱에 전체 화면 경보를 보낸다', async () => {
  disasterFetch({ items: [msg({ SN: 500 })] });
  const r = await checkDisasterMessages(denv, NOON + 60e3);
  assert.equal(r.action, 'declare');
  assert.equal(r.sent, 1);
  const [declare, state] = commits();
  const em = declare[0];
  assert.match(em.update.name, /emergency\/current$/);
  assert.deepEqual(em.currentDocument, { exists: false });
  assert.equal(em.update.fields.level.stringValue, 'real');
  assert.equal(em.update.fields.type.stringValue, 'earthquake');
  assert.equal(em.update.fields.declaredByName.stringValue, '정부 재난문자');
  assert.equal(em.update.fields.declaredAt.timestampValue, '2026-10-29T03:01:00Z');
  assert.equal(em.update.fields.notifiedKey.stringValue, 'real:2026-10-29T03:01:00Z');
  assert.ok(em.updateMask.fieldPaths.includes('escalatedBy'));
  assert.equal(declare[1].update.fields.action.stringValue, 'declare');
  // 앱에는 1급 데이터 메시지
  const push = JSON.parse(fcmCalls()[0].body).message;
  assert.equal(push.data.level, 'real');
  assert.match(push.data.title, /1급 비상: 지진/);
  assert.match(push.data.body, /^정부 재난문자: \[기상청\]/);
  assert.equal(push.data.ack, `real:${Date.parse('2026-10-29T03:01:00Z')}`);
  // 확인 상태
  const f = state[0].update.fields;
  assert.equal(f.lastSn.integerValue, '500');
  assert.equal(f.lastHitAction.stringValue, 'declare');
  assert.equal(f.error.stringValue, '');
});

test('이미 1급 비상 중이면 다시 선언하지 않고, 2급 중이면 1급으로 격상한다', async () => {
  disasterFetch({ items: [msg({ SN: 500 })], emergency: { active: true, level: 'real', declaredAt: 'T1' } });
  assert.equal((await checkDisasterMessages(denv, NOON + 60e3)).action, 'skip');
  assert.equal(commits().length, 1);
  assert.equal(fcmCalls().length, 0);

  calls = [];
  disasterFetch({ items: [msg({ SN: 500 })], emergency: { active: true, level: 'alert', type: 'flood', declaredAt: '2026-10-29T02:00:00Z' } });
  const r = await checkDisasterMessages(denv, NOON + 60e3);
  assert.equal(r.action, 'escalate');
  const em = commits()[0][0];
  assert.equal(em.currentDocument.updateTime, '2026-10-27T00:00:00Z');
  assert.deepEqual(em.updateMask.fieldPaths.sort(), ['escalatedBy', 'escalatedByName', 'level', 'message', 'notifiedKey', 'realAt']);
  assert.equal(em.update.fields.notifiedKey.stringValue, 'real:2026-10-29T03:01:00Z');
});

test('이미 본 문자, 꺼 둔 설정, 키가 없을 때는 울리지 않는다', async () => {
  disasterFetch({ items: [msg({ SN: 500 })], feed: { lastSn: 500 } });
  assert.equal((await checkDisasterMessages(denv, NOON + 60e3)).hit, null);
  assert.equal(commits().length, 1);

  calls = [];
  disasterFetch({ items: [msg({ SN: 501 })], settings: { enabled: false } });
  assert.equal((await checkDisasterMessages(denv, NOON + 60e3)).skipped, '꺼짐');
  assert.equal(calls.some((c) => c.url.includes('safetydata')), false);

  calls = [];
  assert.equal((await checkDisasterMessages(env, NOON)).skipped, '설정 없음');
  assert.equal(calls.length, 0);
});

test('그 사이 비상 문서가 바뀌면 이번 문자를 다음 확인 때 다시 본다', async () => {
  disasterFetch({ items: [msg({ SN: 500 })], feed: { lastSn: 400 }, commitOk: false });
  const r = await checkDisasterMessages(denv, NOON + 60e3);
  assert.equal(r.action, 'retry');
  assert.equal(fcmCalls().length, 0);
  const state = commits().at(-1)[0].update.fields;
  assert.equal(state.lastSn.integerValue, '400');
});
