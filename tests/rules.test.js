// Firestore 보안 규칙 테스트. Firebase 에뮬레이터가 필요하다 (Java 11+).
// 실행: npm run test:rules
import { test, before, after, beforeEach } from 'node:test';
import { readFileSync } from 'node:fs';
import {
  initializeTestEnvironment, assertSucceeds, assertFails,
} from '@firebase/rules-unit-testing';
import {
  doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, collection, writeBatch, serverTimestamp, Timestamp,
  query, where,
} from 'firebase/firestore';

let env;

before(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-family',
    firestore: { rules: readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8') },
  });
});

after(async () => { await env?.cleanup(); });

const member = (name, extra = {}) => ({
  name, phone: '010-0000-0000', role: 'member', active: true, declareCredits: 1, order: 1, last: null, ...extra,
});

beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'config/setup'), { by: 'admin', at: Timestamp.now() });
    await setDoc(doc(db, 'members/admin'), member('아빠', { role: 'admin' }));
    await setDoc(doc(db, 'members/mom'), member('엄마', { links: ['kid'] }));
    await setDoc(doc(db, 'members/kid'), member('아이', { declareCredits: 0 }));
    await setDoc(doc(db, 'members/off'), member('비활성', { active: false }));
    await setDoc(doc(db, 'profiles/mom'), { bloodType: 'A+', address: '서울' });
    await setDoc(doc(db, 'profiles/kid'), { bloodType: 'O+' });
    await setDoc(doc(db, 'emergency/current'), { active: false });
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

test('본인 명의 생존신고는 저장되고, 남의 명의는 거부된다', async () => {
  await assertSucceeds(checkinBatch(as('mom'), 'mom', '엄마').commit());
  await assertFails(checkinBatch(as('mom'), 'kid', '아이').commit());
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

function memberDeclare(db, uid, name, credits, { decrement = true } = {}) {
  const b = writeBatch(db);
  b.set(doc(db, 'emergency/current'), {
    active: true, type: 'earthquake', message: '', declaredBy: uid, declaredByName: name, declaredAt: serverTimestamp(),
  }, { merge: true });
  if (decrement) b.update(doc(db, `members/${uid}`), { declareCredits: credits - 1 });
  return b;
}

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

test('비상 해제는 관리자만 할 수 있다', async () => {
  await env.withSecurityRulesDisabled((ctx) => setDoc(doc(ctx.firestore(), 'emergency/current'), { active: true, declaredBy: 'admin' }));
  await assertFails(setDoc(doc(as('mom'), 'emergency/current'), { active: false }, { merge: true }));
  await assertSucceeds(setDoc(doc(as('admin'), 'emergency/current'), { active: false, endedBy: 'admin', endedAt: serverTimestamp() }, { merge: true }));
});

test('선언 기록: 가족은 선언 기록만, 해제 기록은 관리자만 남긴다', async () => {
  const log = (uid, name, action) => setDoc(doc(collection(as(uid), 'emergencyLog')), { action, by: uid, byName: name, at: serverTimestamp() });
  await assertSucceeds(log('mom', '엄마', 'declare'));
  await assertFails(log('mom', '엄마', 'end'));
  await assertSucceeds(log('admin', '아빠', 'end'));
  await assertFails(setDoc(doc(collection(as('mom'), 'emergencyLog')), { action: 'declare', by: 'admin', byName: '아빠', at: serverTimestamp() }));
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

test('집합장소 기록은 본인 명의로 누구나 남긴다', async () => {
  const log = (uid, by) => setDoc(doc(collection(as(uid), 'meetingLogs')), {
    rank: 1, uid: by, name: '엄마', message: '도착', lat: null, lng: null, accuracy: null, at: serverTimestamp(), clientAt: Timestamp.now(),
  });
  await assertSucceeds(log('mom', 'mom'));
  await assertFails(log('mom', 'kid'));
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

function bootstrap(uid) {
  const db = as(uid);
  const b = writeBatch(db);
  b.set(doc(db, `members/${uid}`), member('첫 관리자', { role: 'admin', order: 0 }));
  b.set(doc(db, 'config/setup'), { by: uid, at: serverTimestamp() });
  return b.commit();
}

test('초기 설정은 한 번만 할 수 있다', async () => {
  await env.withSecurityRulesDisabled((ctx) => deleteDoc(doc(ctx.firestore(), 'config/setup')));
  await assertSucceeds(bootstrap('owner'));
  await assertFails(bootstrap('attacker'));
});

test('초기 설정 없이 스스로 관리자가 될 수 없다', async () => {
  await assertFails(bootstrap('attacker'));
  await assertFails(setDoc(doc(as('attacker'), 'members/attacker'), member('해커', { role: 'admin' })));
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
