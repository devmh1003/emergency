// Firestore 보안 규칙 테스트. Firebase 에뮬레이터가 필요하다 (Java 11+).
// 실행: npm run test:rules
import { test, before, after, beforeEach } from 'node:test';
import { readFileSync } from 'node:fs';
import {
  initializeTestEnvironment, assertSucceeds, assertFails,
} from '@firebase/rules-unit-testing';
import {
  doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, collection, writeBatch, serverTimestamp, Timestamp,
  query, where, deleteField,
} from 'firebase/firestore';

let env;

before(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-family',
    firestore: { rules: readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8') },
  });
});

after(async () => { await env?.cleanup(); });

const GEN = 2;
const member = (name, extra = {}) => ({
  name, phone: '010-0000-0000', role: 'member', active: true, declareCredits: 1, order: 1, last: null, gen: GEN, ...extra,
});

// 접속 코드 3가지 = 관문 계정 3개 (gate-f: 가족, gate-a: 관리자, gate-b: 백업)
const gatesDoc = (extra = {}) => ({
  gen: GEN,
  familyEmail: 'gf@x', familyUid: 'gate-f',
  adminEmail: 'ga@x', adminUid: 'gate-a',
  backupEmail: 'gb@x', backupUid: 'gate-b',
  setupBy: 'admin', at: Timestamp.now(),
  ...extra,
});

beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'public/gates'), gatesDoc());
    await setDoc(doc(db, 'access/family'), { people: [{ uid: 'mom', name: '엄마', email: 'm@x', key: 'k1' }] });
    await setDoc(doc(db, 'access/admin'), { people: [{ uid: 'admin', name: '아빠', email: 'a@x', key: 'k2' }] });
    // 예전 방식(세대 없음)으로 남아 있는 관리자
    await setDoc(doc(db, 'members/legacy'), member('예전 관리자', { role: 'admin', gen: 0 }));
    await setDoc(doc(db, 'members/admin'), member('아빠', { role: 'admin' }));
    const last = { type: 'safe', lat: 37.5, lng: 127, accuracy: 10, note: '집', at: Timestamp.now(), clientAt: Timestamp.now() };
    await setDoc(doc(db, 'members/mom'), member('엄마', { links: ['kid'], last, updatedAt: Timestamp.now() }));
    await setDoc(doc(db, 'members/kid'), member('아이', { declareCredits: 0 }));
    await setDoc(doc(db, 'members/off'), member('비활성', { active: false }));
    await setDoc(doc(db, 'profiles/mom'), { bloodType: 'A+', address: '서울' });
    await setDoc(doc(db, 'profiles/kid'), { bloodType: 'O+' });
    await setDoc(doc(db, 'emergency/current'), {
      active: false, level: 'real', type: 'war', message: '지난 비상', declaredBy: 'admin', declaredByName: '아빠', declaredAt: Timestamp.now(),
      realAt: Timestamp.now(), escalatedBy: 'admin', escalatedByName: '아빠', endedBy: 'admin', endedByName: '아빠', endedAt: Timestamp.now(),
      notifiedKey: 'off:x',
    });
    await setDoc(doc(db, 'checkins/c1'), { uid: 'kid', name: '아이', type: 'safe', lat: null, lng: null, at: Timestamp.now(), clientAt: Timestamp.now() });
  });
});

const as = (uid) => env.authenticatedContext(uid).firestore();
const anon = () => env.unauthenticatedContext().firestore();

function checkinBatch(db, uid, name, overrides = {}) {
  const b = writeBatch(db);
  const clientAt = Timestamp.now();
  b.set(doc(collection(db, 'checkins')), {
    uid, name, type: 'safe', lat: 37.5, lng: 127, accuracy: 10, note: '', at: serverTimestamp(), clientAt, ...overrides,
  });
  b.update(doc(db, `members/${uid}`), {
    last: { type: 'safe', lat: 37.5, lng: 127, accuracy: 10, note: '', at: serverTimestamp(), clientAt },
    updatedAt: serverTimestamp(),
  });
  return b;
}

// ---------- 접근 ----------

test('로그인 안 한 사람과 등록 안 된 사람은 가족 정보를 못 본다', async () => {
  await assertFails(getDocs(collection(anon(), 'members')));
  await assertFails(getDocs(collection(as('stranger'), 'members')));
  await assertFails(getDoc(doc(as('stranger'), 'members/mom')));
  await assertFails(getDoc(doc(as('stranger'), 'meetingPoints/1')));
});

