// Firestore 읽기·쓰기. 권한 검사는 firestore.rules 가 하고, 여기서는 규칙에 맞는 모양으로 쓴다.
import {
  doc, collection, getDoc, getDocs, setDoc, deleteDoc, onSnapshot, query, where, orderBy, limit,
  writeBatch, serverTimestamp, Timestamp, deleteField,
} from 'https://www.gstatic.com/firebasejs/13.0.0/firebase-firestore.js';
import {
  db, auth, callWorker, createAccount, newAccountEmail, randomToken, signIn, signInWithToken, logout, deviceId,
} from './firebase.js';
import { DEFAULT_PROTOCOLS } from './data/protocols.js';
import { SUPPLY_PRESETS } from './logic.js';
import { t } from './i18n.js';

const ref = (...path) => doc(db, ...path);

// 서버 시각(serverTimestamp)이 확정되기 전에는 비어 있으므로, 그동안은 휴대폰 시각으로 추정한다.
const ESTIMATE = { serverTimestamps: 'estimate' };

// ---------- 실시간 구독 ----------

export function watchDoc(path, cb, onError) {
  return onSnapshot(ref(...path), (snap) => cb(snap.exists() ? { id: snap.id, ...snap.data(ESTIMATE) } : null, snap), onError);
}

export function watchCollection(name, cb, onError, ...constraints) {
  const q = constraints.length ? query(collection(db, name), ...constraints) : collection(db, name);
  return onSnapshot(q, (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...d.data(ESTIMATE) })), snap), onError);
}

export const watchMembers = (cb, onError) => watchCollection('members', cb, onError);
export const watchEmergency = (cb, onError) => watchDoc(['emergency', 'current'], cb, onError);
export const watchMeetingPoints = (cb, onError) => watchCollection('meetingPoints', cb, onError);
export const watchProtocols = (cb, onError) => watchCollection('protocols', cb, onError);
export const watchChecklist = (uid, cb, onError) => watchDoc(['checklists', uid], cb, onError);
export const watchMeetingLogs = (cb, onError) => watchCollection('meetingLogs', cb, onError, orderBy('clientAt', 'desc'), limit(100));
export const watchEmergencyLog = (cb, onError) => watchCollection('emergencyLog', cb, onError, orderBy('at', 'desc'), limit(30));

export function watchCheckins(uid, cb, onError, max = 100) {
  return watchCollection('checkins', cb, onError, where('uid', '==', uid), orderBy('clientAt', 'desc'), limit(max));
}

