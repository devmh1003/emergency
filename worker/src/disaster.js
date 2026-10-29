// 행정안전부 긴급재난문자 자동 감시 (재난안전데이터공유플랫폼 DSSP-IF-00247)
// 1~2분마다 새 재난문자를 읽어, 정말 위급한 문자(전쟁·공습, 지진 등)면 가족 비상을 자동으로 선언한다.
// 인증키 하나로 하루 1,000번까지만 부를 수 있어서, 남은 횟수를 자정까지 나눠 쓴다 (shouldCheck).
//
// 재난문자 단계: 위급재난(공습·경계경보 등, 가장 높음) > 긴급재난(지진, 호우·산불 대피 등) > 안전안내
//   1급(경보음): 위급재난 전부, 긴급재난 중 지진·지진해일·민방공
//   2급(알림만): 그 밖의 긴급재난 (관리자가 켰을 때만)
// 안전안내 문자, 훈련 안내, 해제·복귀 안내로는 울리지 않는다.

export const DISASTER_API = 'https://www.safetydata.go.kr/V2/api/DSSP-IF-00247';
export const SETTINGS_PATH = 'config/disasterAlerts';
export const STATE_PATH = 'config/disasterFeed';
// 우리 지역에 온 최근 재난문자 (가족 모두 본다)
export const RECENT_PATH = 'config/disasterRecent';
export const RECENT_MAX = 10;
export const SYSTEM_ID = 'safetydata';
export const SYSTEM_NAME = '정부 재난문자';

// 이보다 오래된 문자로는 울리지 않는다 (서버가 한동안 멈췄다 다시 돌 때 지난 문자로 울리지 않게).
export const MAX_AGE_MS = 30 * 60 * 1000;

// 하루 호출 한도는 1,000번(한국 시각 자정에 새로 셈). 한 번 확인에 여러 쪽을 읽을 때를 위해 여유를 남긴다.
export const DAILY_LIMIT = 1000;
export const DAILY_BUDGET = 940;
// 우리 지역에 긴급·위급 재난문자가 오고 나서 이 시간 동안은 (호출이 넉넉하면) 1분마다 본다. 여진·경보 격상에 대비.
export const URGENT_MS = 60 * 60 * 1000;

const CRITICAL_TYPES = ['지진', '지진해일', '민방공'];

// 재난 구분 → 사이트의 비상 종류
const TYPE_MAP = {
  지진: 'earthquake',
  지진해일: 'tsunami',
  민방공: 'war',
  화생방사고: 'cbrn',
  방사능: 'cbrn',
  산사태: 'landslide',
  산불: 'fire',
  화재: 'fire',
  호우: 'flood',
  홍수: 'flood',
  태풍: 'flood',
  폭염: 'heat',
  한파: 'cold',
  대설: 'cold',
  정전: 'blackout',
  감염병: 'pandemic',
};

// 줄임말로 적은 지역 (재난문자에는 정식 이름이 나온다)
const REGION_ALIASES = { 충북: '충청북도', 충남: '충청남도', 경북: '경상북도', 경남: '경상남도' };

/** 관리자 설정. 문서가 없으면 켜짐 · 전국 · 2급 끔. */
export function disasterSettings(doc) {
  const regions = Array.isArray(doc?.regions)
    ? doc.regions.filter((s) => typeof s === 'string' && s.trim()).map((s) => s.trim()).slice(0, 20)
    : [];
  return { enabled: doc?.enabled !== false, regions, level2: doc?.level2 === true };
}

/**
 * 우리 지역에 온 재난문자(단계 무관) 최근 목록. 새 문자를 앞에 붙이고 10개만 남긴다.
 * @returns {Array|null} 바뀐 것이 없으면 null
 */
export function recentMessages(items, lastSn, settings, previous) {
  const fresh = items
    .filter((m) => (Number(m.SN) || 0) > lastSn && regionMatches(m.RCPTN_RGN_NM, settings.regions))
    .map((m) => ({
      sn: Number(m.SN) || 0,
      at: new Date(parseKst(m.CRT_DT) || Date.now()),
      step: String(m.EMRG_STEP_NM || '').slice(0, 20),
      kind: String(m.DST_SE_NM || '').slice(0, 20),
      region: messageRegions(m.RCPTN_RGN_NM).join(', ').slice(0, 120),
      text: String(m.MSG_CN || '').trim().slice(0, 300),
    }))
    .sort((a, b) => b.sn - a.sn);
  if (!fresh.length) return null;
  const seen = new Set(fresh.map((m) => m.sn));
  const old = (Array.isArray(previous) ? previous : []).filter((m) => !seen.has(Number(m.sn)))
    .map((m) => ({ ...m, at: new Date(m.at) }))
    .sort((a, b) => Number(b.sn) - Number(a.sn));
  return [...fresh, ...old].slice(0, RECENT_MAX);
}