test('등록 안 된 사람도 자기 members 문서(없음)는 확인할 수 있다', async () => {
  await assertSucceeds(getDoc(doc(as('stranger'), 'members/stranger')));
});

test('비활성화된 가족은 아무것도 못 본다', async () => {
  await assertFails(getDocs(collection(as('off'), 'members')));
  await assertFails(getDoc(doc(as('off'), 'emergency/current')));
});

test('일반 가족은 지정된 가족(최대 3명)만 보고, 전체 목록은 관리자만 본다', async () => {
  await assertFails(getDocs(collection(as('mom'), 'members')));
  await assertSucceeds(getDocs(collection(as('admin'), 'members')));
  await assertSucceeds(getDoc(doc(as('mom'), 'members/mom')));
  await assertSucceeds(getDoc(doc(as('mom'), 'members/kid')));
  await assertFails(getDoc(doc(as('mom'), 'members/admin')));
  await assertFails(getDoc(doc(as('kid'), 'members/mom')));
});

test('민감 정보는 본인, 관리자, 지정된 가족만 본다', async () => {
  await assertSucceeds(getDoc(doc(as('mom'), 'profiles/mom')));
  await assertSucceeds(getDoc(doc(as('mom'), 'profiles/kid')));
  await assertFails(getDoc(doc(as('kid'), 'profiles/mom')));
  await assertSucceeds(getDoc(doc(as('admin'), 'profiles/kid')));
  await assertSucceeds(getDocs(collection(as('admin'), 'profiles')));
  await assertFails(getDocs(collection(as('mom'), 'profiles')));
});

test('볼 수 있는 가족 지정은 관리자만, 3명까지', async () => {
  await assertFails(updateDoc(doc(as('kid'), 'members/kid'), { links: ['mom'] }));
  await assertSucceeds(updateDoc(doc(as('admin'), 'members/kid'), { links: ['mom', 'admin'] }));
  await assertFails(updateDoc(doc(as('admin'), 'members/kid'), { links: ['a', 'b', 'c', 'd'] }));
});

test('위치 기록은 본인과 관리자만 본다', async () => {
  await assertFails(getDoc(doc(as('mom'), 'checkins/c1')));
  await assertSucceeds(getDoc(doc(as('kid'), 'checkins/c1')));
  await assertSucceeds(getDoc(doc(as('admin'), 'checkins/c1')));
  await assertSucceeds(getDocs(query(collection(as('kid'), 'checkins'), where('uid', '==', 'kid'))));
  await assertFails(getDocs(collection(as('mom'), 'checkins')));
});

// ---------- 생존신고 ----------

test('본인 명의 생존신고는 저장되고, 남의 명의·남의 이름은 거부된다', async () => {
  await assertSucceeds(checkinBatch(as('mom'), 'mom', '엄마').commit());
  await assertFails(checkinBatch(as('mom'), 'kid', '아이').commit());
  await assertFails(checkinBatch(as('mom'), 'mom', '아빠').commit());
});

test('신고 기록은 고칠 수 없다', async () => {
  await assertFails(updateDoc(doc(as('kid'), 'checkins/c1'), { type: 'help' }));
  await assertFails(deleteDoc(doc(as('kid'), 'checkins/c1')));
  await assertSucceeds(deleteDoc(doc(as('admin'), 'checkins/c1')));
});

test('잘못된 좌표나 종류는 거부된다', async () => {
  await assertFails(checkinBatch(as('mom'), 'mom', '엄마', { lat: 200 }).commit());
  await assertFails(checkinBatch(as('mom'), 'mom', '엄마', { type: 'hack' }).commit());
  await assertFails(checkinBatch(as('mom'), 'mom', '엄마', { extra: 'x' }).commit());
});

// ---------- 가족 정보 수정 ----------

test('본인은 전화번호만 바꿀 수 있고, 권한·이름·선언권은 못 바꾼다', async () => {
  await assertSucceeds(updateDoc(doc(as('mom'), 'members/mom'), { phone: '010-1111-2222' }));
  await assertFails(updateDoc(doc(as('mom'), 'members/mom'), { role: 'admin' }));
  await assertFails(updateDoc(doc(as('mom'), 'members/mom'), { name: '관리자' }));
  await assertFails(updateDoc(doc(as('kid'), 'members/kid'), { declareCredits: 3 }));
  await assertFails(updateDoc(doc(as('mom'), 'members/kid'), { phone: '1' }));
});