/** 컬렉션 전체를 한 번 읽는다 (관리자 화면용: profiles, checklists) */
export async function listCollection(name) {
  const snap = await getDocs(collection(db, name));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export async function getProfile(uid) {
  const snap = await getDoc(ref('profiles', uid));
  return snap.exists() ? snap.data() : {};
}

// ---------- 쓰기 결과 기다리기 ----------

/**
 * 오프라인이면 Firestore 쓰기는 서버 응답이 올 때까지 끝나지 않는다(휴대폰에 보관됐다가 자동 전송).
 * 화면이 멈추지 않도록 잠깐만 기다리고, 그 안에 안 끝나면 "전송 대기"로 알린다.
 * @returns {Promise<'sent'|'queued'>}
 */
export function commitWithTimeout(promise, ms = 5000) {
  return Promise.race([
    promise.then(() => 'sent'),
    new Promise((resolve) => setTimeout(() => resolve('queued'), ms)),
  ]);
}

// ---------- 생존신고·체크포인트 ----------

/**
 * @param {object} me 내 members 문서
 * @param {'safe'|'help'|'checkpoint'} type
 * @param {{lat,lng,accuracy}|null} pos
 */
/** 휴대폰 배터리 잔량(%) — 가족이 누구 휴대폰이 곧 꺼질지 안다. 못 읽으면 null. */
export async function batteryLevel() {
  try {
    if (!navigator.getBattery) return null;
    const b = await navigator.getBattery();
    return Math.round(b.level * 100);
  } catch {
    return null;
  }
}

export function checkIn(me, type, pos, note = '', emergency = null, battery = null) {
  const clientAt = Timestamp.now();
  const loc = {
    lat: pos?.lat ?? null,
    lng: pos?.lng ?? null,
    accuracy: pos?.accuracy ?? null,
    battery: Number.isInteger(battery) ? Math.max(0, Math.min(100, battery)) : null,
  };
  const batch = writeBatch(db);
  const record = {
    uid: me.id,
    name: me.name,
    type,
    ...loc,
    note: note.slice(0, 300),
    at: serverTimestamp(),
    clientAt,
  };
  if (emergency?.active && emergency.declaredAt) record.emergencyAt = emergency.declaredAt;
  batch.set(doc(collection(db, 'checkins')), record);
  batch.update(ref('members', me.id), {
    last: { type, ...loc, note: note.slice(0, 300), at: serverTimestamp(), clientAt },
    updatedAt: serverTimestamp(),
  });
  return commitWithTimeout(batch.commit());
}

/**
 * 도움 요청 신고를 저장한 뒤 부른다: 알림 서버가 관련 가족(관리자, 나를 볼 수 있는 가족, 내가 볼 수 있는 가족)의
 * 휴대폰에 위치와 메모를 알리고, 문자 보낼 번호를 돌려준다. 실패해도 신고는 이미 저장됐다.
 * @returns {Promise<{sent?:number, recipients?:{name:string, phone:string}[], error?:string}>}
 */
export async function notifyHelp() {
  try {
    return await callWorker('/help');
  } catch (err) {
    return { error: err.message };
  }
}

// ---------- 비상선언 ----------

/** level: 'alert'(2급) | 'real'(1급) */
export async function declareEmergency(me, { type, message, level }) {
  const isAdmin = me.role === 'admin';
  const batch = writeBatch(db);
  const data = {
    active: true,
    level,
    type,
    message: message.slice(0, 500),
    declaredBy: me.id,
    declaredByName: me.name,
    declaredAt: serverTimestamp(),
    // 1급 비상이면 지금부터 집합 시간을 센다. 2급이면 아직 세지 않는다.
    realAt: level === 'real' ? serverTimestamp() : deleteField(),
    // 지난 비상의 "1급 격상" 기록은 지운다.
    escalatedBy: deleteField(),
    escalatedByName: deleteField(),
  };
  // merge: 이전 해제 기록과 알림 발송 표시는 남겨 둔다.
  batch.set(ref('emergency', 'current'), data, { merge: true });
  if (!isAdmin) {
    // 일반 가족은 선언권 1회를 같은 일괄 쓰기에서 차감해야 규칙을 통과한다.
    batch.update(ref('members', me.id), { declareCredits: me.declareCredits - 1 });
  }
  batch.set(doc(collection(db, 'emergencyLog')), {
    action: 'declare', level, type, message: data.message, by: me.id, byName: me.name, at: serverTimestamp(),
  });
  await batch.commit();
  return notifyFamily();
}

/** 2급 → 1급 격상. 이때부터 집합 시간을 센다. 일반 가족은 선언권 1회를 쓴다. */
export async function escalateEmergency(me, current, message = '') {
  const isAdmin = me.role === 'admin';
  const batch = writeBatch(db);
  const data = {
    level: 'real',
    realAt: serverTimestamp(),
    escalatedBy: me.id,
    escalatedByName: me.name,
  };
  if (message.trim()) data.message = message.trim().slice(0, 500);
  batch.update(ref('emergency', 'current'), data);
  if (!isAdmin) batch.update(ref('members', me.id), { declareCredits: me.declareCredits - 1 });
  batch.set(doc(collection(db, 'emergencyLog')), {
    action: 'escalate', level: 'real', type: current.type, message: data.message || '', by: me.id, byName: me.name, at: serverTimestamp(),
  });
  await batch.commit();
  return notifyFamily();
}

export async function endEmergency(me) {
  const batch = writeBatch(db);
  batch.set(ref('emergency', 'current'), {
    active: false,
    endedBy: me.id,
    endedByName: me.name,
    endedAt: serverTimestamp(),
  }, { merge: true });
  batch.set(doc(collection(db, 'emergencyLog')), {
    action: 'end', by: me.id, byName: me.name, at: serverTimestamp(),
  });
  await batch.commit();
  return notifyFamily();
}

/** Worker에 알림 발송을 요청한다. 실패해도 선언 자체는 이미 저장됐다. */
export async function notifyFamily() {
  try {
    return await callWorker('/notify');
  } catch (err) {
    return { error: err.message };
  }
}

// ---------- 테스트 알람 ----------
// 관리자가 보내면 가족 모두의 휴대폰에서 "테스트" 경보가 울리고, 각자 확인을 누르면 기록이 남는다.

export const watchLatestAlarmTest = (cb, onError) => watchCollection('alarmTests', (list) => cb(list[0] || null), onError, orderBy('at', 'desc'), limit(1));
export const watchAlarmTests = (cb, onError, max = 100) => watchCollection('alarmTests', cb, onError, orderBy('at', 'desc'), limit(max));
export const watchAlarmAcks = (testId, cb, onError) => watchCollection(`alarmTests/${testId}/acks`, cb, onError);

/** sound: 'alert'(2급) | 'real'(1급), targets: 받을 사람 uid 목록 */
export async function sendAlarmTest(me, { message, sound, targets }) {
  const testRef = doc(collection(db, 'alarmTests'));
  await setDoc(testRef, {
    by: me.id, byName: me.name, at: serverTimestamp(), message: message.slice(0, 200), sound, targets: targets.slice(0, 25),
  });
  try {
    return { id: testRef.id, ...(await callWorker('/drill', { id: testRef.id })) };
  } catch (err) {
    // 알림 서버가 없어도 사이트를 열어 둔 휴대폰에서는 울린다.
    return { id: testRef.id, error: err.message };
  }
}

export function ackAlarmTest(me, testId) {
  return setDoc(ref('alarmTests', testId, 'acks', me.id), { name: me.name, at: serverTimestamp() });
}

export async function hasAckedAlarmTest(uid, testId) {
  try {
    return (await getDoc(ref('alarmTests', testId, 'acks', uid))).exists();
  } catch {
    return false;
  }
}

// ---------- 정부 긴급재난문자 자동 경보 ----------
// 알림 서버가 1분마다 재난문자를 확인해 전쟁·지진 같은 위급 문자면 1급 비상을 자동 선언한다.
// 설정(config/disasterAlerts)은 관리자가 바꾸고, 확인 결과(config/disasterFeed)는 알림 서버가 남긴다.

export const watchDisasterSettings = (cb, onError) => watchDoc(['config', 'disasterAlerts'], cb, onError);
export const watchDisasterFeed = (cb, onError) => watchDoc(['config', 'disasterFeed'], cb, onError);
// 우리 지역에 온 최근 재난문자 (알림 서버가 남긴다, 가족 모두 본다)
export const watchDisasterRecent = (cb, onError) => watchDoc(['config', 'disasterRecent'], cb, onError);

export async function saveDisasterSettings(me, { enabled, regions, level2 }) {
  const batch = writeBatch(db);
  batch.set(ref('config', 'disasterAlerts'), {
    enabled, level2, regions: regions.slice(0, 20), updatedBy: me.id, updatedByName: me.name, updatedAt: serverTimestamp(),
  });
  addAudit(batch, 'disaster.settings', {
    detail: `${enabled ? '켬' : '끔'} · ${regions.length ? regions.join(', ') : '전국'}${level2 ? ' · 2급 알림 받음' : ''}`,
  });
  await batch.commit();
}

// ---------- 관리 기록 ----------

// 관리 기록에 남길 "누가". 앱이 로그인한 가족 정보를 넣어 준다.
let actor = null;
export function setActor(me) {
  actor = me;
}

/** 같은 일괄 쓰기에 관리 기록 한 줄을 더한다. 관리자가 아니면 남기지 않는다(규칙상 거부되므로). */
function addAudit(batch, action, { target = '', targetName = '', detail = '' } = {}) {
  if (actor?.role !== 'admin') return;
  batch.set(doc(collection(db, 'auditLog')), {
    action,
    target: String(target).slice(0, 128),
    targetName: String(targetName).slice(0, 60),
    detail: String(detail).slice(0, 300),
    by: actor.id,
    byName: actor.name,
    at: serverTimestamp(),
  });
}

/** 단독 관리 기록 (Worker 작업처럼 Firestore 쓰기가 따로 없는 경우) */
export async function audit(action, info) {
  const batch = writeBatch(db);
  addAudit(batch, action, info);
  await batch.commit().catch((err) => console.warn('관리 기록 실패', err));
}

// 관리자 기록 화면용 구독
export const watchAuditLog = (cb, onError, max = 300) => watchCollection('auditLog', cb, onError, orderBy('at', 'desc'), limit(max));
export const watchAllCheckins = (cb, onError, max = 500) => watchCollection('checkins', cb, onError, orderBy('clientAt', 'desc'), limit(max));
export const watchAllEmergencyLog = (cb, onError, max = 200) => watchCollection('emergencyLog', cb, onError, orderBy('at', 'desc'), limit(max));
export const watchAllMeetingLogs = (cb, onError, max = 300) => watchCollection('meetingLogs', cb, onError, orderBy('clientAt', 'desc'), limit(max));

// ---------- 가족 관리 (관리자) ----------

const MEMBER_FIELDS = ['name', 'phone', 'role', 'active', 'declareCredits', 'order', 'links'];
const PROFILE_FIELDS = ['gender', 'birthDate', 'bloodType', 'email', 'address', 'medical', 'emergencyContact'];

function pick(obj, keys) {
  const out = {};
  for (const k of keys) if (obj[k] !== undefined) out[k] = obj[k];
  return out;
}

// ---------- 접속 코드와 이름 목록 ----------
// public/gates: 관문 계정(코드마다 하나)과 세대. access/family, access/admin: 이름 목록과 각 사람 계정의 로그인 열쇠.

export async function getGates() {
  const snap = await getDoc(ref('public', 'gates'));
  return snap.exists() ? snap.data() : null;
}

export async function getAccess(kind) {
  const snap = await getDoc(ref('access', kind));
  return snap.exists() ? (snap.data().people || []) : [];
}

const accessKind = (role) => (role === 'admin' ? 'admin' : 'family');

/** 이름 목록 갱신: 한 사람을 빼거나(entry 없음) 넣거나 바꾼다. */
async function accessUpdate(batch, kind, uid, entry) {
  const people = (await getAccess(kind)).filter((p) => p.uid !== uid);
  if (entry) people.push(entry);
  batch.set(ref('access', kind), { people, updatedAt: serverTimestamp() });
}

/**
 * 접속 코드로 관문 계정에 로그인한다. 어느 코드였는지 돌려준다: 'family' | 'admin' | 'backup'
 * 코드는 알림 서버가 확인한다. 같은 인터넷 주소나 기기에서 3번 틀리면 하루 동안 막힌다.
 * 틀리면 err.left(남은 횟수), 막혔으면 err.lockedUntil(풀리는 시각)이 붙는다.
 */
export async function loginWithCode(code) {
  let r;
  try {
    r = await callWorker('/login', { code, device: deviceId() }, { anonymous: true });
  } catch (err) {
    if (err.status === 401) throw Object.assign(new Error(t('접속 코드가 맞지 않습니다.')), { left: err.data?.left });
    if (err.status === 429 && err.data?.lockedUntil) throw Object.assign(new Error(err.message), { lockedUntil: new Date(err.data.lockedUntil) });
    if (err.status === 409) throw new Error(t('아직 초기 설정이 안 됐습니다.'));
    throw err;
  }
  await signInWithToken(r.token);
  return r.kind;
}

/** 이름을 고르면 관문 계정에서 그 사람 계정으로 바꿔 로그인한다. */
export async function loginAsPerson(person) {
  await logout();
  await signIn(person.email, person.key);
}

/** 다른 관문 계정 중 이 코드로 열리는 것이 있는지 (코드끼리 겹치지 않게). 알림 서버가 확인한다. */
async function codeInUse(code, except) {
  return (await callWorker('/code/check', { code, except })).inUse;
}

let setupRunning = null;

/** 처음 설정이 진행 중이면 끝날 때까지 기다린다 (첫 관리자로 로그인한 직후, 관문 문서가 저장되기 전일 수 있다). */
export async function setupSettled() {
  await setupRunning?.catch(() => {});
}

/**
 * 처음 설정: 관문 계정 3개와 첫 관리자 계정을 만들고, 첫 관리자로 로그인한다.
 * 예전 방식으로 저장된 가족·관리자는 새 세대가 시작되면서 자동으로 접근이 막힌다.
 */
export function setupAccess(form) {
  setupRunning = runSetup(form);
  return setupRunning.finally(() => { setupRunning = null; });
}

async function runSetup({ name, phone, family, admin, backup }) {
  const gen = Math.floor(Date.now() / 1000);
  const gate = {};
  for (const [kind, code] of [['family', family], ['admin', admin], ['backup', backup]]) {
    const email = newAccountEmail(`g-${kind}`);
    gate[kind] = { email, uid: await createAccount(email, code) };
  }
  const person = { email: newAccountEmail('p'), key: randomToken(28), name };
  person.uid = await createAccount(person.email, person.key);
  await signIn(person.email, person.key);

  const batch = writeBatch(db);
  batch.set(ref('members', person.uid), {
    name, phone, role: 'admin', active: true, declareCredits: 1, order: 0, last: null, gen,
    createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
  });
  // 관문 계정 이메일은 공개 문서에 적지 않는다 (알림 서버가 uid로 찾아 코드를 확인한다).
  batch.set(ref('public', 'gates'), {
    gen,
    familyUid: gate.family.uid,
    adminUid: gate.admin.uid,
    backupUid: gate.backup.uid,
    setupBy: person.uid, at: serverTimestamp(),
  });
  batch.set(ref('access', 'admin'), { people: [person], updatedAt: serverTimestamp() });
  batch.set(ref('access', 'family'), { people: [], updatedAt: serverTimestamp() });
  try {
    await batch.commit();
  } catch (err) {
    await logout();
    if (err.code === 'permission-denied') throw new Error(t('이미 초기 설정이 끝났습니다.'));
    throw err;
  }
}

/**
 * 접속 코드 바꾸기: 새 관문 계정을 만들어 바꿔 끼운다 (예전 코드를 몰라도 된다).
 * 관리자는 세 코드 모두, 백업 코드로 들어온 사람은 관리자 코드만 바꿀 수 있다 (규칙이 막는다).
 * 새 관문 계정의 이메일은 어디에도 적지 않는다.
 */
export async function changeAccessCode(kind, code) {
  const gates = await getGates();
  const clash = await codeInUse(code, kind);
  if (clash) throw new Error(t('다른 접속 코드와 같습니다. 다른 코드를 쓰세요.'));
  const uid = await createAccount(newAccountEmail(`g-${kind}`), code);
  const batch = writeBatch(db);
  batch.set(ref('public', 'gates'), { [`${kind}Uid`]: uid, at: serverTimestamp() }, { merge: true });
  if (auth.currentUser?.uid === gates.backupUid) {
    batch.set(doc(collection(db, 'auditLog')), {
      action: 'backup.adminCode', detail: '백업 코드로 관리자 코드를 바꿈', by: auth.currentUser.uid, byName: '백업 코드', at: serverTimestamp(),
    });
  } else {
    addAudit(batch, 'code.change', { targetName: kind, detail: `${kind} 코드 변경` });
  }
  await batch.commit();
}

/**
 * 코드가 새어 나갔을 때: 그 코드로 들어오는 사람들(가족 또는 관리자)의 로그인 열쇠를 모두 바꾼다.
 * 예전 열쇠로 들어와 있던 기기는 모두 로그아웃되고, 새 코드로 다시 들어와 이름을 고른다.
 * 나도 그 목록에 있으면 새 열쇠로 바로 다시 로그인한다.
 */
export async function rekeyAccess(kind) {
  const r = await callWorker('/admin/rekey', { kind });
  if (r.self) await signIn(r.self.email, r.self.key);
  return r;
}

/** 접속 코드를 3번 틀려 잠긴 기기·인터넷 주소 (관리자) */
export const watchLoginLocks = (cb, onError) => watchCollection('loginLocks', cb, onError);

export async function clearLoginLock(lock) {
  const batch = writeBatch(db);
  batch.delete(ref('loginLocks', lock.id));
  addAudit(batch, 'lock.clear', { targetName: lock.label || '', detail: lock.kind === 'device' ? '기기 잠금 해제' : '인터넷 주소 잠금 해제' });
  await batch.commit();
}

/** 백업 코드로 들어와서 관리자를 새로 추가한다 (관리자가 아무도 없거나 연락이 안 될 때). */
export async function backupAddAdmin({ name, phone }) {
  const gates = await getGates();
  const person = { email: newAccountEmail('p'), key: randomToken(28), name };
  person.uid = await createAccount(person.email, person.key);
  const batch = writeBatch(db);
  batch.set(ref('members', person.uid), {
    name, phone, role: 'admin', active: true, declareCredits: 1, order: 0, last: null, gen: gates.gen,
    createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
  });
  await accessUpdate(batch, 'admin', person.uid, person);
  batch.set(doc(collection(db, 'auditLog')), {
    action: 'backup.adminAdd', targetName: name, detail: '백업 코드로 관리자 추가', by: auth.currentUser.uid, byName: '백업 코드', at: serverTimestamp(),
  });
  await batch.commit();
}

// ---------- 가족 관리 (관리자) ----------

/** 새 가족: 무작위 열쇠로 계정을 만들고 이름 목록에 넣는다. 본인은 가족 코드(관리자면 관리자 코드)로 들어온다. */
export async function createMember(form, gen) {
  const person = { email: newAccountEmail('p'), key: randomToken(28), name: form.name };
  const uid = await createAccount(person.email, person.key);
  person.uid = uid;
  const batch = writeBatch(db);
  batch.set(ref('members', uid), {
    ...pick(form, MEMBER_FIELDS),
    last: null,
    gen,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  batch.set(ref('profiles', uid), { ...pick(form, PROFILE_FIELDS), updatedAt: serverTimestamp() });
  await accessUpdate(batch, accessKind(form.role), uid, person);
  addAudit(batch, 'member.create', { target: uid, targetName: form.name, detail: form.role === 'admin' ? '관리자' : '가족' });
  await batch.commit();
  return uid;
}

const CHANGE_LABELS = { role: '권한', active: '접근', declareCredits: '선언권', name: '이름', phone: '전화번호', links: '볼 수 있는 가족' };

export async function updateMember(uid, form, targetName = form.name, before = null) {
  const batch = writeBatch(db);
  // 이름이나 권한이 바뀌면 로그인 이름 목록도 옮긴다 (가족 목록 ↔ 관리자 목록).
  if (before && (('name' in form && form.name !== before.name) || ('role' in form && form.role !== before.role))) {
    const fromKind = accessKind(before.role);
    const toKind = accessKind(form.role ?? before.role);
    const entry = (await getAccess(fromKind)).find((p) => p.uid === uid);
    if (entry) {
      const moved = { ...entry, name: form.name ?? before.name };
      if (fromKind !== toKind) await accessUpdate(batch, fromKind, uid, null);
      await accessUpdate(batch, toKind, uid, moved);
    }
  }
  batch.set(ref('members', uid), { ...pick(form, MEMBER_FIELDS), updatedAt: serverTimestamp() }, { merge: true });
  batch.set(ref('profiles', uid), { ...pick(form, PROFILE_FIELDS), updatedAt: serverTimestamp() }, { merge: true });
  let action = 'member.update';
  if (Object.keys(form).length === 1 && 'active' in form) action = form.active ? 'member.activate' : 'member.deactivate';
  else if (Object.keys(form).length === 1 && 'declareCredits' in form) action = 'member.credit';
  const changed = Object.keys(form).filter((k) => CHANGE_LABELS[k]).map((k) => CHANGE_LABELS[k]);
  addAudit(batch, action, { target: uid, targetName, detail: changed.length ? `${changed.join(', ')} 저장` : '개인정보 저장' });
  await batch.commit();
}

/** 본인이 바꿀 수 있는 정보: 전화번호(공개)와 민감 정보(본인·관리자만) */
export async function updateMyInfo(uid, form) {
  const batch = writeBatch(db);
  batch.update(ref('members', uid), { phone: form.phone, updatedAt: serverTimestamp() });
  batch.set(ref('profiles', uid), { ...pick(form, PROFILE_FIELDS), updatedAt: serverTimestamp() }, { merge: true });
  await batch.commit();
}

/** 가족 삭제: 데이터 접근을 먼저 끊고(members 삭제, 이름 목록에서 뺌), 로그인 계정은 Worker가 지운다. */
export async function deleteMember(uid, name, role = 'member') {
  const batch = writeBatch(db);
  batch.delete(ref('members', uid));
  await accessUpdate(batch, accessKind(role), uid, null);
  batch.delete(ref('profiles', uid));
  batch.delete(ref('checklists', uid));
  addAudit(batch, 'member.delete', { target: uid, targetName: name });
  await batch.commit();
  try {
    await callWorker('/admin/user', { action: 'delete', uid });
    return { accountDeleted: true };
  } catch (err) {
    return { accountDeleted: false, error: err.message };
  }
}

/** 예전 방식(세대가 다른) 계정 문서 정리. 이미 접근이 막혀 있어 지워도 데이터 접근에는 영향이 없다. */
export async function deleteLegacyMembers(list) {
  const batch = writeBatch(db);
  for (const m of list) {
    batch.delete(ref('members', m.id));
    batch.delete(ref('profiles', m.id));
  }
  addAudit(batch, 'member.legacyCleanup', { detail: `${list.length}개` });
  await batch.commit();
}

export async function deleteCheckin(c) {
  const batch = writeBatch(db);
  batch.delete(ref('checkins', c.id));
  addAudit(batch, 'checkin.delete', { target: c.uid, targetName: c.name, detail: '신고 기록 삭제' });
  await batch.commit();
}

// ---------- 집합장소 ----------

export async function saveMeetingPoint(rank, data) {
  const batch = writeBatch(db);
  batch.set(ref('meetingPoints', String(rank)), {
    rank: Number(rank),
    name: data.name,
    address: data.address || '',
    lat: data.lat ?? null,
    lng: data.lng ?? null,
    offsetHours: Number(data.offsetHours) || 0,
    waitMinutes: Number(data.waitMinutes) || 0,
    overrideAt: data.overrideAt ? Timestamp.fromDate(data.overrideAt) : null,
    note: data.note || '',
    updatedAt: serverTimestamp(),
  });
  addAudit(batch, 'meet.save', { target: String(rank), targetName: `${rank}순위 ${data.name}`, detail: data.overrideAt ? '도착 시각 직접 지정' : '' });
  await batch.commit();
}

export async function deleteMeetingPoint(rank, name) {
  const batch = writeBatch(db);
  batch.delete(ref('meetingPoints', String(rank)));
  addAudit(batch, 'meet.delete', { target: String(rank), targetName: `${rank}순위 ${name || ''}` });
  await batch.commit();
}

// 가족 전체가 보는 게시판이므로 위치 좌표는 남기지 않는다 (지정되지 않은 가족의 위치가 보이지 않게).
export function addMeetingLog(me, rank, message) {
  const batch = writeBatch(db);
  batch.set(doc(collection(db, 'meetingLogs')), {
    rank: Number(rank),
    uid: me.id,
    name: me.name,
    message: message.slice(0, 300),
    at: serverTimestamp(),
    clientAt: Timestamp.now(),
  });
  return commitWithTimeout(batch.commit());
}

export function deleteMeetingLog(id) {
  return deleteDoc(ref('meetingLogs', id));
}

// ---------- 프로토콜 ----------

export async function saveProtocol(id, data) {
  const batch = writeBatch(db);
  batch.set(ref('protocols', id), {
    title: data.title,
    icon: data.icon || '📄',
    order: Number(data.order) || 99,
    summary: data.summary || '',
    keyPoints: data.keyPoints || [],
    steps: data.steps,
    checklist: data.checklist,
    updatedAt: serverTimestamp(),
  });
  addAudit(batch, 'protocol.save', { target: id, targetName: data.title });
  await batch.commit();
}

export async function deleteProtocol(id, title) {
  const batch = writeBatch(db);
  batch.delete(ref('protocols', id));
  addAudit(batch, 'protocol.delete', { target: id, targetName: title });
  await batch.commit();
}

/** 내장 기본 프로토콜을 서버에 올린다. 이미 있는 것은 건드리지 않는다. */
export async function seedProtocols() {
  const existing = new Set((await getDocs(collection(db, 'protocols'))).docs.map((d) => d.id));
  const batch = writeBatch(db);
  let count = 0;
  for (const p of DEFAULT_PROTOCOLS) {
    if (existing.has(p.id)) continue;
    const { id, ...rest } = p;
    batch.set(ref('protocols', id), { ...rest, updatedAt: serverTimestamp() });
    count++;
  }
  if (count) {
    addAudit(batch, 'protocol.seed', { detail: `기본 프로토콜 ${count}개 불러옴` });
    await batch.commit();
  }
  return count;
}

export function setChecklistItem(uid, key, checked) {
  return setDoc(ref('checklists', uid), {
    done: { [key]: checked ? true : deleteField() },
    updatedAt: serverTimestamp(),
  }, { merge: true });
}

export async function getChecklist(uid) {
  const snap = await getDoc(ref('checklists', uid));
  return snap.exists() ? snap.data().done || {} : {};
}

// ---------- 가족 지정 연락처 ----------

export const watchContacts = (cb, onError) => watchCollection('contacts', cb, onError);

export async function saveContact(id, data) {
  const batch = writeBatch(db);
  const target = id ? ref('contacts', id) : doc(collection(db, 'contacts'));
  batch.set(target, {
    name: data.name,
    phone: data.phone,
    category: data.category || '',
    note: data.note || '',
    order: Number(data.order) || 0,
    updatedAt: serverTimestamp(),
  });
  addAudit(batch, 'contact.save', { target: target.id, targetName: data.name });
  await batch.commit();
}

export async function deleteContact(id, name) {
  const batch = writeBatch(db);
  batch.delete(ref('contacts', id));
  addAudit(batch, 'contact.delete', { target: id, targetName: name });
  await batch.commit();
}

// ---------- 비상 물품 (가족 전체가 보고 고친다) ----------

export const watchSupplies = (cb, onError) => watchCollection('supplies', cb, onError);

export function saveSupply(me, id, { name, qty = '', where = '', note = '', expiresAt = null }) {
  const target = id ? ref('supplies', id) : doc(collection(db, 'supplies'));
  return setDoc(target, {
    name: name.slice(0, 60), qty: qty.slice(0, 40), where: where.slice(0, 60), note: note.slice(0, 200),
    expiresAt: expiresAt ? Timestamp.fromDate(expiresAt) : null,
    by: me.id, byName: me.name, updatedAt: serverTimestamp(),
  });
}

export function deleteSupply(id) {
  return deleteDoc(ref('supplies', id));
}

/** 기본 물품 목록을 넣는다 (수량·기한은 나중에 채운다). */
export async function seedSupplies(me) {
  const batch = writeBatch(db);
  for (const p of SUPPLY_PRESETS) {
    batch.set(doc(collection(db, 'supplies')), { ...p, note: '', expiresAt: null, by: me.id, byName: me.name, updatedAt: serverTimestamp() });
  }
  await batch.commit();
}

// ---------- 알림 토큰 ----------

// 사람마다 기기 3칸(pushTokens/{uid}_0~2). 같은 기기는 같은 칸을 다시 쓰고, 칸이 다 차면 가장 오래된 칸을 쓴다.
const TOKEN_SLOTS = 3;

async function myTokenDocs(uid) {
  const snap = await getDocs(query(collection(db, 'pushTokens'), where('uid', '==', uid)));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export async function savePushToken(uid, token) {
  const mine = await myTokenDocs(uid).catch(() => []);
  const slots = Array.from({ length: TOKEN_SLOTS }, (_, i) => `${uid}_${i}`);
  const same = mine.find((d) => slots.includes(d.id) && d.token === token);
  const free = slots.find((id) => !mine.some((d) => d.id === id));
  const oldest = mine.filter((d) => slots.includes(d.id))
    .sort((a, b) => (a.at?.toMillis?.() || 0) - (b.at?.toMillis?.() || 0))[0];
  const id = same?.id || free || oldest?.id || slots[0];
  await setDoc(ref('pushTokens', id), {
    uid,
    token,
    platform: navigator.userAgent.slice(0, 200),
    at: serverTimestamp(),
  });
  // 예전 방식 문서(id 가 토큰)는 정리한다
  await Promise.all(mine.filter((d) => !slots.includes(d.id)).map((d) => deleteDoc(ref('pushTokens', d.id)).catch(() => {})));
}

/** 이 기기 토큰을 지운다 (로그아웃할 때). */
export async function deletePushToken(token) {
  const uid = auth.currentUser?.uid;
  const mine = uid ? await myTokenDocs(uid).catch(() => []) : [];
  const ids = new Set([token, ...mine.filter((d) => d.token === token || d.id === token).map((d) => d.id)]);
  await Promise.all([...ids].map((id) => deleteDoc(ref('pushTokens', id)).catch(() => {})));
}
