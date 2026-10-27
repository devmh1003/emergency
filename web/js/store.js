// Firestore 읽기·쓰기. 권한 검사는 firestore.rules 가 하고, 여기서는 규칙에 맞는 모양으로 쓴다.
import {
  doc, collection, getDoc, getDocs, setDoc, deleteDoc, onSnapshot, query, where, orderBy, limit,
  writeBatch, serverTimestamp, Timestamp, deleteField,
} from 'https://www.gstatic.com/firebasejs/13.0.0/firebase-firestore.js';
import { db, createAccountForOther, createOwnAccount, callWorker } from './firebase.js';
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

// ---------- 가족 관리 (관리자) ----------

const MEMBER_FIELDS = ['name', 'phone', 'role', 'active', 'declareCredits', 'order'];
const PROFILE_FIELDS = ['gender', 'birthDate', 'bloodType', 'email', 'address', 'medical', 'emergencyContact'];

function pick(obj, keys) {
  const out = {};
  for (const k of keys) if (obj[k] !== undefined) out[k] = obj[k];
  return out;
}

export async function createMember(form) {
  const uid = await createAccountForOther(form.email, form.password);
  const batch = writeBatch(db);
  batch.set(ref('members', uid), {
    ...pick(form, MEMBER_FIELDS),
    last: null,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  batch.set(ref('profiles', uid), { ...pick(form, PROFILE_FIELDS), updatedAt: serverTimestamp() });
  await batch.commit();
  return uid;
}

export async function updateMember(uid, form) {
  const batch = writeBatch(db);
  batch.set(ref('members', uid), { ...pick(form, MEMBER_FIELDS), updatedAt: serverTimestamp() }, { merge: true });
  batch.set(ref('profiles', uid), { ...pick(form, PROFILE_FIELDS), updatedAt: serverTimestamp() }, { merge: true });
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
export async function deleteMember(uid) {
  const batch = writeBatch(db);
  batch.delete(ref('members', uid));
  batch.delete(ref('profiles', uid));
  batch.delete(ref('checklists', uid));
  await batch.commit();
  try {
    await callWorker('/admin/user', { action: 'delete', uid });
    return { accountDeleted: true };
  } catch (err) {
    return { accountDeleted: false, error: err.message };
  }
}

export function setMemberPassword(uid, password) {
  return callWorker('/admin/user', { action: 'setPassword', uid, password });
}

export async function deleteCheckin(id) {
  await deleteDoc(ref('checkins', id));
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
  await setDoc(ref('profiles', uid), { email: form.email, updatedAt: serverTimestamp() });
}

export async function setupFirstAdmin(form) {
  const cred = await createOwnAccount(form.email, form.password);
  await registerFirstAdmin(cred.user.uid, form);
}

// ---------- 집합장소 ----------

export function saveMeetingPoint(rank, data) {
  return setDoc(ref('meetingPoints', String(rank)), {
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
}

export function deleteMeetingPoint(rank) {
  return deleteDoc(ref('meetingPoints', String(rank)));
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

export function saveProtocol(id, data) {
  return setDoc(ref('protocols', id), {
    title: data.title,
    icon: data.icon || '📄',
    order: Number(data.order) || 99,
    summary: data.summary || '',
    steps: data.steps,
    checklist: data.checklist,
    updatedAt: serverTimestamp(),
  });
}

export function deleteProtocol(id) {
  return deleteDoc(ref('protocols', id));
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
  if (count) await batch.commit();
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