test('가족 추가·삭제는 관리자만, 관리자는 자신을 지울 수 없다', async () => {
  await assertFails(setDoc(doc(as('mom'), 'members/new'), member('새 가족')));
  await assertSucceeds(setDoc(doc(as('admin'), 'members/new'), member('새 가족')));
  await assertFails(setDoc(doc(as('admin'), 'members/bad'), member('', {})));
  await assertFails(setDoc(doc(as('admin'), 'members/bad'), member('권한이상', { role: 'root' })));
  await assertFails(deleteDoc(doc(as('mom'), 'members/kid')));
  await assertFails(deleteDoc(doc(as('admin'), 'members/admin')));
  await assertSucceeds(deleteDoc(doc(as('admin'), 'members/kid')));
});

test('민감 정보는 본인과 관리자만 쓸 수 있다', async () => {
  await assertSucceeds(setDoc(doc(as('mom'), 'profiles/mom'), { bloodType: 'B+' }, { merge: true }));
  await assertFails(setDoc(doc(as('mom'), 'profiles/kid'), { bloodType: 'B+' }, { merge: true }));
  await assertSucceeds(setDoc(doc(as('admin'), 'profiles/kid'), { address: '부산' }, { merge: true }));
  await assertFails(setDoc(doc(as('mom'), 'profiles/mom'), { password: 'x' }, { merge: true }));
});

// ---------- 비상선언 ----------

// 앱(store.js declareEmergency)과 같은 모양으로 쓴다.
function memberDeclare(db, uid, name, credits, { decrement = true, level = 'alert', extra = {} } = {}) {
  const b = writeBatch(db);
  b.set(doc(db, 'emergency/current'), {
    active: true, level, type: 'earthquake', message: '', declaredBy: uid, declaredByName: name, declaredAt: serverTimestamp(),
    realAt: level === 'real' ? serverTimestamp() : deleteField(),
    escalatedBy: deleteField(),
    escalatedByName: deleteField(),
    ...extra,
  }, { merge: true });
  if (decrement) b.update(doc(db, `members/${uid}`), { declareCredits: credits - 1 });
  return b;
}

// 앱(store.js escalateEmergency)과 같은 모양으로 쓴다.
function memberEscalate(db, uid, name, credits, { decrement = true, extra = {} } = {}) {
  const b = writeBatch(db);
  b.update(doc(db, 'emergency/current'), {
    level: 'real', realAt: serverTimestamp(), escalatedBy: uid, escalatedByName: name, ...extra,
  });
  if (decrement) b.update(doc(db, `members/${uid}`), { declareCredits: credits - 1 });
  return b;
}

const setEmergency = (data) => env.withSecurityRulesDisabled((ctx) => setDoc(doc(ctx.firestore(), 'emergency/current'), data));

test('일반 가족은 선언권 1회를 차감하면서 선언할 수 있다', async () => {
  await assertSucceeds(memberDeclare(as('mom'), 'mom', '엄마', 1).commit());
  let credits;
  await env.withSecurityRulesDisabled(async (ctx) => {
    credits = (await getDoc(doc(ctx.firestore(), 'members/mom'))).data().declareCredits;
  });
  if (credits !== 0) throw new Error('선언권이 차감되지 않았습니다');
  // 쓴 뒤에는 다시 선언할 수 없다 (관리자가 해제한 뒤에도)
  await env.withSecurityRulesDisabled((ctx) => setDoc(doc(ctx.firestore(), 'emergency/current'), { active: false }));
  await assertFails(memberDeclare(as('mom'), 'mom', '엄마', 0).commit());
});

test('선언권 차감 없이, 또는 선언권이 없으면 선언할 수 없다', async () => {
  await assertFails(memberDeclare(as('mom'), 'mom', '엄마', 1, { decrement: false }).commit());
  await assertFails(memberDeclare(as('kid'), 'kid', '아이', 0).commit());
});

test('남의 이름으로 선언하거나, 이미 비상 중일 때 덮어쓸 수 없다', async () => {
  await assertFails(memberDeclare(as('mom'), 'mom', '아빠', 1).commit());
  await assertSucceeds(memberDeclare(as('admin'), 'admin', '아빠', 1, { decrement: false }).commit());
  await assertFails(memberDeclare(as('mom'), 'mom', '엄마', 1).commit());
});

