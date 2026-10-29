import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { base64UrlEncode, base64UrlDecode, verifyIdToken, signServiceJwt } from '../src/google.js';
import { fromDocument, toFields } from '../src/firestore.js';
import worker, {
  notificationKey, notificationContent, pickTokens, pushMessage, alarmAck, checkDisasterMessages, helpRecipients, helpContent,
} from '../src/index.js';
import { countAttempt, lockedUntil, maskIp } from '../src/login.js';
import {
  classifyMessage, disasterSettings, regionMatches, pickHit, parseKst, kstDate, fetchDisasterMessages, shouldCheck, DAILY_BUDGET,
  recentMessages,
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
    if (url.endsWith('/documents:batchGet')) {
      return ok(JSON.parse(init.body).documents.map((name) => {
        const path = name.split('/documents/')[1];
        return db[path] ? { found: fsDoc(path, db[path]) } : { missing: name };
      }));
    }
    if (url.endsWith('/documents:commit')) return ok({});
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

function disasterFetch({ emergency = null, settings = null, feed = null, recent = null, items = [], commitOk = true } = {}) {
  const docs = {
    'config/disasterAlerts': settings, 'config/disasterFeed': feed, 'config/disasterRecent': recent, 'emergency/current': emergency, 'public/gates': { gen: 5 },
  };
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
    if (url.includes('/documents/members')) return ok({ documents: [fsDoc('members/user-1', { active: true, gen: 5 })] });
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

test('하루 호출 한도: 남은 횟수를 자정까지 나눠 1~2분마다, 급할 때는 1분마다, 한도를 넘지 않는다', () => {
  const midnight = parseKst('2026/10/29 00:00:00');
  const day = kstDate(midnight);
  // 자정 직후: 1440분 / 940번 → 2분마다
  assert.equal(shouldCheck({ callsDay: day, calls: 0, lastCallAt: new Date(midnight - 60e3).toISOString() }, midnight, false).check, false);
  assert.equal(shouldCheck({ callsDay: day, calls: 0, lastCallAt: new Date(midnight - 120e3).toISOString() }, midnight, false).every, 2);
  assert.equal(shouldCheck({ callsDay: day, calls: 0, lastCallAt: new Date(midnight - 60e3).toISOString() }, midnight, true).check, true);
  assert.deepEqual(shouldCheck({ callsDay: day, calls: DAILY_BUDGET }, midnight + 3600e3, true), { check: false, used: DAILY_BUDGET, every: 0 });
  // 날짜가 바뀌면 새로 센다
  assert.equal(shouldCheck({ callsDay: '20261028', calls: DAILY_BUDGET }, midnight, false).used, 0);

  // 하루를 1분씩 흘려 본다: 평소에도, 하루 종일 급해도 한도 안이고, 확인 간격은 2분을 넘지 않는다.
  for (const urgent of [false, true]) {
    let state = null;
    let gap = 0;
    let maxGap = 0;
    for (let i = 0; i < 1440; i++) {
      const now = midnight + i * 60e3;
      const plan = shouldCheck(state, now, urgent);
      gap++;
      if (plan.check) {
        maxGap = Math.max(maxGap, gap);
        gap = 0;
        state = { callsDay: kstDate(now), calls: plan.used + 1, lastCallAt: new Date(now).toISOString() };
      }
    }
    assert.ok(state.calls <= DAILY_BUDGET, `${urgent}: ${state.calls}`);
    assert.ok(state.calls >= 700, `${urgent}: ${state.calls}`);
    assert.ok(maxGap <= 2, `${urgent}: ${maxGap}`);
  }
});

test('확인할 차례가 아니면 재난문자를 부르지 않고, 확인하면 오늘 쓴 호출 수를 남긴다', async () => {
  const now = NOON + 60e3;
  disasterFetch({ items: [msg({ SN: 500 })], feed: { lastSn: 400, callsDay: kstDate(now), calls: 900, lastCallAt: new Date(now - 60e3).toISOString() } });
  assert.equal((await checkDisasterMessages(denv, now)).skipped, '쉬는 차례');
  assert.equal(calls.some((c) => c.url.includes('safetydata')), false);

  calls = [];
  disasterFetch({ items: [msg({ SN: 300, EMRG_STEP_NM: '안전안내' })], feed: { lastSn: 200, callsDay: kstDate(now), calls: 12 } });
  await checkDisasterMessages(denv, now);
  const f = commits().at(-1)[0].update.fields;
  assert.equal(f.calls.integerValue, '13');
  assert.equal(f.callsDay.stringValue, '20261029');
  assert.equal(f.every.integerValue, '1');
  assert.equal('urgentAt' in f, false);
});

// ---------- 접속 코드 확인과 잠금 ----------

/** 메모리 Firestore + Firebase 인증(관리자 API, 비밀번호 로그인) 흉내 */
function memoryFetch(store, { passwords = {}, accounts = {}, authDown = false } = {}) {
  let tick = 0;
  const stamp = () => `2026-10-29T00:00:${String(++tick).padStart(2, '0')}Z`;
  const doc = (path) => ({ name: `projects/${PROJECT}/databases/(default)/documents/${path}`, updateTime: store[path].updateTime, fields: toFields(store[path].data) });
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    calls.push({ url, method: init.method || 'GET', body: init.body });
    const ok = (data) => new Response(JSON.stringify(data), { status: 200 });
    const body = init.body ? JSON.parse(init.body) : {};
    if (url === 'https://oauth2.googleapis.com/token') return ok({ access_token: 'at', expires_in: 3600 });
    if (url.startsWith('https://fcm.googleapis.com/')) return ok({ name: 'sent' });
    if (url.endsWith('/accounts:lookup')) return ok({ users: body.localId.filter((id) => accounts[id]).map((id) => ({ localId: id, email: accounts[id] })) });
    if (url.endsWith('/accounts:delete')) {
      delete accounts[body.localId];
      return ok({});
    }
    if (url.endsWith('/accounts:update')) {
      if (body.email) {
        passwords[body.email] = passwords[accounts[body.localId]];
        accounts[body.localId] = body.email;
      }
      if (body.password) passwords[accounts[body.localId]] = body.password;
      return ok({});
    }
    if (url.includes('accounts:signInWithPassword')) {
      if (authDown) return new Response(JSON.stringify({ error: { message: 'TOO_MANY_ATTEMPTS_TRY_LATER' } }), { status: 400 });
      return passwords[body.email] && passwords[body.email] === body.password
        ? ok({}) : new Response(JSON.stringify({ error: { message: 'INVALID_LOGIN_CREDENTIALS' } }), { status: 400 });
    }
    if (url.endsWith('/documents:batchGet')) {
      return ok(body.documents.map((name) => {
        const path = name.split('/documents/')[1];
        return store[path] ? { found: doc(path) } : { missing: name };
      }));
    }
    if (url.endsWith('/documents:commit')) {
      for (const w of body.writes) {
        const path = (w.update?.name || w.delete).split('/documents/')[1];
        const cur = store[path];
        if (w.currentDocument?.exists === false && cur) return new Response('{}', { status: 409 });
        if (w.currentDocument?.updateTime && cur?.updateTime !== w.currentDocument.updateTime) return new Response('{}', { status: 409 });
      }
      for (const w of body.writes) {
        const path = (w.update?.name || w.delete).split('/documents/')[1];
        if (w.delete) { delete store[path]; continue; }
        const data = fromDocument({ name: w.update.name, fields: w.update.fields });
        delete data.id;
        delete data.updateTime;
        let next = data;
        if (w.updateMask) {
          next = { ...(store[path]?.data || {}) };
          for (const f of w.updateMask.fieldPaths) { if (f in data) next[f] = data[f]; else delete next[f]; }
        }
        store[path] = { data: next, updateTime: stamp() };
      }
      return ok({});
    }
    const m = /documents\/([^?]+)/.exec(url);
    if (m) {
      const path = decodeURIComponent(m[1]);
      if (init.method === 'POST') return ok({});
      const docs = Object.keys(store).filter((k) => k.startsWith(`${path}/`) && !k.slice(path.length + 1).includes('/'));
      if (store[path]) return ok(doc(path));
      if (!path.includes('/')) return ok({ documents: docs.map(doc) });
      return new Response('{}', { status: 404 });
    }
    throw new Error(`unexpected fetch ${url}`);
  };
}

const lenv = { ...env, FIREBASE_API_KEY: 'web-key' };
async function login(code, { ip = '1.2.3.4', device = 'device0000000000abcd' } = {}) {
  const headers = { Origin: ORIGIN, 'Content-Type': 'application/json', 'CF-Connecting-IP': ip };
  const res = await worker.fetch(new Request('https://w.example/login', { method: 'POST', headers, body: JSON.stringify({ code, device }) }), lenv);
  return { status: res.status, data: await res.json() };
}

async function lpost(path, token, body = {}) {
  const headers = { Origin: ORIGIN, 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
  const res = await worker.fetch(new Request(`https://w.example${path}`, { method: 'POST', headers, body: JSON.stringify(body) }), lenv);
  return { status: res.status, data: await res.json() };
}

function gateStore(extra = {}) {
  return {
    'public/gates': { data: { gen: 5, familyUid: 'gate-f', adminUid: 'gate-a', backupUid: 'gate-b', ...extra }, updateTime: 'u0' },
  };
}

test('접속 코드 잠금 규칙: 3번째 실패에 하루 잠그고, 하루가 지나면 새로 센다', () => {
  const key = { kind: 'ip', label: '1.2.*.*' };
  const now = Date.parse('2026-10-29T03:00:00Z');
  const save = (d) => ({ ...d, firstFailAt: d.firstFailAt.toISOString(), lockedUntil: d.lockedUntil?.toISOString() ?? null });
  let d = countAttempt(null, key, now);
  assert.equal(d.fails, 1);
  d = countAttempt(save(d), key, now + 1000);
  d = countAttempt(save(d), key, now + 2000);
  assert.equal(d.fails, 3);
  assert.equal(d.lockedUntil.getTime(), now + 2000 + 24 * 3600e3);
  assert.ok(lockedUntil(save(d), now + 3600e3));
  assert.equal(lockedUntil(save(d), now + 25 * 3600e3), 0);
  assert.equal(countAttempt(save(d), key, now + 25 * 3600e3).fails, 1);
  assert.equal(maskIp('211.234.5.6'), '211.234.*.*');
});

test('접속 코드를 3번 틀리면 하루 동안 막고, 맞는 코드도 받지 않는다. 다른 곳에서는 맞는 코드로 들어온다', async () => {
  const store = gateStore();
  const accounts = { 'gate-f': 'gf@x', 'gate-a': 'ga@x', 'gate-b': 'gb@x' };
  memoryFetch(store, { accounts, passwords: { 'gf@x': 'family-123', 'ga@x': 'admin-1234', 'gb@x': 'backup-123' } });
  const first = await login('nope-1');
  assert.deepEqual([first.status, first.data.left], [401, 2]);
  assert.equal((await login('nope-2')).data.left, 1);
  const third = await login('nope-3');
  assert.equal(third.status, 429);
  assert.ok(Date.parse(third.data.lockedUntil) > Date.now() + 23 * 3600e3);
  assert.equal((await login('family-123')).status, 429);
  // 같은 기기는 인터넷 주소를 바꿔도 막힌다
  assert.equal((await login('family-123', { ip: '9.9.9.9' })).status, 429);
  const other = await login('admin-1234', { ip: '9.9.9.9', device: 'otherdevice000000000' });
  assert.equal(other.status, 200);
  assert.equal(other.data.kind, 'admin');
  const claims = JSON.parse(Buffer.from(other.data.token.split('.')[1], 'base64url'));
  assert.equal(claims.uid, 'gate-a');
  assert.match(claims.aud, /identitytoolkit/);
  // 1.2.3.4 주소와 첫 기기의 잠금만 남는다 (맞힌 곳의 기록은 지워진다)
  assert.equal(Object.keys(store).filter((k) => k.startsWith('loginLocks/')).length, 2);
});

test('예전 공개 문서의 관문 이메일은 바꿔서 지우고, 인증 서버가 잠시 막히면 실패로 세지 않는다', async () => {
  const store = gateStore({ familyEmail: 'gf@x', adminEmail: 'ga@x', backupEmail: 'gb@x' });
  const accounts = { 'gate-f': 'gf@x', 'gate-a': 'ga@x', 'gate-b': 'gb@x' };
  const passwords = { 'gf@x': 'family-123' };
  memoryFetch(store, { accounts, passwords });
  const r = await login('family-123');
  assert.equal(r.data.kind, 'family');
  assert.match(accounts['gate-f'], /^g-family-[a-z0-9]{16}@demo-family\.firebaseapp\.com$/);
  assert.equal('familyEmail' in store['public/gates'].data, false);
  assert.equal('backupEmail' in store['public/gates'].data, false);
  assert.equal(store['public/gates'].data.familyUid, 'gate-f');

  calls = [];
  memoryFetch(store, { accounts, passwords, authDown: true });
  assert.equal((await login('whatever')).status, 503);
  assert.equal(Object.keys(store).some((k) => k.startsWith('loginLocks/')), false);
});

test('관문 계정은 가족 계정 관리로 지우거나 비밀번호를 바꿀 수 없다', async () => {
  db['public/gates'] = { gen: 5, familyUid: 'gate-f', adminUid: 'gate-a', backupUid: 'gate-b' };
  const admin = await makeToken({ sub: 'user-2' });
  assert.equal((await post('/admin/user', { token: admin, body: { action: 'delete', uid: 'gate-f' } })).status, 400);
  assert.equal((await post('/admin/user', { token: admin, body: { action: 'setPassword', uid: 'gate-b', password: 'long-enough-pw' } })).status, 400);
  assert.equal((await post('/admin/user', { token: admin, body: { action: 'setPassword', uid: 'nobody', password: 'long-enough-pw' } })).status, 404);
});

test('코드가 새어 나갔을 때: 그 코드의 사람들 열쇠를 모두 바꾸고, 부른 관리자에게는 새 열쇠를 준다', async () => {
  const store = {
    ...gateStore(),
    'members/admin': { data: { name: '아빠', active: true, role: 'admin', gen: 5 }, updateTime: 'u1' },
    'access/admin': { data: { people: [{ uid: 'admin', name: '아빠', email: 'a@x', key: 'old1' }, { uid: 'admin2', name: '엄마', email: 'b@x', key: 'old2' }] }, updateTime: 'u2' },
  };
  const accounts = { admin: 'a@x', admin2: 'b@x' };
  const passwords = { 'a@x': 'old1', 'b@x': 'old2' };
  memoryFetch(store, { accounts, passwords });
  const r = await lpost('/admin/rekey', await makeToken({ sub: 'admin' }), { kind: 'admin' });
  assert.equal(r.status, 200);
  assert.equal(r.data.changed, 2);
  const people = store['access/admin'].data.people;
  assert.notEqual(people[0].key, 'old1');
  assert.equal(passwords['b@x'], people[1].key);
  assert.deepEqual(r.data.self, { email: 'a@x', key: people[0].key });
  // 백업 코드로는 관리자 목록만 바꿀 수 있다
  assert.equal((await lpost('/admin/rekey', await makeToken({ sub: 'gate-b' }), { kind: 'family' })).status, 403);
  assert.equal((await lpost('/admin/rekey', await makeToken({ sub: 'gate-b' }), { kind: 'admin' })).status, 200);
  // 관문 계정은 다른 주소를 쓸 수 없다
  assert.equal((await lpost('/notify', await makeToken({ sub: 'gate-b' }))).status, 403);
});

// ---------- 도움 요청 ----------

test('도움 요청은 관리자, 나를 볼 수 있는 가족, 내가 볼 수 있는 가족에게 위치와 함께 간다', () => {
  const me = { id: 'kid', name: '아이', links: ['grandma'], last: { type: 'help', lat: 37.5665, lng: 126.978, accuracy: 12.4, note: '다리 다침' } };
  const members = [
    me,
    { id: 'dad', role: 'admin', links: [] },
    { id: 'mom', role: 'member', links: ['kid'] },
    { id: 'grandma', role: 'member', links: [] },
    { id: 'uncle', role: 'member', links: ['mom'] },
  ];
  assert.deepEqual(helpRecipients(members, me).map((m) => m.id), ['dad', 'mom', 'grandma']);
  const c = helpContent(me);
  assert.equal(c.title, '🆘 도움 요청: 아이');
  assert.equal(c.body, '다리 다침 · 위치: https://maps.google.com/?q=37.566500,126.978000 (±12m)');
  assert.equal(c.urgent, true);
  assert.equal(helpContent({ name: '아이', last: { type: 'help' } }).body, '위치 확인 안 됨');
});

test('도움 요청 알림은 한 신고에 한 번만 보내고, 문자 보낼 번호를 돌려준다', async () => {
  const at = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  const store = {
    ...gateStore(),
    'members/kid': { data: { name: '아이', active: true, role: 'member', gen: 5, links: [], last: { type: 'help', lat: 37.5, lng: 127, note: '갇힘', at } }, updateTime: 'u1' },
    'members/dad': { data: { name: '아빠', phone: '010-1111-2222', active: true, role: 'admin', gen: 5 }, updateTime: 'u2' },
    'members/off': { data: { name: '차단', phone: '010-9', active: false, role: 'admin', gen: 5 }, updateTime: 'u3' },
    'pushTokens/dad_0': { data: { uid: 'dad', token: 'tok-dad', platform: 'Android FamilyEmergencyApp/1.2', at }, updateTime: 'u4' },
    'pushTokens/tok-old': { data: { uid: 'off', at }, updateTime: 'u5' },
  };
  memoryFetch(store);
  const token = await makeToken({ sub: 'kid' });
  const r = await lpost('/help', token);
  assert.equal(r.status, 200);
  assert.equal(r.data.sent, 1);
  assert.deepEqual(r.data.recipients, [{ name: '아빠', phone: '010-1111-2222' }]);
  const push = JSON.parse(calls.find((c) => c.url.startsWith('https://fcm.googleapis.com/')).body).message;
  assert.equal(push.token, 'tok-dad');
  assert.equal(push.data.kind, 'help');
  assert.match(push.data.body, /갇힘 · 위치: https:\/\/maps\.google\.com/);
  const again = await lpost('/help', token);
  assert.equal(again.data.sent, 0);
  assert.equal(again.data.recipients.length, 1);
});

test('본인 계정 삭제: 내 정보·기록·토큰과 로그인 계정을 지우고 이름 목록에서 뺀다. 마지막 관리자는 못 지운다', async () => {
  const at = '2026-10-29T00:00:00Z';
  const store = {
    ...gateStore(),
    'members/kid': { data: { name: '아이', active: true, role: 'member', gen: 5 }, updateTime: 'u1' },
    'members/dad': { data: { name: '아빠', active: true, role: 'admin', gen: 5 }, updateTime: 'u2' },
    'profiles/kid': { data: { bloodType: 'O+' }, updateTime: 'u3' },
    'checkins/c1': { data: { uid: 'kid', type: 'safe', at }, updateTime: 'u4' },
    'checkins/c2': { data: { uid: 'dad', type: 'safe', at }, updateTime: 'u5' },
    'meetingLogs/m1': { data: { uid: 'kid', message: '도착', at }, updateTime: 'u6' },
    'pushTokens/kid_0': { data: { uid: 'kid', token: 't', at }, updateTime: 'u7' },
    'emergencyLog/e1': { data: { action: 'declare', by: 'kid', at }, updateTime: 'u8' },
    'access/family': { data: { people: [{ uid: 'kid', name: '아이', email: 'k@x', key: 'k' }, { uid: 'mom', name: '엄마', email: 'm@x', key: 'm' }] }, updateTime: 'u9' },
  };
  const accounts = { kid: 'k@x', dad: 'd@x' };
  memoryFetch(store, { accounts });
  assert.equal((await lpost('/me/delete', await makeToken({ sub: 'dad' }))).status, 409);
  const r = await lpost('/me/delete', await makeToken({ sub: 'kid' }));
  assert.equal(r.status, 200);
  assert.equal(r.data.accountDeleted, true);
  for (const k of ['members/kid', 'profiles/kid', 'checkins/c1', 'meetingLogs/m1', 'pushTokens/kid_0']) assert.equal(k in store, false, k);
  assert.ok(store['checkins/c2'] && store['members/dad'] && store['emergencyLog/e1']);
  assert.deepEqual(store['access/family'].data.people.map((p) => p.uid), ['mom']);
  assert.equal('kid' in accounts, false);
});

test('우리 지역 재난문자는 단계와 상관없이 최근 10개를 남긴다', () => {
  const settings = disasterSettings({ regions: ['서울'] });
  const items = [
    msg({ SN: 101, EMRG_STEP_NM: '안전안내', DST_SE_NM: '호우', MSG_CN: '호우주의보' }),
    msg({ SN: 102, RCPTN_RGN_NM: '부산광역시 전체 ', MSG_CN: '부산 지진' }),
    msg({ SN: 103, MSG_CN: '서울 지진' }),
  ];
  const prev = Array.from({ length: 9 }, (_, i) => ({ sn: 50 + i, at: '2026-10-28T00:00:00Z', step: '안전안내', kind: '', region: '서울특별시', text: `old ${i}` }));
  const r = recentMessages(items, 100, settings, prev);
  assert.equal(r.length, 10);
  assert.deepEqual(r.slice(0, 2).map((m) => m.sn), [103, 101]);
  assert.equal(r[0].text, '서울 지진');
  assert.equal(r[0].at.toISOString(), '2026-10-29T03:00:00.000Z');
  assert.equal(r.at(-1).sn, 51);
  assert.equal(recentMessages(items, 103, settings, prev), null);
});

test('확인할 때 우리 지역 재난문자를 config/disasterRecent 에 남긴다', async () => {
  const now = NOON + 60e3;
  disasterFetch({ items: [msg({ SN: 300, EMRG_STEP_NM: '안전안내', DST_SE_NM: '교통', MSG_CN: '도로 통제' })], feed: { lastSn: 200 } });
  const r = await checkDisasterMessages(denv, now);
  assert.equal(r.hit, null);
  assert.equal(r.recent, 1);
  const writes = commits().at(-1);
  assert.equal(writes.length, 2);
  assert.match(writes[1].update.name, /config\/disasterRecent$/);
  const item = writes[1].update.fields.items.arrayValue.values[0].mapValue.fields;
  assert.equal(item.text.stringValue, '도로 통제');
  assert.equal(item.step.stringValue, '안전안내');
  assert.ok(writes[1].update.fields.checkedAt.timestampValue);
  // 지역 설정이 없으면(전국) 빈 목록
  assert.deepEqual(writes[1].update.fields.regions, { arrayValue: { values: [] } });
});

test('새 문자가 없어도 확인 시각을 남기고, 처음이면 빈 목록 문서를 만든다 (가족이 "확인 중"임을 안다)', async () => {
  const now = NOON + 60e3;
  // 문서가 아직 없고 우리 지역 문자도 없음 → items: [] 로 만든다
  const settings = { regions: ['서울'] };
  disasterFetch({ settings, items: [msg({ SN: 300, EMRG_STEP_NM: '안전안내', RCPTN_RGN_NM: '부산광역시 전체' })], feed: { lastSn: 200 } });
  let r = await checkDisasterMessages(denv, now);
  assert.equal(r.recent, 0);
  let writes = commits().at(-1);
  assert.equal(writes.length, 2);
  assert.match(writes[1].update.name, /config\/disasterRecent$/);
  assert.deepEqual(writes[1].update.fields.items, { arrayValue: { values: [] } });
  assert.equal(writes[1].update.fields.regions.arrayValue.values[0].stringValue, '서울');
  assert.ok(writes[1].update.fields.checkedAt.timestampValue);
  assert.deepEqual(writes[1].updateMask.fieldPaths.sort(), ['checkedAt', 'items', 'regions', 'updatedAt']);

  // 문서가 있으면 목록은 두고 확인 시각만 바꾼다
  calls = [];
  disasterFetch({ settings, items: [], feed: { lastSn: 300 }, recent: { items: [{ sn: 1, text: 'x' }], updatedAt: new Date(NOON).toISOString() } });
  r = await checkDisasterMessages(denv, now);
  writes = commits().at(-1);
  assert.equal(writes.length, 2);
  assert.deepEqual(writes[1].updateMask.fieldPaths.sort(), ['checkedAt', 'regions']);
  assert.equal('items' in writes[1].update.fields, false);
});