/** 한국 시각 기준 날짜 "YYYYMMDD" */
export function kstDate(ms) {
  return new Date(ms + 9 * 3600e3).toISOString().slice(0, 10).replace(/-/g, '');
}

/** "2026/10/28 13:47:38" (한국 시각) → 밀리초 */
export function parseKst(s) {
  const m = /^(\d{4})\/(\d{2})\/(\d{2}) (\d{2}):(\d{2}):(\d{2})/.exec(String(s || ''));
  if (!m) return NaN;
  return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4] - 9, +m[5], +m[6]);
}

function words(region) {
  return region.split(/\s+/).filter(Boolean).map((w) => REGION_ALIASES[w] || w);
}

/** 두 지역 중 하나가 다른 하나를 포함하는가. 낱말마다 앞부분이 같으면 같은 곳으로 본다 ("경기 수원" = "경기도 수원시"). */
function overlaps(a, b) {
  const x = words(a);
  const y = words(b);
  const n = Math.min(x.length, y.length);
  if (!n) return false;
  for (let i = 0; i < n; i++) if (!x[i].startsWith(y[i]) && !y[i].startsWith(x[i])) return false;
  return true;
}

/** 수신 지역 "경기도 전체 ,서울특별시 광진구 " → ["경기도", "서울특별시 광진구"] */
export function messageRegions(s) {
  return String(s || '').split(',').map((r) => r.trim().replace(/\s*전체$/, '').trim()).filter(Boolean);
}

/** 설정한 지역이 없으면 전국. */
export function regionMatches(rgn, regions) {
  if (!regions.length) return true;
  return messageRegions(rgn).some((r) => regions.some((s) => overlaps(r, s)));
}

export function isDrill(text) {
  return /훈련/.test(text) && !/훈련(이)?\s*아닙|훈련\s*아님|실제\s*상황/.test(text);
}

export function isAllClear(text) {
  return /해제|일상으로\s*복귀|상황\s*종료|오인/.test(text);
}

/** 재난문자 하나를 판단한다. 울릴 문자가 아니면 null. */
export function classifyMessage(m, settings) {
  const step = m.EMRG_STEP_NM;
  const kind = m.DST_SE_NM || '';
  let level = null;
  if (step === '위급재난' || (step === '긴급재난' && CRITICAL_TYPES.includes(kind))) level = 'real';
  else if (step === '긴급재난' && settings.level2) level = 'alert';
  if (!level) return null;
  const text = String(m.MSG_CN || '').trim();
  if (!text || isDrill(text) || isAllClear(text)) return null;
  if (!regionMatches(m.RCPTN_RGN_NM, settings.regions)) return null;
  return {
    level,
    type: TYPE_MAP[kind] || (level === 'real' ? 'disaster' : 'other'),
    sn: Number(m.SN) || 0,
    step,
    kind,
    text,
    region: messageRegions(m.RCPTN_RGN_NM).join(', '),
  };
}

/** lastSn 이후의 새 문자 중 울릴 문자 하나 (1급 우선, 같은 단계면 가장 최근). */
export function pickHit(items, lastSn, now, settings) {
  let best = null;
  for (const m of items) {
    const sn = Number(m.SN) || 0;
    if (sn <= lastSn) continue;
    const at = parseKst(m.CRT_DT);
    if (!(now - at <= MAX_AGE_MS)) continue;
    const hit = classifyMessage(m, settings);
    if (!hit) continue;
    if (!best || (hit.level === 'real' && best.level !== 'real') || (hit.level === best.level && hit.sn > best.sn)) best = hit;
  }
  return best;
}