test('일반 가족은 실제 상황도 바로 선언할 수 있고, 경계에는 실제 시각을 넣을 수 없다', async () => {
  await assertFails(memberDeclare(as('mom'), 'mom', '엄마', 1, { level: 'alert', extra: { realAt: serverTimestamp() } }).commit());
  await assertFails(memberDeclare(as('mom'), 'mom', '엄마', 1, { level: 'severe' }).commit());
  await assertSucceeds(memberDeclare(as('mom'), 'mom', '엄마', 1, { level: 'real' }).commit());
});

test('경계 → 실제 전환: 관리자는 언제든, 일반 가족은 선언권을 쓰며 한 번', async () => {
  await setEmergency({
    active: true, level: 'alert', type: 'war', message: '대비하세요', declaredBy: 'admin', declaredByName: '아빠', declaredAt: Timestamp.now(),
    endedBy: 'admin', endedByName: '아빠', endedAt: Timestamp.now(), notifiedKey: 'alert:x',
  });
  // 선언권 없음 / 차감 안 함 / 남의 이름 / 발령자 바꾸기는 거부
  await assertFails(memberEscalate(as('kid'), 'kid', '아이', 0).commit());
  await assertFails(memberEscalate(as('mom'), 'mom', '엄마', 1, { decrement: false }).commit());
  await assertFails(memberEscalate(as('mom'), 'mom', '아빠', 1).commit());
  await assertFails(memberEscalate(as('mom'), 'mom', '엄마', 1, { extra: { declaredBy: 'mom' } }).commit());
  await assertSucceeds(memberEscalate(as('mom'), 'mom', '엄마', 1, { extra: { message: '실제입니다' } }).commit());
  // 이미 실제면 다시 전환할 수 없다
  await env.withSecurityRulesDisabled((ctx) => updateDoc(doc(ctx.firestore(), 'members/kid'), { declareCredits: 1 }));
  await assertFails(memberEscalate(as('kid'), 'kid', '아이', 1).commit());
  // 관리자는 선언권 없이 전환
  await setEmergency({ active: true, level: 'alert', type: 'war', declaredBy: 'mom', declaredByName: '엄마', declaredAt: Timestamp.now() });
  await assertSucceeds(memberEscalate(as('admin'), 'admin', '아빠', 0, { decrement: false }).commit());
});

test('경보 단계 값은 경계·실제만 허용한다', async () => {
  await assertFails(setDoc(doc(as('admin'), 'emergency/current'), { active: true, level: 'severe', declaredBy: 'admin' }));
  await assertSucceeds(setDoc(doc(as('admin'), 'emergency/current'), { active: true, level: 'alert', declaredBy: 'admin', declaredAt: serverTimestamp() }));
});

test('비상 해제는 관리자만 할 수 있다', async () => {
  await env.withSecurityRulesDisabled((ctx) => setDoc(doc(ctx.firestore(), 'emergency/current'), { active: true, declaredBy: 'admin' }));
  await assertFails(setDoc(doc(as('mom'), 'emergency/current'), { active: false }, { merge: true }));
  await assertSucceeds(setDoc(doc(as('admin'), 'emergency/current'), { active: false, endedBy: 'admin', endedAt: serverTimestamp() }, { merge: true }));
});

test('비상 기록은 실제로 발령·전환·해제하는 같은 일괄 쓰기에서, 본인 이름으로만 남긴다', async () => {
  const logRef = (db) => doc(collection(db, 'emergencyLog'));
  const entry = (uid, name, action, extra = {}) => ({ action, by: uid, byName: name, at: serverTimestamp(), ...extra });
  // 비상 문서는 그대로 두고 기록만 남기기 → 거부 (가짜 기록)
  await assertFails(setDoc(logRef(as('mom')), entry('mom', '엄마', 'declare')));
  await assertFails(setDoc(logRef(as('admin')), entry('admin', '아빠', 'end')));
  // 발령과 함께 → 허용, 이름을 속이면 거부
  const declareWithLog = (name) => {
    const db = as('mom');
    const b = memberDeclare(db, 'mom', '엄마', 1);
    b.set(logRef(db), entry('mom', name, 'declare', { level: 'alert', type: 'earthquake', message: '' }));
    return b.commit();
  };
  await assertFails(declareWithLog('아빠'));
  await assertSucceeds(declareWithLog('엄마'));
  // 해제는 관리자만, 해제하는 일괄 쓰기에서
  const endWithLog = (uid, name) => {
    const db = as(uid);
    const b = writeBatch(db);
    b.set(doc(db, 'emergency/current'), { active: false, endedBy: uid, endedByName: name, endedAt: serverTimestamp() }, { merge: true });
    b.set(logRef(db), entry(uid, name, 'end'));
    return b.commit();
  };
  await assertFails(endWithLog('kid', '아이'));
  await assertSucceeds(endWithLog('admin', '아빠'));
});

