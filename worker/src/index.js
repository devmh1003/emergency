// 가족 비상연락 Cloudflare Worker
// 비밀 키(서비스 계정)가 필요한 일만 한다:
//   POST /notify       비상 상태(2급·1급·해제)가 바뀌었으면 가족 모두에게 알림 (상태마다 한 번만)
//   POST /test-push    내 기기로 테스트 알림
//   POST /drill        관리자: 가족 전체 테스트 알람 (테스트마다 한 번만)
//   POST /admin/user   관리자: 가족 로그인 계정 삭제 · 비밀번호 초기화
//
// 환경 변수 (wrangler.toml / 비밀 변수):
//   FIREBASE_PROJECT_ID     Firebase 프로젝트 id
//   ALLOWED_ORIGINS         사이트 주소 (쉼표로 여러 개). 예: https://devmh1003.github.io
//   APP_URL                 알림을 누르면 열 주소. 예: https://devmh1003.github.io/emergency/
//   GOOGLE_SERVICE_ACCOUNT  (비밀) 서비스 계정 JSON 전체
import { verifyIdToken, getAccessToken, AuthError } from './google.js';
import { Firestore } from './firestore.js';

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
  constructor(status, message) {
    super(message);
    this.status = status;
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

export function notificationContent(emergency) {
  if (emergency.active) {
    const label = EMERGENCY_LABELS[emergency.type] || '비상 상황';
    if (emergencyLevel(emergency) === 'alert') {
      const who = emergency.declaredByName ? `${emergency.declaredByName}: ` : '';
      return {
        title: `⚠️ 2급 비상: ${label}`,
        body: `${who}${emergency.message || '준위험 상황입니다. 생존신고를 하고 비상 배낭과 집합장소를 확인하세요.'}`.slice(0, 300),
        urgent: false,
      };
    }
    const name = emergency.escalatedByName || emergency.declaredByName;
    const who = name ? `${name}: ` : '';
    return {
      title: `🚨 1급 비상: ${label}`,
      body: `${who}${emergency.message || '지금 바로 생존신고를 하고 집합장소로 이동하세요.'}`.slice(0, 300),
      urgent: true,
    };
  }
  return {
    title: '✅ 비상 해제',
    body: `${emergency.endedByName || '관리자'}님이 비상을 해제했습니다.`,
    urgent: false,
  };
}

// urgent(1급): 사용자가 닫을 때까지 화면에 남고 길게 진동한다. 그 밖(2급·해제·테스트 알림)은 보통 알림.
async function sendPush(env, accessToken, token, { title, body, kind = 'emergency', urgent = false }) {
  const appUrl = env.APP_URL || '';
  const res = await fetch(`https://fcm.googleapis.com/v1/projects/${env.FIREBASE_PROJECT_ID}/messages:send`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: {
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
      },
    }),
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
        const r = await sendPush(env, accessToken, t.id, content);
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

async function authenticate(request, env, fs) {
  const auth = request.headers.get('Authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!token) throw new HttpError(401, '로그인이 필요합니다');
  const { uid } = await verifyIdToken(token, env.FIREBASE_PROJECT_ID);
  // 토큰이 진짜여도 가족으로 등록·활성화된 사람만 쓸 수 있다.
  const member = await fs.get(`members/${encodeURIComponent(uid)}`);
  if (!member || member.active !== true) throw new HttpError(403, '등록된 가족이 아닙니다');
  // 지금 세대(접속 코드를 처음 설정한 때)로 등록된 가족만. 예전 방식 계정은 쓸 수 없다.
  const gates = await fs.get('public/gates');
  if (!gates || member.gen !== gates.gen) throw new HttpError(403, '등록된 가족이 아닙니다');
  return { uid, member };
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
  // 삭제·비활성화된 가족의 기기에는 보내지 않는다.
  const active = new Set((await fs.list('members')).filter((m) => m.active === true).map((m) => m.id));
  const tokens = (await fs.list('pushTokens')).filter((t) => active.has(t.uid));
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
  const active = new Set((await fs.list('members')).filter((m) => m.active === true).map((m) => m.id));
  const tokens = (await fs.list('pushTokens')).filter((t) => active.has(t.uid) && t.uid !== caller.uid);
  const result = await sendToTokens(env, fs, accessToken, tokens, {
    kind: 'test',
    urgent: test.sound !== 'alert',
    title: `🔔 테스트 알람 · ${test.sound === 'alert' ? '2급' : '1급'} (실제 상황 아님)`,
    body: `${test.byName ? `${test.byName}: ` : ''}${test.message || '경보 훈련입니다. 앱을 열어 확인을 눌러 주세요.'}`.slice(0, 300),
  });
  await logNotify(fs, caller, 'notify.drill', result, `기기 ${tokens.length}대 대상`);
  return result;
}

async function handleTestPush(env, fs, accessToken, caller) {
  const tokens = (await fs.list('pushTokens')).filter((t) => t.uid === caller.uid);
  const result = await sendToTokens(env, fs, accessToken, tokens, {
    title: '🔔 테스트 알림',
    body: '이 기기는 비상선언 알림을 받을 수 있습니다.',
  });
  await logNotify(fs, caller, 'notify.test', result);
  return result;
}

async function handleAdminUser(env, accessToken, caller, body) {
  if (caller.member.role !== 'admin') throw new HttpError(403, '관리자만 할 수 있습니다');
  const { action, uid, password } = body;
  if (typeof uid !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(uid)) throw new HttpError(400, '대상이 올바르지 않습니다');
  const base = `https://identitytoolkit.googleapis.com/v1/projects/${env.FIREBASE_PROJECT_ID}`;
  const call = (path, payload) => fetch(`${base}/${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (action === 'delete') {
    if (uid === caller.uid) throw new HttpError(400, '본인 계정은 지울 수 없습니다');
    const res = await call('accounts:delete', { localId: uid });
    if (!res.ok) throw new HttpError(502, `계정 삭제 실패 (${res.status})`);
    return { ok: true };
  }
  if (action === 'setPassword') {
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
      const caller = await authenticate(request, env, fs);
      const accessToken = await getToken();

      let result;
      if (url.pathname === '/notify') result = await handleNotify(env, fs, accessToken, caller);
      else if (url.pathname === '/test-push') result = await handleTestPush(env, fs, accessToken, caller);
      else if (url.pathname === '/drill') result = await handleDrill(env, fs, accessToken, caller, body);
      else if (url.pathname === '/admin/user') result = await handleAdminUser(env, accessToken, caller, body);
      else throw new HttpError(404, '없는 주소입니다');
      return json(result, 200, origin);
    } catch (err) {
      const status = err instanceof HttpError || err instanceof AuthError ? err.status : 500;
      if (status === 500) console.error(err);
      return json({ error: status === 500 ? '서버 오류가 났습니다' : err.message }, status, origin);
    }
  },
};
