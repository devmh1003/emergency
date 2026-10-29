// 가족 비상연락 Cloudflare Worker
// 비밀 키(서비스 계정)가 필요한 일만 한다:
//   POST /login        접속 코드 확인 (로그인 전). 3번 틀리면 하루 동안 막는다 (login.js)
//   POST /notify       비상 상태(2급·1급·해제)가 바뀌었으면 가족 모두에게 알림 (상태마다 한 번만)
//   POST /help         도움 요청: 관련 가족(관리자, 나를 볼 수 있는 가족, 내가 볼 수 있는 가족)에게 위치와 메모를 알림
//   POST /test-push    내 기기로 테스트 알림
//   POST /drill        관리자: 가족 전체 테스트 알람 (테스트마다 한 번만)
//   POST /code/check   관리자·백업 코드: 새 접속 코드가 다른 코드와 겹치는지
//   POST /admin/rekey  관리자·백업 코드: 코드가 새어 나갔을 때 그 코드로 들어오는 사람들의 로그인 열쇠를 모두 바꿈
//   POST /admin/user   관리자: 가족 로그인 계정 삭제 · 비밀번호 초기화
//   POST /me/delete    본인 계정 삭제 (가족 정보·신고 기록·로그인 계정)
//   (1분마다 깨어남)   정부 긴급재난문자 확인(하루 1,000번 한도 안에서 1~2분마다) → 전쟁·지진 같은 위급 문자면 1급 비상 자동 선언 (disaster.js)
//
// 환경 변수 (wrangler.toml / 비밀 변수):
//   FIREBASE_PROJECT_ID     Firebase 프로젝트 id
//   FIREBASE_API_KEY        Firebase 웹 API 키 (사이트 config.js 의 apiKey 와 같은 공개 값. 접속 코드 확인에 쓴다)
//   ALLOWED_ORIGINS         사이트 주소 (쉼표로 여러 개). 예: https://devmh1003.github.io
//   APP_URL                 알림을 누르면 열 주소. 예: https://devmh1003.github.io/emergency/
//   GOOGLE_SERVICE_ACCOUNT  (비밀) 서비스 계정 JSON 전체
//   SAFETY_DATA_KEY         (비밀) 재난안전데이터공유플랫폼 긴급재난문자 인증키. 없으면 재난문자를 확인하지 않는다.
import { verifyIdToken, getAccessToken, createCustomToken, AuthError } from './google.js';
import { Firestore, autoId } from './firestore.js';
import {
  GATE_KINDS, LOCKS, MAX_FAILS, LOCK_MS, lockKeys, lockedUntil, countAttempt, lookupEmails, updateAccount, passwordWorks,
  hiddenEmail, randomKey,
} from './login.js';
import {
  SETTINGS_PATH, STATE_PATH, RECENT_PATH, SYSTEM_ID, SYSTEM_NAME, URGENT_MS, disasterSettings, fetchDisasterMessages, pickHit,
  hasUrgentSignal, shouldCheck, kstDate, recentMessages,
} from './disaster.js';

const EMERGENCY_LABELS = {
  war: '전쟁·공습',
  cbrn: '화생방·핵',
  earthquake: '지진',
  flood: '태풍·홍수',
  tsunami: '지진해일',
  disaster: '대형재난',
  landslide: '산사태',
  fire: '화재·산불',
  heat: '폭염',
  cold: '한파·폭설',
  pandemic: '감염병',
  blackout: '정전·통신두절',
  other: '기타',
};

class HttpError extends Error {
  /** extra: 응답에 같이 보낼 값 (예: 남은 횟수, 잠금이 풀리는 시각) */
  constructor(status, message, extra = null) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

// ---------- CORS ----------

function allowedOrigin(request, env) {
  const origin = request.headers.get('Origin');
  const allowed = String(env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
  return origin && allowed.includes(origin) ? origin : null;
}

function corsHeaders(origin) {
  return origin
    ? {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type',
      'Access-Control-Max-Age': '86400',
      Vary: 'Origin',
    }
    : {};
}

function json(data, status, origin) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      ...corsHeaders(origin),
    },
  });
}

// ---------- 알림 ----------

/** 경보 단계: 'alert'(2급, 알림만) | 'real'(1급, 경보음 + 알림). level이 없는 예전 문서는 1급으로 본다. */
export function emergencyLevel(emergency) {
  return emergency?.level === 'alert' ? 'alert' : 'real';
}

/** 비상 상태마다 고유한 키. 같은 키로는 한 번만 보낸다. 2급 → 1급으로 바뀌면 키가 달라져 다시 보낸다. */
export function notificationKey(emergency) {
  if (!emergency) return null;
  if (emergency.active) {
    if (!emergency.declaredAt) return null;
    return emergencyLevel(emergency) === 'alert'
      ? `alert:${emergency.declaredAt}`
      : `real:${emergency.realAt || emergency.declaredAt}`;
  }
  return emergency.endedAt ? `off:${emergency.endedAt}` : null;
}

/** 사이트의 alarmKey 와 같은 형식("단계:밀리초"). 앱에서 확인한 경보를 사이트가 다시 띄우지 않는 데 쓴다. */
export function alarmAck(emergency) {
  const level = emergencyLevel(emergency);
  const at = Date.parse(level === 'real' ? (emergency.realAt || emergency.declaredAt) : emergency.declaredAt);
  return Number.isFinite(at) ? `${level}:${at}` : '';
}