// ---------- 테스트 알람 ----------

test('테스트 알람은 관리자만 보내고, 가족은 본인 확인만 남긴다', async () => {
  const testDoc = (by, name, extra = {}) => ({ by, byName: name, at: serverTimestamp(), message: '훈련', sound: 'real', ...extra });
  await assertFails(setDoc(doc(as('mom'), 'alarmTests/t0'), testDoc('mom', '엄마')));
  await assertFails(setDoc(doc(as('admin'), 'alarmTests/t0'), testDoc('admin', '아빠', { sound: 'loud' })));
  await assertSucceeds(setDoc(doc(as('admin'), 'alarmTests/t1'), testDoc('admin', '아빠')));
  // 받을 사람 고르기: uid 목록만 (최대 25명)
  await assertSucceeds(setDoc(doc(as('admin'), 'alarmTests/t2'), testDoc('admin', '아빠', { targets: ['mom'] })));
  await assertFails(setDoc(doc(as('admin'), 'alarmTests/t3'), testDoc('admin', '아빠', { targets: 'mom' })));
  await assertFails(setDoc(doc(as('admin'), 'alarmTests/t4'), testDoc('admin', '아빠', { targets: Array.from({ length: 26 }, (_, i) => `u${i}`) })));
  await assertFails(updateDoc(doc(as('admin'), 'alarmTests/t1'), { message: '바꿈' }));
  await assertSucceeds(getDoc(doc(as('kid'), 'alarmTests/t1')));
  await assertFails(getDoc(doc(as('stranger'), 'alarmTests/t1')));

  const ack = (uid, target, name) => setDoc(doc(as(uid), `alarmTests/t1/acks/${target}`), { name, at: serverTimestamp() });
  await assertSucceeds(ack('mom', 'mom', '엄마'));
  await assertFails(ack('mom', 'kid', '아이'));
  await assertFails(ack('kid', 'kid', '엄마'));
  await assertFails(ack('off', 'off', '비활성'));
  await assertFails(setDoc(doc(as('kid'), 'alarmTests/none/acks/kid'), { name: '아이', at: serverTimestamp() }));
  await assertFails(setDoc(doc(as('mom'), 'alarmTests/t1/acks/mom'), { name: '엄마', at: serverTimestamp() }, { merge: true }));
  // 누가 확인했는지는 관리자만 본다 (본인 것은 본인도)
  await assertSucceeds(getDocs(collection(as('admin'), 'alarmTests/t1/acks')));
  await assertSucceeds(getDoc(doc(as('mom'), 'alarmTests/t1/acks/mom')));
  await assertFails(getDoc(doc(as('kid'), 'alarmTests/t1/acks/mom')));
});

// ---------- 정부 긴급재난문자 자동 경보 ----------

test('재난문자 자동 경보 설정은 관리자만 보고 바꾸며, 확인 결과는 알림 서버만 쓴다', async () => {
  const settings = (uid, name, extra = {}) => ({
    enabled: true, regions: ['서울', '경기 수원'], level2: false, updatedBy: uid, updatedByName: name, updatedAt: serverTimestamp(), ...extra,
  });
  await assertFails(setDoc(doc(as('mom'), 'config/disasterAlerts'), settings('mom', '엄마')));
  await assertSucceeds(setDoc(doc(as('admin'), 'config/disasterAlerts'), settings('admin', '아빠')));
  await assertFails(setDoc(doc(as('admin'), 'config/disasterAlerts'), settings('mom', '아빠')));
  await assertFails(setDoc(doc(as('admin'), 'config/disasterAlerts'), settings('admin', '아빠', { regions: '서울' })));
  await assertFails(setDoc(doc(as('admin'), 'config/disasterAlerts'), settings('admin', '아빠', { enabled: 'yes' })));
  await assertFails(setDoc(doc(as('admin'), 'config/disasterAlerts'), settings('admin', '아빠', { key: 'x' })));
  await assertFails(setDoc(doc(as('admin'), 'config/disasterAlerts'), settings('admin', '아빠', { regions: Array.from({ length: 21 }, (_, i) => `r${i}`) })));
  await assertSucceeds(getDoc(doc(as('admin'), 'config/disasterAlerts')));
  await assertFails(getDoc(doc(as('mom'), 'config/disasterAlerts')));
  await assertFails(deleteDoc(doc(as('admin'), 'config/disasterAlerts')));

  await assertFails(setDoc(doc(as('admin'), 'config/disasterFeed'), { lastSn: 1 }));
  await assertSucceeds(getDoc(doc(as('admin'), 'config/disasterFeed')));
  await assertFails(getDoc(doc(as('mom'), 'config/disasterFeed')));
  await assertFails(setDoc(doc(as('admin'), 'config/other'), { x: 1 }));
});

