// Firestore 읽기·쓰기. 권한 검사는 firestore.rules 가 하고, 여기서는 규칙에 맞는 모양으로 쓴다.
import {
  doc, collection, getDoc, getDocs, setDoc, deleteDoc, onSnapshot, query, where, orderBy, limit,
  writeBatch, serverTimestamp, Timestamp, deleteField,
} from 'https://www.gstatic.com/firebasejs/13.0.0/firebase-firestore.js';
import { db, createAccountForOther, callWorker } from './firebase.js';
import { DEFAULT_PROTOCOLS } from './data/protocols.js';

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
export function checkIn(me, type, pos, note = '', emergency = null) {
  const clientAt = Timestamp.now();
  const loc = {
    lat: pos?.lat ?? null,
    lng: pos?.lng ?? null,
    accuracy: pos?.accuracy ?? null,
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

// ---------- 비상선언 ----------

export async function declareEmergency(me, { type, message }) {
  const isAdmin = me.role === 'admin';
  const batch = writeBatch(db);
  const data = {
    active: true,
    type,
    message: message.slice(0, 500),
    declaredBy: me.id,
    declaredByName: me.name,
    declaredAt: serverTimestamp(),
  };
  // merge: 이전 해제 기록과 알림 발송 표시는 남겨 둔다.
  batch.set(ref('emergency', 'current'), data, { merge: true });
  if (!isAdmin) {
    // 일반 가족은 선언권 1회를 같은 일괄 쓰기에서 차감해야 규칙을 통과한다.
    batch.update(ref('members', me.id), { declareCredits: me.declareCredits - 1 });
  }
  batch.set(doc(collection(db, 'emergencyLog')), {
    action: 'declare', type, message: data.message, by: me.id, byName: me.name, at: serverTimestamp(),
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

export async function createMember(form) {
  const uid = await createAccountForOther(form.loginId, form.code);
  const batch = writeBatch(db);
  batch.set(ref('members', uid), {
    ...pick(form, MEMBER_FIELDS),
    last: null,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  batch.set(ref('profiles', uid), { loginId: form.loginId, ...pick(form, PROFILE_FIELDS), updatedAt: serverTimestamp() });
  addAudit(batch, 'member.create', { target: uid, targetName: form.name, detail: `아이디 ${form.loginId} · ${form.role === 'admin' ? '관리자' : '가족'}` });
  await batch.commit();
  return uid;
}

const CHANGE_LABELS = { role: '권한', active: '접근', declareCredits: '선언권', name: '이름', phone: '전화번호', links: '볼 수 있는 가족' };

export async function updateMember(uid, form, targetName = form.name) {
  const batch = writeBatch(db);
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

/** 가족 삭제: 데이터 접근을 먼저 끊고(members 삭제), 로그인 계정은 Worker가 지운다. */
export async function deleteMember(uid, name) {
  const batch = writeBatch(db);
  batch.delete(ref('members', uid));
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

export async function setMemberPassword(uid, code, name) {
  const r = await callWorker('/admin/user', { action: 'setPassword', uid, password: code });
  await audit('member.resetCode', { target: uid, targetName: name, detail: '비밀코드 초기화' });
  return r;
}

export async function deleteCheckin(c) {
  const batch = writeBatch(db);
  batch.delete(ref('checkins', c.id));
  addAudit(batch, 'checkin.delete', { target: c.uid, targetName: c.name, detail: '신고 기록 삭제' });
  await batch.commit();
}

// ---------- 초기 설정 (첫 관리자) ----------

export async function isSetupDone() {
  const snap = await getDoc(ref('config', 'setup'));
  return snap.exists();
}

/** 이미 로그인한 사용자를 첫 관리자로 등록한다. */
export async function registerFirstAdmin(uid, form) {
  const batch = writeBatch(db);
  batch.set(ref('members', uid), {
    name: form.name,
    phone: form.phone,
    role: 'admin',
    active: true,
    declareCredits: 1,
    order: 0,
    last: null,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  batch.set(ref('config', 'setup'), { by: uid, at: serverTimestamp() });
  await batch.commit();
  // 관리자가 된 뒤에 쓰므로 로그인 아이디 기록도 남길 수 있다.
  const profile = { updatedAt: serverTimestamp() };
  if (form.loginId) profile.loginId = form.loginId;
  if (form.email) profile.email = form.email;
  await setDoc(ref('profiles', uid), profile);
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

export function addMeetingLog(me, rank, message, pos) {
  const batch = writeBatch(db);
  batch.set(doc(collection(db, 'meetingLogs')), {
    rank: Number(rank),
    uid: me.id,
    name: me.name,
    message: message.slice(0, 300),
    lat: pos?.lat ?? null,
    lng: pos?.lng ?? null,
    accuracy: pos?.accuracy ?? null,
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

// ---------- 알림 토큰 ----------

export function savePushToken(uid, token) {
  return setDoc(ref('pushTokens', token), {
    uid,
    platform: navigator.userAgent.slice(0, 200),
    at: serverTimestamp(),
  });
}

export function deletePushToken(token) {
  return deleteDoc(ref('pushTokens', token));
}