/** 새 문자 중 우리 지역의 긴급·위급 재난문자가 있는가 (울리지 않는 문자라도 상황이 이어질 수 있다는 신호). */
export function hasUrgentSignal(items, lastSn, now, settings) {
  return items.some((m) => (Number(m.SN) || 0) > lastSn
    && now - parseKst(m.CRT_DT) <= MAX_AGE_MS
    && ['위급재난', '긴급재난'].includes(m.EMRG_STEP_NM)
    && regionMatches(m.RCPTN_RGN_NM, settings.regions));
}

/** 한국 시각 자정까지 남은 분 */
function minutesToMidnight(now) {
  const day = 24 * 3600e3;
  return (day - ((now + 9 * 3600e3) % day)) / 60e3;
}

/**
 * 이번 분(알림 서버는 1분마다 깨어난다)에 재난문자를 확인할지 정한다.
 * 오늘 남은 호출을 자정까지 고르게 나눈 간격(보통 1~2분)마다 확인하고, 급할 때(비상 중이거나 최근 긴급 문자)는
 * 호출이 넉넉하면 1분마다 본다. 한도를 다 쓰면 자정까지 쉰다.
 * @param state config/disasterFeed (callsDay, calls, lastCallAt)
 * @returns {{check:boolean, used:number, every:number}} every: 지금 확인 간격(분)
 */
export function shouldCheck(state, now, urgent) {
  const used = state?.callsDay === kstDate(now) ? Number(state.calls) || 0 : 0;
  const left = DAILY_BUDGET - used;
  if (left <= 0) return { check: false, used, every: 0 };
  const pace = minutesToMidnight(now) / left;
  const every = Math.max(1, Math.ceil((urgent && pace <= 2 ? 1 : pace) - 0.01));
  const last = Date.parse(state?.lastCallAt || '');
  const elapsed = Number.isFinite(last) ? (now - last) / 60e3 : Infinity;
  return { check: elapsed + 0.1 >= every, used, every };
}

// 정부 서버가 잠깐 응답하지 않을 때(5xx, 연결 끊김) 이만큼 기다렸다가 한 번 더 부른다.
export const RETRY_DELAY_MS = 1500;

/** 서버 쪽 일시 장애(5xx·연결 실패)인가. 키가 틀렸거나 요청이 잘못된 것(4xx, 조회 실패 코드)은 다시 불러도 같다. */
export function isTransientError(err) {
  return err?.transient === true;
}

/** 최근 30분 안팎의 재난문자 목록. 키가 틀리거나 서비스가 멈추면 오류. */
export async function fetchDisasterMessages(key, now, fetchImpl = fetch, retryDelay = RETRY_DELAY_MS) {
  const rows = 1000;
  const once = async (page) => {
    const q = new URLSearchParams({
      serviceKey: key, returnType: 'json', pageNo: String(page), numOfRows: String(rows), crtDt: kstDate(now - MAX_AGE_MS),
    });
    let res;
    try {
      res = await fetchImpl(`${DISASTER_API}?${q}`, { headers: { Accept: 'application/json' } });
    } catch (err) {
      throw Object.assign(new Error(`정부 재난문자 서버에 연결하지 못했습니다 (${err.message || err})`), { transient: true });
    }
    if (!res.ok) {
      throw Object.assign(new Error(`정부 재난문자 서버가 응답하지 않습니다 (HTTP ${res.status})`), { transient: res.status >= 500 });
    }
    const data = await res.json().catch(() => null);
    const code = data?.header?.resultCode;
    if (code !== '00') throw new Error(`재난문자 조회 실패: ${data?.header?.errorMsg || data?.header?.resultMsg || code || '응답 없음'}`);
    return data;
  };
  // 일시 장애면 잠깐 뒤 한 번만 더 본다 (호출 한도를 아끼기 위해 한 번만).
  const get = async (page) => {
    try {
      return await once(page);
    } catch (err) {
      if (!isTransientError(err)) throw err;
      await new Promise((r) => setTimeout(r, retryDelay));
      return once(page);
    }
  };
  const first = await get(1);
  const total = Number(first.totalCount) || 0;
  const pages = Math.ceil(total / rows);
  if (pages <= 1) return first.body || [];
  // 오래된 것부터 나오므로 마지막 두 쪽에 최근 문자가 있다.
  const tail = await Promise.all([pages - 1, pages].filter((p) => p > 1).map(get));
  return [...(pages === 2 ? first.body || [] : []), ...tail.flatMap((d) => d.body || [])];
}