test('알림 서버가 재난문자로 선언한 비상도 관리자가 해제할 수 있다', async () => {
  const at = Timestamp.now();
  await setEmergency({
    active: true, level: 'real', type: 'earthquake', message: '[기상청] 지진발생', declaredBy: 'safetydata', declaredByName: '정부 재난문자',
    declaredAt: at, realAt: at, notifiedKey: 'real:x',
  });
  await assertSucceeds(getDoc(doc(as('kid'), 'emergency/current')));
  await assertFails(setDoc(doc(as('mom'), 'emergency/current'), { active: false, endedBy: 'mom', endedByName: '엄마', endedAt: serverTimestamp() }, { merge: true }));
  await assertSucceeds(setDoc(doc(as('admin'), 'emergency/current'), { active: false, endedBy: 'admin', endedByName: '아빠', endedAt: serverTimestamp() }, { merge: true }));
});

// ---------- 집합장소·프로토콜·체크리스트 ----------

const point = (rank, extra = {}) => ({
  rank, name: '집', address: '', lat: 37.5, lng: 127, offsetHours: 0, waitMinutes: 60, overrideAt: null, note: '', ...extra,
});

test('집합장소는 관리자만, 1~10순위만 정할 수 있다', async () => {
  await assertFails(setDoc(doc(as('mom'), 'meetingPoints/1'), point(1)));
  await assertSucceeds(setDoc(doc(as('admin'), 'meetingPoints/1'), point(1)));
  await assertSucceeds(setDoc(doc(as('admin'), 'meetingPoints/10'), point(10)));
  await assertFails(setDoc(doc(as('admin'), 'meetingPoints/11'), point(11)));
  await assertFails(setDoc(doc(as('admin'), 'meetingPoints/2'), point(3)));
  await assertSucceeds(getDoc(doc(as('mom'), 'meetingPoints/1')));
});

test('집합장소 기록은 본인 명의·본인 이름으로 누구나 남기고, 위치 좌표는 남기지 않는다', async () => {
  const log = (uid, by, name = '엄마', extra = {}) => setDoc(doc(collection(as(uid), 'meetingLogs')), {
    rank: 1, uid: by, name, message: '도착', at: serverTimestamp(), clientAt: Timestamp.now(), ...extra,
  });
  await assertSucceeds(log('mom', 'mom'));
  await assertFails(log('mom', 'kid'));
  await assertFails(log('mom', 'mom', '아빠'));
  await assertFails(log('mom', 'mom', '엄마', { lat: 37.5, lng: 127 }));
});

test('프로토콜은 관리자만 고친다', async () => {
  const p = { title: '지진', icon: '🌏', order: 1, summary: '', steps: [], checklist: [] };
  await assertFails(setDoc(doc(as('mom'), 'protocols/earthquake'), p));
  await assertSucceeds(setDoc(doc(as('admin'), 'protocols/earthquake'), p));
});

test('체크리스트는 본인만 쓰고 관리자는 볼 수 있다', async () => {
  await assertSucceeds(setDoc(doc(as('mom'), 'checklists/mom'), { done: { basics__b1: true } }));
  await assertFails(setDoc(doc(as('mom'), 'checklists/kid'), { done: {} }));
  await assertSucceeds(getDoc(doc(as('admin'), 'checklists/mom')));
  await assertFails(getDoc(doc(as('kid'), 'checklists/mom')));
});

test('알림 토큰은 본인 것만 등록·조회한다', async () => {
  await assertSucceeds(setDoc(doc(as('mom'), 'pushTokens/tok1'), { uid: 'mom', platform: 'x', at: serverTimestamp() }));
  await assertFails(setDoc(doc(as('mom'), 'pushTokens/tok2'), { uid: 'kid', platform: 'x', at: serverTimestamp() }));
  await assertSucceeds(getDoc(doc(as('mom'), 'pushTokens/tok1')));
  await assertFails(getDoc(doc(as('kid'), 'pushTokens/tok1')));
  await assertFails(getDocs(collection(as('admin'), 'pushTokens')));
});