export function notificationContent(emergency) {
  if (emergency.active) {
    const label = EMERGENCY_LABELS[emergency.type] || '비상 상황';
    if (emergencyLevel(emergency) === 'alert') {
      const who = emergency.declaredByName ? `${emergency.declaredByName}: ` : '';
      return {
        kind: 'emergency',
        level: 'alert',
        ack: alarmAck(emergency),
        title: `⚠️ 2급 비상: ${label}`,
        body: `${who}${emergency.message || '준위험 상황입니다. 생존신고를 하고 비상 배낭과 집합장소를 확인하세요.'}`.slice(0, 300),
        urgent: false,
      };
    }
    const name = emergency.escalatedByName || emergency.declaredByName;
    const who = name ? `${name}: ` : '';
    return {
      kind: 'emergency',
      level: 'real',
      ack: alarmAck(emergency),
      title: `🚨 1급 비상: ${label}`,
      body: `${who}${emergency.message || '지금 바로 생존신고를 하고 집합장소로 이동하세요.'}`.slice(0, 300),
      urgent: true,
    };
  }
  return {
    kind: 'end',
    title: '✅ 비상 해제',
    body: `${emergency.endedByName || '관리자'}님이 비상을 해제했습니다.`,
    urgent: false,
  };
}

/** 우리 안드로이드 앱이 등록한 토큰인가 (앱은 사용자 에이전트에 FamilyEmergencyApp 을 붙인다) */
export function isAppToken(token) {
  return String(token?.platform || '').includes('FamilyEmergencyApp');
}

// 웹 푸시: urgent(1급)는 사용자가 닫을 때까지 화면에 남고 길게 진동한다. 그 밖(2급·해제·테스트 알림)은 보통 알림.
// 안드로이드 앱: 데이터 메시지로 보내고, 앱이 1급이면 잠금 화면 위 전체 화면 경보를, 그 밖이면 보통 알림을 띄운다.
export function pushMessage(env, tokenDoc, { title, body, kind = 'emergency', level = '', ack = '', urgent = false }) {
  const token = tokenDoc.token || tokenDoc.id;
  if (isAppToken(tokenDoc)) {
    return {
      token,
      data: { kind, level: level || (urgent ? 'real' : 'alert'), title, body, ack },
      android: { priority: 'HIGH', ttl: '86400s' },
    };
  }
  const appUrl = env.APP_URL || '';
  return {
    token,
    notification: { title, body },
    data: { kind },
    webpush: {
      headers: { Urgency: 'high', TTL: '86400' },
      notification: {
        title,
        body,
        icon: appUrl ? `${appUrl}icons/icon-192.png` : undefined,
        tag: `family-${kind}`,
        renotify: true,
        requireInteraction: urgent,
        vibrate: urgent ? [600, 300, 600, 300, 600] : [200, 100, 200],
      },
      fcm_options: appUrl.startsWith('https://') ? { link: appUrl } : undefined,
    },
  };
}

async function sendPush(env, accessToken, tokenDoc, content) {
  const res = await fetch(`https://fcm.googleapis.com/v1/projects/${env.FIREBASE_PROJECT_ID}/messages:send`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: pushMessage(env, tokenDoc, content) }),
  });
  if (res.ok) return { ok: true };
  const err = await res.json().catch(() => ({}));
  const code = err?.error?.details?.find((d) => d.errorCode)?.errorCode || err?.error?.status;
  // 앱이 지워졌거나 토큰이 바뀐 기기
  const stale = res.status === 404 || code === 'UNREGISTERED' || code === 'INVALID_ARGUMENT';
  return { ok: false, stale, code };
}

// Cloudflare 무료 요금제는 요청 한 번에 외부 호출을 50번까지 할 수 있다.
// 가족 20명 × 최근 기기 2대 = 40번 안에 들도록, 사람마다 가장 최근에 등록한 기기 2대에만 보낸다.
const MAX_DEVICES_PER_PERSON = 2;
const MAX_STALE_DELETES = 5;
const CONCURRENCY = 8;

/** 사람마다 최근 기기 MAX_DEVICES_PER_PERSON 대만 남긴다 (토큰을 잔뜩 등록해 발송을 막는 것도 방지). */
export function pickTokens(tokens) {
  const byUid = new Map();
  for (const t of [...tokens].sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')))) {
    const list = byUid.get(t.uid) || [];
    if (list.length < MAX_DEVICES_PER_PERSON) list.push(t);
    byUid.set(t.uid, list);
  }
  return [...byUid.values()].flat();
}

