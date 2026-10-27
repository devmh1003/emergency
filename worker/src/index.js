// 가족 비상연락 Cloudflare Worker
// 비밀 키(서비스 계정)가 필요한 일만 한다:
//   POST /notify       비상 상태가 바뀌었으면 가족 모두에게 알림 (상태마다 한 번만)
//   POST /test-push    내 기기로 테스트 알림
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
  fire: '화재·산불',
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

/** 비상 상태마다 고유한 키. 같은 키로는 한 번만 보낸다. */
export function notificationKey(emergency) {
  if (!emergency) return null;
  if (emergency.active) return emergency.declaredAt ? `on:${emergency.declaredAt}` : null;
  return emergency.endedAt ? `off:${emergency.endedAt}` : null;
}

export function notificationContent(emergency) {
  if (emergency.active) {
    const label = EMERGENCY_LABELS[emergency.type] || '비상 상황';
    const who = emergency.declaredByName ? `${emergency.declaredByName}: ` : '';
    return {
      title: `🚨 비상 선언: ${label}`,
      body: `${who}${emergency.message || '지금 바로 생존신고를 하고 집합장소를 확인하세요.'}`.slice(0, 300),
    };
  }
  return {
    title: '✅ 비상 해제',
    body: `${emergency.endedByName || '관리자'}님이 비상을 해제했습니다.`,
  };
}

async function sendPush(env, accessToken, token, { title, body }) {
  const appUrl = env.APP_URL || '';
  const res = await fetch(`https://fcm.googleapis.com/v1/projects/${env.FIREBASE_PROJECT_ID}/messages:send`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: {
        token,
        notification: { title, body },
        data: { kind: 'emergency' },
        webpush: {
          headers: { Urgency: 'high', TTL: '86400' },
          notification: {
            title,
            body,
            icon: appUrl ? `${appUrl}icons/icon-192.png` : undefined,
            tag: 'family-emergency',
            renotify: true,
            requireInteraction: true,
            vibrate: [600, 300, 600, 300, 600],
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

async function sendToTokens(env, fs, accessToken, tokens, content) {
  let sent = 0;
  let failed = 0;
  await Promise.all(tokens.map(async (t) => {
    const r = await sendPush(env, accessToken, t.id, content);
    if (r.ok) sent++;
    else {
      failed++;
      if (r.stale) await fs.delete(`pushTokens/${encodeURIComponent(t.id)}`);
    }
  }));
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
  return { uid, member };
}

async function handleNotify(env, fs, accessToken) {
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
  return sendToTokens(env, fs, accessToken, tokens, notificationContent(emergency));
}

async function handleTestPush(env, fs, accessToken, uid) {
  const tokens = (await fs.list('pushTokens')).filter((t) => t.uid === uid);
  return sendToTokens(env, fs, accessToken, tokens, {
    title: '🔔 테스트 알림',
    body: '이 기기는 비상선언 알림을 받을 수 있습니다.',
  });
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
      if (url.pathname === '/notify') result = await handleNotify(env, fs, accessToken);
      else if (url.pathname === '/test-push') result = await handleTestPush(env, fs, accessToken, caller.uid);
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