// ---------- 초기 설정 ----------

// 앱(store.js setupAccess)과 같은 모양: 관문 문서 + 첫 관리자 + 이름 목록을 한 번에
function bootstrap(uid, gen = GEN + 1) {
  const db = as(uid);
  const b = writeBatch(db);
  b.set(doc(db, `members/${uid}`), member('첫 관리자', { role: 'admin', order: 0, gen }));
  b.set(doc(db, 'public/gates'), {
    gen, familyEmail: 'f2@x', familyUid: `${uid}-f`, adminEmail: 'a2@x', adminUid: `${uid}-a`, backupEmail: 'b2@x', backupUid: `${uid}-b`,
    setupBy: uid, at: serverTimestamp(),
  });
  b.set(doc(db, 'access/admin'), { people: [{ uid, name: '첫 관리자', email: 'o@x', key: 'k' }] });
  b.set(doc(db, 'access/family'), { people: [] });
  return b.commit();
}

test('초기 설정은 관문 문서가 없을 때 한 번만 할 수 있고, 예전 계정은 새 세대에서 막힌다', async () => {
  await assertFails(bootstrap('attacker'));
  await env.withSecurityRulesDisabled((ctx) => deleteDoc(doc(ctx.firestore(), 'public/gates')));
  // 관문 문서가 없으면 아무도 가족 데이터에 접근 못 한다
  await assertFails(getDoc(doc(as('admin'), 'emergency/current')));
  await assertSucceeds(bootstrap('owner'));
  await assertFails(bootstrap('attacker'));
  // 예전 세대의 관리자는 더 이상 관리자가 아니다
  await assertFails(getDocs(collection(as('admin'), 'members')));
  await assertSucceeds(getDocs(collection(as('owner'), 'members')));
});

test('스스로 관리자가 될 수 없고, 세대가 없는 예전 계정은 접근하지 못한다', async () => {
  await assertFails(setDoc(doc(as('attacker'), 'members/attacker'), member('해커', { role: 'admin' })));
  await assertFails(getDocs(collection(as('legacy'), 'members')));
  await assertFails(getDoc(doc(as('legacy'), 'emergency/current')));
});

test('관문 문서는 누구나 읽고, 관리자만 코드를 바꾸며 세대는 못 바꾼다', async () => {
  await assertSucceeds(getDoc(doc(anon(), 'public/gates')));
  const change = (uid, data) => setDoc(doc(as(uid), 'public/gates'), { ...data, at: serverTimestamp() }, { merge: true });
  await assertFails(change('mom', { familyEmail: 'new@x', familyUid: 'gate-f2' }));
  await assertSucceeds(change('admin', { familyEmail: 'new@x', familyUid: 'gate-f2' }));
  await assertFails(change('admin', { gen: GEN + 5 }));
  await assertFails(change('admin', { familyUid: 'gate-a' }));
});

test('가족 코드로는 가족 목록만, 관리자 코드로는 관리자 목록만 본다 (가족 데이터는 못 본다)', async () => {
  await assertSucceeds(getDoc(doc(as('gate-f'), 'access/family')));
  await assertFails(getDoc(doc(as('gate-f'), 'access/admin')));
  await assertSucceeds(getDoc(doc(as('gate-a'), 'access/admin')));
  await assertFails(getDoc(doc(as('gate-a'), 'access/family')));
  await assertFails(getDoc(doc(as('mom'), 'access/family')));
  await assertSucceeds(getDoc(doc(as('admin'), 'access/family')));
  await assertFails(getDoc(doc(as('gate-f'), 'members/mom')));
  await assertFails(getDoc(doc(as('gate-a'), 'emergency/current')));
  await assertFails(setDoc(doc(as('gate-f'), 'access/family'), { people: [] }));
});