async function sendToTokens(env, fs, accessToken, tokens, content) {
  let sent = 0;
  let failed = 0;
  let deletes = 0;
  const queue = pickTokens(tokens);
  const worker = async () => {
    while (queue.length) {
      const t = queue.shift();
      try {
        const r = await sendPush(env, accessToken, t, content);
        if (r.ok) sent++;
        else {
          failed++;
          if (r.stale && deletes < MAX_STALE_DELETES) {
            deletes++;
            await fs.delete(`pushTokens/${encodeURIComponent(t.id)}`).catch(() => {});
          }
        }
      } catch {
        // 한 기기에서 실패해도 나머지 기기에는 계속 보낸다.
        failed++;
      }
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  return { sent, failed };
}

/** 지금 세대로 등록되고 활성화된 가족 (예전 방식 계정·차단된 가족 제외) */
async function familyMembers(fs, gates) {
  return (await fs.list('members')).filter((m) => m.active === true && gates && m.gen === gates.gen);
}

/**
 * 이 가족들의 알림 토큰. 문서는 사람마다 3칸(pushTokens/{uid}_0~2, 토큰은 token 필드)이고, 예전 문서는 id 가 토큰이다.
 * 한 기기(토큰)를 여러 사람이 쓴 적이 있으면 가장 최근에 등록한 사람의 것으로 본다.
 */
async function tokensFor(fs, uids) {
  const latest = new Map();
  for (const d of await fs.list('pushTokens')) {
    const token = d.token || d.id;
    const prev = latest.get(token);
    if (!prev || String(d.at || '') > String(prev.at || '')) latest.set(token, { ...d, token });
  }
  return [...latest.values()].filter((t) => uids.has(t.uid));
}

// ---------- 핸들러 ----------

async function readBody(request) {
  const text = await request.text();
  if (text.length > 4096) throw new HttpError(413, '요청이 너무 큽니다');
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new HttpError(400, '잘못된 요청입니다');
  }
}

/** allowBackup: 백업 코드(관문 계정)로 들어온 사람도 허용 (관리자 코드를 잊었을 때 쓰는 일) */
async function authenticate(request, env, fs, { allowBackup = false } = {}) {
  const auth = request.headers.get('Authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!token) throw new HttpError(401, '로그인이 필요합니다');
  const { uid } = await verifyIdToken(token, env.FIREBASE_PROJECT_ID);
  const [member, gates] = await fs.batchGet([`members/${uid}`, 'public/gates']);
  if (allowBackup && gates?.backupUid && uid === gates.backupUid) return { uid, gate: 'backup', member: { name: '백업 코드' }, gates };
  // 토큰이 진짜여도 가족으로 등록·활성화된 사람만 쓸 수 있다.
  if (!member || member.active !== true) throw new HttpError(403, '등록된 가족이 아닙니다');
  // 지금 세대(접속 코드를 처음 설정한 때)로 등록된 가족만. 예전 방식 계정은 쓸 수 없다.
  if (!gates || member.gen !== gates.gen) throw new HttpError(403, '등록된 가족이 아닙니다');
  return { uid, member, gates };
}

/** 관리자 기록 화면에 알림 발송 결과를 남긴다. 실패해도 발송 결과에는 영향이 없다. */
async function logNotify(fs, caller, action, result, extra = '') {
  const detail = `${result.sent}건 성공${result.failed ? `, ${result.failed}건 실패` : ''}${extra ? ` · ${extra}` : ''}`;
  try {
    await fs.create('auditLog', {
      action, target: '', targetName: '', detail, by: caller.uid, byName: caller.member.name || '', at: new Date(),
    });
  } catch (err) {
    console.warn('알림 기록 실패', err);
  }
}

async function handleNotify(env, fs, accessToken, caller) {
  const emergency = await fs.get('emergency/current');
  const key = notificationKey(emergency);
  if (!key) return { sent: 0, skipped: '보낼 비상 상태가 없습니다' };
  if (emergency.notifiedKey === key) return { sent: 0, skipped: '이미 알림을 보냈습니다' };
  // 먼저 "보냄" 표시를 남긴다. 동시에 여러 요청이 와도 문서가 그 사이 바뀌면 실패하므로 한 번만 보낸다.
  const claimed = await fs.setString('emergency/current', 'notifiedKey', key, emergency.updateTime);
  if (!claimed) return { sent: 0, skipped: '다른 요청이 이미 보내는 중입니다' };
  // 삭제·비활성화된 가족, 예전 방식 계정의 기기에는 보내지 않는다.
  const active = new Set((await familyMembers(fs, caller.gates)).map((m) => m.id));
  const tokens = await tokensFor(fs, active);
  const result = await sendToTokens(env, fs, accessToken, tokens, notificationContent(emergency));
  const what = emergency.active ? (emergencyLevel(emergency) === 'alert' ? '2급' : '1급') : '';
  await logNotify(fs, caller, emergency.active ? 'notify.emergency' : 'notify.end', result,
    `${what ? `${what} · ` : ''}기기 ${tokens.length}대 대상`);
  return result;
}

/** 가족 전체 테스트 알람. 테스트 문서마다 한 번만 보낸다. */
async function handleDrill(env, fs, accessToken, caller, body) {
  if (caller.member.role !== 'admin') throw new HttpError(403, '관리자만 할 수 있습니다');
  const { id } = body;
  if (typeof id !== 'string' || !/^[A-Za-z0-9]{1,64}$/.test(id)) throw new HttpError(400, '테스트가 올바르지 않습니다');
  const test = await fs.get(`alarmTests/${id}`);
  if (!test) throw new HttpError(404, '테스트 알람이 없습니다');
  if (test.notifiedKey) return { sent: 0, skipped: '이미 알림을 보냈습니다' };
  const claimed = await fs.setString(`alarmTests/${id}`, 'notifiedKey', 'sent', test.updateTime);
  if (!claimed) return { sent: 0, skipped: '다른 요청이 이미 보내는 중입니다' };
  // 받을 사람을 골랐으면 그 사람들에게만
  const targets = Array.isArray(test.targets) ? new Set(test.targets) : null;
  const active = new Set((await familyMembers(fs, caller.gates)).map((m) => m.id)
    .filter((id) => id !== caller.uid && (!targets || targets.has(id))));
  const tokens = await tokensFor(fs, active);
  const result = await sendToTokens(env, fs, accessToken, tokens, {
    kind: 'test',
    level: test.sound === 'alert' ? 'alert' : 'real',
    ack: `test:${id}`,
    urgent: test.sound !== 'alert',
    title: `🔔 테스트 알람 · ${test.sound === 'alert' ? '2급' : '1급'} (실제 상황 아님)`,
    body: `${test.byName ? `${test.byName}: ` : ''}${test.message || '경보 훈련입니다. 앱을 열어 확인을 눌러 주세요.'}`.slice(0, 300),
  });
  await logNotify(fs, caller, 'notify.drill', result, `기기 ${tokens.length}대 대상`);
  return result;
}

async function handleTestPush(env, fs, accessToken, caller) {
  const tokens = await tokensFor(fs, new Set([caller.uid]));
  const result = await sendToTokens(env, fs, accessToken, tokens, {
    kind: 'push-test',
    title: '🔔 테스트 알림',
    body: '이 기기는 비상선언 알림을 받을 수 있습니다.',
  });
  await logNotify(fs, caller, 'notify.test', result);
  return result;
}

// ---------- 정부 긴급재난문자 자동 경보 ----------

const SYSTEM_CALLER = { uid: SYSTEM_ID, member: { name: SYSTEM_NAME } };

/** Firestore 가 돌려주는 모양의 시각 문자열 (초 단위로 맞춰 다시 읽어도 같은 값이 되게) */
function wholeSecond(now) {
  const at = new Date(Math.floor(now / 1000) * 1000);
  return { at, iso: at.toISOString().replace('.000Z', 'Z') };
}

/**
 * 재난문자로 비상을 선언(또는 2급 → 1급 격상)하고 가족에게 알린다.
 * 이미 같은 단계 이상의 비상 중이면 아무것도 하지 않는다 (가족이 선언한 비상을 덮어쓰지 않는다).
 * @returns {{action:'declare'|'escalate'|'skip'|'retry', sent?:number}}
 */
export async function autoDeclare(env, fs, emergency, hit, now, gates = null) {
  const active = emergency?.active === true;
  if (active && (emergencyLevel(emergency) === 'real' || hit.level === 'alert')) return { action: 'skip' };
  const { at, iso } = wholeSecond(now);
  const message = hit.text.slice(0, 500);
  let data;
  let mask;
  let after;
  if (active) {
    data = { level: 'real', realAt: at, escalatedBy: SYSTEM_ID, escalatedByName: SYSTEM_NAME, message };
    mask = Object.keys(data);
    after = { ...emergency, ...data, realAt: iso };
  } else {
    data = {
      active: true, level: hit.level, type: hit.type, message, declaredBy: SYSTEM_ID, declaredByName: SYSTEM_NAME, declaredAt: at,
    };
    if (hit.level === 'real') data.realAt = at;
    // 지난 비상의 격상 기록, 2급이면 지난 1급 시각은 지운다 (사이트의 선언과 같게).
    mask = [...Object.keys(data), 'escalatedBy', 'escalatedByName', ...(hit.level === 'real' ? [] : ['realAt'])];
    after = { ...data, declaredAt: iso, ...(data.realAt ? { realAt: iso } : {}) };
  }
  // 선언과 "알림 보냄" 표시를 같이 쓴다. 그 사이 누가 비상 문서를 바꿨으면 실패하고 다음 확인 때 다시 본다.
  const key = notificationKey(after);
  data.notifiedKey = key;
  mask.push('notifiedKey');
  const ok = await fs.commit([
    { path: 'emergency/current', data, mask, ...(emergency ? { updateTime: emergency.updateTime } : { exists: false }) },
    {
      path: `emergencyLog/${autoId()}`,
      data: { action: active ? 'escalate' : 'declare', level: hit.level, type: hit.type, message, by: SYSTEM_ID, byName: SYSTEM_NAME, at },
      exists: false,
    },
  ]);
  if (!ok) return { action: 'retry' };

  const accessToken = await fs.getToken();
  const members = new Set((await familyMembers(fs, gates)).map((m) => m.id));
  const tokens = await tokensFor(fs, members);
  const result = await sendToTokens(env, fs, accessToken, tokens, notificationContent(after));
  await logNotify(fs, SYSTEM_CALLER, 'notify.emergency', result,
    `${hit.level === 'alert' ? '2급' : '1급'} · 재난문자 자동 · 기기 ${tokens.length}대 대상`);
  return { action: active ? 'escalate' : 'declare', ...result };
}

/**
 * 1분마다 깨어나, 확인할 차례면(하루 호출 한도 안에서 1~2분마다) 새 재난문자를 읽고 울릴 문자가 있으면 자동 선언한다.
 * 확인 결과와 오늘 쓴 호출 수는 관리자 화면에 보이도록 남긴다.
 */
export async function checkDisasterMessages(env, now = Date.now(), fetchImpl = fetch) {
  if (!env.SAFETY_DATA_KEY || !env.GOOGLE_SERVICE_ACCOUNT || !env.FIREBASE_PROJECT_ID) return { skipped: '설정 없음' };
  const sa = JSON.parse(env.GOOGLE_SERVICE_ACCOUNT);
  const fs = new Firestore(env.FIREBASE_PROJECT_ID, () => getAccessToken(sa));
  const [settingsDoc, state, emergency, gates, recentDoc] = await fs.batchGet([SETTINGS_PATH, STATE_PATH, 'emergency/current', 'public/gates', RECENT_PATH]);
  const settings = disasterSettings(settingsDoc);
  if (!settings.enabled) return { skipped: '꺼짐' };

  const urgent = emergency?.active === true || now - Date.parse(state?.urgentAt || '') < URGENT_MS;
  const plan = shouldCheck(state, now, urgent);
  if (!plan.check) return { skipped: plan.every ? '쉬는 차례' : '오늘 호출 한도 다 씀' };

  const checkedAt = new Date(now);
  let calls = 0;
  const counted = (...args) => { calls++; return fetchImpl(...args); };
  const usage = () => ({ callsDay: kstDate(now), calls: plan.used + calls, lastCallAt: checkedAt, every: plan.every });
  let items;
  try {
    items = await fetchDisasterMessages(env.SAFETY_DATA_KEY, now, counted);
  } catch (err) {
    const data = { checkedAt, error: String(err.message || err).slice(0, 200), ...usage() };
    await fs.commit([{ path: STATE_PATH, data, mask: Object.keys(data) }]);
    return { error: err.message };
  }
  const lastSn = Number(state?.lastSn) || 0;
  const newest = items.reduce((max, m) => Math.max(max, Number(m.SN) || 0), lastSn);
  const hit = pickHit(items, lastSn, now, settings);
  const out = { checkedAt, lastSn: newest, error: '', ...usage() };
  if (hasUrgentSignal(items, lastSn, now, settings)) out.urgentAt = checkedAt;
  let result = null;
  if (hit) {
    result = await autoDeclare(env, fs, emergency, hit, now, gates);
    // 다른 사람이 같은 때 비상 문서를 바꿨으면, 이 문자를 다음 확인 때 다시 본다.
    if (result.action === 'retry') out.lastSn = lastSn;
    else {
      Object.assign(out, {
        lastHitAt: checkedAt, lastHitLevel: hit.level, lastHitKind: hit.kind, lastHitRegion: hit.region.slice(0, 200),
        lastHitText: hit.text.slice(0, 300), lastHitAction: result.action,
      });
    }
  }
  // 우리 지역에 온 문자는 단계와 상관없이 최근 10개를 남겨 가족 모두가 본다. 새 문자가 없어도 확인 시각과 지역은
  // 매번 남겨서, 홈 화면이 "아직 확인 안 함"이 아니라 "확인했는데 없음"을 보여 줄 수 있게 한다.
  const recent = recentMessages(items, lastSn, settings, recentDoc?.items);
  const recentData = { checkedAt, regions: settings.regions };
  if (recent) Object.assign(recentData, { items: recent, updatedAt: checkedAt });
  else if (!recentDoc) Object.assign(recentData, { items: [], updatedAt: checkedAt });
  await fs.commit([
    { path: STATE_PATH, data: out, mask: Object.keys(out) },
    { path: RECENT_PATH, data: recentData, mask: Object.keys(recentData) },
  ]);
  return { hit: hit ? hit.level : null, recent: recent ? recent.length : 0, ...(result || {}) };
}

// ---------- 접속 코드 (login.js) ----------

/**
 * 관문 계정 3개의 이메일 (uid로 찾는다). 예전처럼 공개 문서(public/gates)에 이메일이 남아 있으면
 * 그 이메일로는 더 이상 로그인할 수 없도록 새 이메일로 바꾸고, 공개 문서에서 지운다 (접속 코드는 그대로).
 */
async function gateEmails(env, fs, accessToken, gates) {
  const pid = env.FIREBASE_PROJECT_ID;
  const byUid = await lookupEmails(pid, accessToken, GATE_KINDS.map((k) => gates[`${k}Uid`]).filter(Boolean));
  const emails = Object.fromEntries(GATE_KINDS.map((k) => [k, byUid.get(gates[`${k}Uid`]) || '']));
  const hidden = [];
  for (const k of GATE_KINDS.filter((kind) => gates[`${kind}Email`])) {
    if (!emails[k]) continue;
    if (emails[k] !== gates[`${k}Email`]) { hidden.push(k); continue; }
    const email = hiddenEmail(`g-${k}`, pid);
    if (await updateAccount(pid, accessToken, { localId: gates[`${k}Uid`], email })) {
      emails[k] = email;
      hidden.push(k);
    }
  }
  if (hidden.length) {
    await fs.commit([{ path: 'public/gates', data: {}, mask: hidden.map((k) => `${k}Email`), updateTime: gates.updateTime }]);
  }
  return emails;
}

/** 이 코드로 열리는 관문: 'family' | 'admin' | 'backup' | null. Firebase에 잠시 닿지 않으면 503. */
async function gateForCode(env, fs, accessToken, gates, code, except = null) {
  const emails = await gateEmails(env, fs, accessToken, gates);
  for (const kind of GATE_KINDS) {
    if (kind === except) continue;
    const r = await passwordWorks(env.FIREBASE_API_KEY, emails[kind], code, env.APP_URL);
    if (r === 'unavailable') throw new HttpError(503, '지금은 코드를 확인할 수 없습니다. 잠시 후 다시 시도하세요');
    if (r === 'ok') return kind;
  }
  return null;
}

const asDate = (v) => (v ? new Date(v) : null);

/** 로그인 전: 접속 코드를 확인하고, 맞으면 그 관문 계정으로 로그인할 맞춤 토큰을 준다. 3번 틀리면 하루 동안 막는다. */
async function handleLogin(request, env, fs, sa, body) {
  const { code, device } = body;
  if (typeof code !== 'string' || !code || code.length > 64) throw new HttpError(400, '접속 코드를 입력하세요');
  if (!env.FIREBASE_API_KEY) throw new HttpError(503, '알림 서버 설정이 끝나지 않았습니다 (FIREBASE_API_KEY)');
  const now = Date.now();
  const keys = await lockKeys(env.FIREBASE_PROJECT_ID, request.headers.get('CF-Connecting-IP') || 'unknown', device);
  const docs = await fs.batchGet([...keys.map((k) => `${LOCKS}/${k.id}`), 'public/gates']);
  const gates = docs.pop();
  const until = Math.max(0, ...docs.map((d) => lockedUntil(d, now)));
  if (until) throw new HttpError(429, '접속 코드를 여러 번 틀려 지금은 들어올 수 없습니다', { lockedUntil: new Date(until).toISOString() });
  if (!gates) throw new HttpError(409, '아직 초기 설정이 안 됐습니다');

  // 코드를 확인하기 전에 이번 시도를 실패 하나로 먼저 센다 (동시에 여러 번 보내 횟수를 넘기지 못하게).
  const attempts = keys.map((key, i) => ({ key, doc: docs[i], data: countAttempt(docs[i], key, now) }));
  const reserved = await fs.commit(attempts.map((a) => ({
    path: `${LOCKS}/${a.key.id}`, data: a.data, ...(a.doc ? { updateTime: a.doc.updateTime } : { exists: false }),
  })));
  if (!reserved) throw new HttpError(429, '잠시 후 다시 시도하세요');

  let kind;
  try {
    kind = await gateForCode(env, fs, await getAccessToken(sa), gates, code);
  } catch (err) {
    // 확인을 못 했으면 실패로 세지 않는다 (먼저 센 것을 되돌린다).
    await fs.commit(attempts.map((a) => (a.doc
      ? {
        path: `${LOCKS}/${a.key.id}`,
        data: { ...a.data, fails: Number(a.doc.fails) || 0, firstFailAt: asDate(a.doc.firstFailAt), lockedUntil: asDate(a.doc.lockedUntil) },
      }
      : { path: `${LOCKS}/${a.key.id}`, delete: true }))).catch(() => {});
    throw err;
  }
  if (kind) {
    await fs.commit(keys.map((k) => ({ path: `${LOCKS}/${k.id}`, delete: true })));
    return { kind, token: await createCustomToken(sa, gates[`${kind}Uid`]) };
  }
  const left = Math.max(0, MAX_FAILS - Math.max(...attempts.map((a) => a.data.fails)));
  if (!left) throw new HttpError(429, '접속 코드를 여러 번 틀려 지금은 들어올 수 없습니다', { lockedUntil: new Date(now + LOCK_MS).toISOString() });
  throw new HttpError(401, '접속 코드가 맞지 않습니다', { left });
}

/** 새 접속 코드가 다른 코드와 겹치는지 (겹치면 로그인할 때 엉뚱한 관문이 열린다) */
async function handleCodeCheck(env, fs, accessToken, caller, body) {
  if (caller.gate !== 'backup' && caller.member.role !== 'admin') throw new HttpError(403, '관리자만 할 수 있습니다');
  const { code, except } = body;
  if (typeof code !== 'string' || code.length < 6 || code.length > 64) throw new HttpError(400, '접속 코드가 올바르지 않습니다');
  if (!GATE_KINDS.includes(except)) throw new HttpError(400, '코드 종류가 올바르지 않습니다');
  return { inUse: await gateForCode(env, fs, accessToken, caller.gates, code, except) };
}

/**
 * 코드가 새어 나갔을 때: 그 코드로 들어오는 사람들(access/{kind})의 로그인 열쇠를 모두 새로 만든다.
 * 예전 열쇠로 로그인한 기기는 모두 로그아웃되고, 새 코드로 다시 들어와 이름을 골라야 한다.
 * 부른 사람이 목록에 있으면 새 열쇠를 돌려줘 바로 다시 로그인하게 한다.
 */
async function handleRekey(env, fs, accessToken, caller, body) {
  const { kind } = body;
  if (!['family', 'admin'].includes(kind)) throw new HttpError(400, '코드 종류가 올바르지 않습니다');
  if (caller.gate === 'backup' ? kind !== 'admin' : caller.member.role !== 'admin') throw new HttpError(403, '관리자만 할 수 있습니다');
  const access = await fs.get(`access/${kind}`);
  const people = Array.isArray(access?.people) ? access.people : [];
  const validSince = String(Math.floor(Date.now() / 1000));
  let changed = 0;
  let self = null;
  const out = [];
  for (const p of people) {
    const key = randomKey();
    if (p?.uid && await updateAccount(env.FIREBASE_PROJECT_ID, accessToken, { localId: p.uid, password: key, validSince })) {
      out.push({ ...p, key });
      changed++;
      if (p.uid === caller.uid) self = { email: p.email, key };
    } else {
      out.push(p);
    }
  }
  const ok = await fs.commit([{ path: `access/${kind}`, data: { people: out, updatedAt: new Date() } }]);
  if (!ok) throw new HttpError(502, '이름 목록을 저장하지 못했습니다');
  await logNotify(fs, caller, 'code.rekey', { sent: changed, failed: people.length - changed }, `${kind === 'admin' ? '관리자' : '가족'} 코드 사용자 로그인 열쇠 교체`);
  return { changed, total: people.length, self };
}

// ---------- 도움 요청 ----------

// 같은 사람의 도움 요청 알림은 이 간격 안에 한 번만 (여러 번 눌러도 가족 휴대폰이 계속 울리지 않게)
const HELP_REPEAT_MS = 60 * 1000;

/** 도움 요청을 받을 가족: 관리자, 나를 볼 수 있게 지정된 가족, 내가 볼 수 있게 지정된 가족 */
export function helpRecipients(members, me) {
  const mine = new Set(me.links || []);
  return members.filter((m) => m.id !== me.id
    && (m.role === 'admin' || (m.links || []).includes(me.id) || mine.has(m.id)));
}

export function helpContent(me) {
  const last = me.last || {};
  const where = typeof last.lat === 'number' && typeof last.lng === 'number'
    ? `위치: https://maps.google.com/?q=${last.lat.toFixed(6)},${last.lng.toFixed(6)}${last.accuracy ? ` (±${Math.round(last.accuracy)}m)` : ''}`
    : '위치 확인 안 됨';
  return {
    kind: 'help',
    level: 'alert',
    title: `🆘 도움 요청: ${me.name}`,
    body: `${last.note ? `${last.note} · ` : ''}${where}`.slice(0, 300),
    urgent: true,
  };
}

/** 방금 저장한 "도움 요청" 신고(members.last)를 관련 가족에게 알린다. 문자 보낼 번호도 돌려준다. */
async function handleHelp(env, fs, accessToken, caller) {
  const me = { ...caller.member, id: caller.uid };
  const last = me.last;
  if (last?.type !== 'help') throw new HttpError(409, '도움 요청 신고가 아직 저장되지 않았습니다');
  if (!(Date.now() - Date.parse(last.at) < 10 * 60e3)) throw new HttpError(409, '10분이 지난 도움 요청은 다시 보내지 않습니다');
  const targets = helpRecipients(await familyMembers(fs, caller.gates), me);
  const recipients = targets.map((m) => ({ name: m.name, phone: m.phone || '' }));

  const prev = await fs.get(`helpAlerts/${caller.uid}`);
  if (prev?.checkinAt === last.at || Date.now() - Date.parse(prev?.sentAt || '') < HELP_REPEAT_MS) {
    return { sent: 0, skipped: '방금 보냈습니다', recipients };
  }
  const claimed = await fs.commit([{
    path: `helpAlerts/${caller.uid}`, data: { checkinAt: last.at, sentAt: new Date() }, ...(prev ? { updateTime: prev.updateTime } : { exists: false }),
  }]);
  if (!claimed) return { sent: 0, skipped: '다른 요청이 이미 보내는 중입니다', recipients };

  const tokens = await tokensFor(fs, new Set(targets.map((m) => m.id)));
  const result = await sendToTokens(env, fs, accessToken, tokens, helpContent(me));
  await logNotify(fs, caller, 'notify.help', result, `${targets.length}명 · 기기 ${tokens.length}대 대상`);
  return { ...result, recipients };
}

// ---------- 계정 삭제 ----------

/** 그 사람이 남긴 기록: 신고, 게시판 글, 알림 토큰, 도움 요청 발송 표시 */
async function userRecords(fs, uid) {
  const mine = async (collection) => (await fs.list(collection)).filter((d) => d.uid === uid).map((d) => `${collection}/${d.id}`);
  return [`helpAlerts/${uid}`, ...(await mine('checkins')), ...(await mine('meetingLogs')), ...(await mine('pushTokens'))];
}

/** 한 번에 500개까지 쓸 수 있으므로 나눠 쓴다. */
async function commitAll(fs, writes) {
  for (let i = 0; i < writes.length; i += 400) {
    if (!(await fs.commit(writes.slice(i, i + 400)))) throw new HttpError(502, '계정 정보를 지우지 못했습니다. 다시 시도하세요');
  }
}

/**
 * 본인이 계정을 지운다 (앱 마켓 정책: 앱 안에서 계정 삭제를 요청할 수 있어야 한다).
 * 가족 정보·개인정보·체크리스트·신고 기록·게시판 글·알림 토큰과 로그인 계정을 지우고 이름 목록에서 뺀다.
 * 비상 선언·해제 기록은 가족 전체의 기록이라 남긴다. 마지막 관리자는 지울 수 없다.
 */
async function handleDeleteMe(env, fs, accessToken, caller) {
  const { uid, member } = caller;
  const family = await familyMembers(fs, caller.gates);
  if (member.role === 'admin' && family.filter((m) => m.role === 'admin').length <= 1) {
    throw new HttpError(409, '마지막 관리자는 계정을 지울 수 없습니다. 다른 관리자를 먼저 정하세요');
  }
  const kind = member.role === 'admin' ? 'admin' : 'family';
  const access = await fs.get(`access/${kind}`);
  const paths = [`members/${uid}`, `profiles/${uid}`, `checklists/${uid}`, ...(await userRecords(fs, uid))];
  const writes = [
    { path: `access/${kind}`, data: { people: (access?.people || []).filter((p) => p.uid !== uid), updatedAt: new Date() } },
    ...paths.map((path) => ({ path, delete: true })),
  ];
  // 이름 목록과 가족 문서가 첫 묶음에 들어가 먼저 접근이 끊긴다.
  await commitAll(fs, writes);
  const res = await fetch(`https://identitytoolkit.googleapis.com/v1/projects/${env.FIREBASE_PROJECT_ID}/accounts:delete`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ localId: uid }),
  });
  await logNotify(fs, caller, 'member.selfDelete', { sent: paths.length, failed: res.ok ? 0 : 1 }, `${member.name} 본인 삭제`);
  return { deleted: paths.length, accountDeleted: res.ok };
}