test('백업 코드로는 관리자 코드 교체와 관리자 추가만 할 수 있다', async () => {
  const gb = as('gate-b');
  await assertSucceeds(setDoc(doc(gb, 'public/gates'), { adminEmail: 'ga2@x', adminUid: 'gate-a2', at: serverTimestamp() }, { merge: true }));
  await assertFails(setDoc(doc(gb, 'public/gates'), { familyEmail: 'gf2@x', familyUid: 'gate-f2', at: serverTimestamp() }, { merge: true }));
  await assertSucceeds(setDoc(doc(gb, 'members/newadmin'), member('새 관리자', { role: 'admin' })));
  await assertFails(setDoc(doc(gb, 'members/newkid'), member('새 가족')));
  await assertSucceeds(setDoc(doc(gb, 'access/admin'), { people: [] }));
  await assertFails(setDoc(doc(gb, 'access/family'), { people: [] }));
  await assertFails(getDocs(collection(gb, 'members')));
  await assertFails(getDoc(doc(gb, 'profiles/mom')));
  await assertSucceeds(setDoc(doc(gb, 'auditLog/b1'), { action: 'backup.adminCode', detail: '', by: 'gate-b', byName: '백업 코드', at: serverTimestamp() }));
  await assertFails(setDoc(doc(gb, 'auditLog/b2'), { action: 'member.delete', detail: '', by: 'gate-b', byName: '백업 코드', at: serverTimestamp() }));
});

test('새 가족은 지금 세대로만 만든다', async () => {
  await assertFails(setDoc(doc(as('admin'), 'members/new1'), member('새 가족', { gen: 0 })));
  await assertSucceeds(setDoc(doc(as('admin'), 'members/new2'), member('새 가족')));
});

test('체크리스트 값은 참/거짓만', async () => {
  await assertSucceeds(setDoc(doc(as('mom'), 'checklists/mom'), { done: { a: true, b: false } }));
  await assertFails(setDoc(doc(as('mom'), 'checklists/mom'), { done: { a: 'x'.repeat(1000) } }));
});

// ---------- 로그인 아이디·관리 기록·연락처 ----------

test('로그인 아이디 기록은 관리자만 바꾼다', async () => {
  await env.withSecurityRulesDisabled((ctx) => setDoc(doc(ctx.firestore(), 'profiles/mom'), { loginId: 'mom', bloodType: 'A+' }));
  await assertSucceeds(setDoc(doc(as('mom'), 'profiles/mom'), { address: '부산' }, { merge: true }));
  await assertFails(setDoc(doc(as('mom'), 'profiles/mom'), { loginId: 'admin' }, { merge: true }));
  await assertSucceeds(setDoc(doc(as('admin'), 'profiles/mom'), { loginId: 'mom2' }, { merge: true }));
  // 아이디 기록이 없던 사람이 스스로 만들 수도 없다
  await assertFails(setDoc(doc(as('kid'), 'profiles/kid'), { loginId: 'kid' }, { merge: true }));
});

test('관리 기록은 관리자만 남기고 읽으며, 고치거나 지울 수 없다', async () => {
  const entry = (uid, name) => ({ action: 'member.create', target: 'x', targetName: '새 가족', detail: '', by: uid, byName: name, at: serverTimestamp() });
  await assertFails(setDoc(doc(as('mom'), 'auditLog/a1'), entry('mom', '엄마')));
  await assertFails(setDoc(doc(as('admin'), 'auditLog/a1'), entry('mom', '엄마')));
  await assertSucceeds(setDoc(doc(as('admin'), 'auditLog/a1'), entry('admin', '아빠')));
  await assertSucceeds(getDocs(collection(as('admin'), 'auditLog')));
  await assertFails(getDocs(collection(as('mom'), 'auditLog')));
  await assertFails(updateDoc(doc(as('admin'), 'auditLog/a1'), { detail: '조작' }));
  await assertFails(deleteDoc(doc(as('admin'), 'auditLog/a1')));
});

test('가족 지정 연락처는 가족 모두 보고 관리자만 고친다', async () => {
  const c = { name: '단골 병원', phone: '02-000-0000', category: '병원', note: '', order: 1 };
  await assertFails(setDoc(doc(as('mom'), 'contacts/c1'), c));
  await assertSucceeds(setDoc(doc(as('admin'), 'contacts/c1'), c));
  await assertSucceeds(getDocs(collection(as('kid'), 'contacts')));
  await assertFails(getDocs(collection(as('stranger'), 'contacts')));
  await assertFails(setDoc(doc(as('admin'), 'contacts/c2'), { ...c, name: '' }));
});

test('프로토콜 핵심 요약은 6개까지', async () => {
  const p = { title: '폭염', icon: '🌡️', order: 1, summary: '', keyPoints: ['a', 'b', 'c'], steps: [], checklist: [] };
  await assertSucceeds(setDoc(doc(as('admin'), 'protocols/heat'), p));
  await assertFails(setDoc(doc(as('admin'), 'protocols/heat'), { ...p, keyPoints: ['1', '2', '3', '4', '5', '6', '7'] }));
});