async function handleAdminUser(env, fs, accessToken, caller, body) {
  if (caller.member.role !== 'admin') throw new HttpError(403, '관리자만 할 수 있습니다');
  const { action, uid, password } = body;
  if (typeof uid !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(uid)) throw new HttpError(400, '대상이 올바르지 않습니다');
  // 접속 코드의 관문 계정은 지우거나 비밀번호를 바꿀 수 없다 (가족 모두가 못 들어오게 되거나 코드가 겹친다).
  if (GATE_KINDS.some((k) => caller.gates?.[`${k}Uid`] === uid)) throw new HttpError(400, '접속 코드 계정은 여기서 바꿀 수 없습니다');
  const base = `https://identitytoolkit.googleapis.com/v1/projects/${env.FIREBASE_PROJECT_ID}`;
  const call = (path, payload) => fetch(`${base}/${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (action === 'delete') {
    if (uid === caller.uid) throw new HttpError(400, '본인 계정은 지울 수 없습니다');
    // 사이트가 가족 문서·개인정보를 먼저 지운 뒤 부른다. 남은 기록(신고·게시판 글·알림 토큰)과 로그인 계정을 지운다.
    if (await fs.get(`members/${uid}`)) throw new HttpError(409, '가족 정보를 먼저 지워야 합니다');
    await commitAll(fs, (await userRecords(fs, uid)).map((path) => ({ path, delete: true })));
    const res = await call('accounts:delete', { localId: uid });
    if (!res.ok) throw new HttpError(502, `계정 삭제 실패 (${res.status})`);
    return { ok: true };
  }
  if (action === 'setPassword') {
    if (!(await fs.get(`members/${uid}`))) throw new HttpError(404, '등록된 가족이 아닙니다');
    if (typeof password !== 'string' || password.length < 8 || password.length > 128) {
      throw new HttpError(400, '비밀번호는 8자 이상이어야 합니다');
    }
    const res = await call('accounts:update', { localId: uid, password });
    if (!res.ok) throw new HttpError(502, `비밀번호 변경 실패 (${res.status})`);
    return { ok: true };
  }
  throw new HttpError(400, '알 수 없는 작업입니다');
}

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(checkDisasterMessages(env, event.scheduledTime || Date.now())
      .catch((err) => console.error('재난문자 확인 실패', err)));
  },

  async fetch(request, env) {
    const origin = allowedOrigin(request, env);
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: origin ? 204 : 403, headers: corsHeaders(origin) });
    }
    if (request.method === 'GET' && url.pathname === '/') {
      return json({ ok: true, service: 'family-emergency-worker' }, 200, origin);
    }
    if (request.method !== 'POST') return json({ error: '지원하지 않는 요청입니다' }, 405, origin);
    if (!origin) return json({ error: '허용되지 않은 출처입니다' }, 403, null);

    try {
      if (!env.FIREBASE_PROJECT_ID || !env.GOOGLE_SERVICE_ACCOUNT) throw new HttpError(500, 'Worker 설정이 끝나지 않았습니다');
      const sa = JSON.parse(env.GOOGLE_SERVICE_ACCOUNT);
      const getToken = () => getAccessToken(sa);
      const fs = new Firestore(env.FIREBASE_PROJECT_ID, getToken);
      const body = await readBody(request);
      // 로그인 전에 부르는 유일한 주소
      if (url.pathname === '/login') return json(await handleLogin(request, env, fs, sa, body), 200, origin);
      const allowBackup = ['/code/check', '/admin/rekey'].includes(url.pathname);
      const caller = await authenticate(request, env, fs, { allowBackup });
      if (caller.gate && !allowBackup) throw new HttpError(403, '등록된 가족이 아닙니다');
      const accessToken = await getToken();

      let result;
      if (url.pathname === '/notify') result = await handleNotify(env, fs, accessToken, caller);
      else if (url.pathname === '/help') result = await handleHelp(env, fs, accessToken, caller);
      else if (url.pathname === '/test-push') result = await handleTestPush(env, fs, accessToken, caller);
      else if (url.pathname === '/drill') result = await handleDrill(env, fs, accessToken, caller, body);
      else if (url.pathname === '/code/check') result = await handleCodeCheck(env, fs, accessToken, caller, body);
      else if (url.pathname === '/admin/rekey') result = await handleRekey(env, fs, accessToken, caller, body);
      else if (url.pathname === '/admin/user') result = await handleAdminUser(env, fs, accessToken, caller, body);
      else if (url.pathname === '/me/delete') result = await handleDeleteMe(env, fs, accessToken, caller);
      else throw new HttpError(404, '없는 주소입니다');
      return json(result, 200, origin);
    } catch (err) {
      const status = err instanceof HttpError || err instanceof AuthError ? err.status : 500;
      if (status === 500) console.error(err);
      return json({ error: status === 500 ? '서버 오류가 났습니다' : err.message, ...(err.extra || {}) }, status, origin);
    }
  },
};
