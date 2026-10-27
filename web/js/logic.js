// 화면과 Firebase에 의존하지 않는 순수 로직. tests/logic.test.js 에서 검사한다.

const HOUR = 3600_000;
const MINUTE = 60_000;

/** Firestore Timestamp, Date, 밀리초 숫자를 Date로 바꾼다. 없으면 null. */
export function toDate(v) {
  if (v == null) return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v;
  if (typeof v.toDate === 'function') return v.toDate();
  if (typeof v === 'number') return new Date(v);
  return null;
}

/**
 * 집합장소 일정 계산.
 * 각 순위는 "비상 발생 후 offsetHours 시간"에 도착하고 waitMinutes 동안 기다린다.
 * 관리자가 overrideAt을 넣으면 그 시각이 우선한다.
 * 지금 가야 할 곳은 "도착 시각 + 대기 시간"이 아직 지나지 않은 가장 높은 순위다.
 *
 * @returns {{ points: Array, currentRank: number|null }}
 */
export function meetingSchedule(points, emergency, now = new Date()) {
  const sorted = [...(points || [])].sort((a, b) => a.rank - b.rank);
  const declaredAt = emergency?.active ? toDate(emergency.declaredAt) : null;

  if (!declaredAt) {
    return {
      currentRank: null,
      points: sorted.map((p) => ({ ...p, at: null, deadline: null, state: 'unscheduled' })),
    };
  }

  let currentRank = null;
  const out = sorted.map((p) => {
    const at = toDate(p.overrideAt) || new Date(declaredAt.getTime() + (Number(p.offsetHours) || 0) * HOUR);
    const deadline = new Date(at.getTime() + (Number(p.waitMinutes) || 0) * MINUTE);
    let state;
    if (currentRank === null && deadline.getTime() >= now.getTime()) {
      currentRank = p.rank;
      state = 'current';
    } else {
      state = currentRank === null ? 'past' : 'upcoming';
    }
    return { ...p, at, deadline, state };
  });
  return { currentRank, points: out };
}

/** 순위가 낮아질수록 시간이 늦어지지 않으면 경고한다. */
export function scheduleWarnings(points) {
  const sorted = [...(points || [])].sort((a, b) => a.rank - b.rank);
  const warnings = [];
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const cur = sorted[i];
    const prevEnd = Number(prev.offsetHours) * 60 + Number(prev.waitMinutes || 0);
    if (Number(cur.offsetHours) * 60 < prevEnd) {
      warnings.push(`${cur.rank}순위 시간이 ${prev.rank}순위의 대기 종료보다 빠릅니다.`);
    }
  }
  return warnings;
}

/** "비상 발생 직후", "발생 후 6시간", "발생 후 1일 6시간" */
export function formatOffset(hours) {
  const h = Number(hours) || 0;
  if (h <= 0) return '비상 발생 직후';
  const days = Math.floor(h / 24);
  const rest = Math.round((h - days * 24) * 10) / 10;
  const parts = [];
  if (days) parts.push(`${days}일`);
  if (rest) parts.push(`${rest}시간`);
  return `발생 후 ${parts.join(' ')}`;
}

/** 남은 시간을 "2시간 13분"처럼. 지났으면 "지남". */
export function formatRemaining(ms) {
  if (ms < 0) return '지남';
  const totalMin = Math.floor(ms / MINUTE);
  const d = Math.floor(totalMin / 1440);
  const h = Math.floor((totalMin % 1440) / 60);
  const m = totalMin % 60;
  if (d) return `${d}일 ${h}시간`;
  if (h) return `${h}시간 ${m}분`;
  return `${m}분`;
}

const pad = (n) => String(n).padStart(2, '0');
const WEEK = ['일', '월', '화', '수', '목', '금', '토'];

/** "10/27(화) 14:05" */
export function formatDateTime(v) {
  const d = toDate(v);
  if (!d) return '-';
  return `${d.getMonth() + 1}/${d.getDate()}(${WEEK[d.getDay()]}) ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** "방금", "5분 전", "3시간 전", 그 이상은 날짜 */
export function formatAgo(v, now = new Date()) {
  const d = toDate(v);
  if (!d) return '기록 없음';
  const diff = now.getTime() - d.getTime();
  if (diff < MINUTE) return '방금';
  if (diff < HOUR) return `${Math.floor(diff / MINUTE)}분 전`;
  if (diff < 24 * HOUR) return `${Math.floor(diff / HOUR)}시간 전`;
  return formatDateTime(d);
}

/** datetime-local 입력값("2026-10-27T14:05") */
export function toLocalInput(v) {
  const d = toDate(v);
  if (!d) return '';
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export const CHECKIN_LABEL = {
  safe: '무사함',
  help: '도움 필요',
  checkpoint: '체크포인트',
};

/**
 * 가족 한 명의 현재 상태.
 * 비상 중이면 선언 이후에 남긴 신고만 인정한다.
 * 체크포인트도 살아 있다는 뜻이므로 무사로 본다.
 */
export function memberStatus(member, emergency) {
  const last = member?.last || null;
  const lastAt = last ? toDate(last.clientAt) || toDate(last.at) : null;
  const declaredAt = emergency?.active ? toDate(emergency.declaredAt) : null;

  if (declaredAt) {
    if (!lastAt || lastAt.getTime() < declaredAt.getTime()) {
      return { key: 'unknown', label: '확인 안 됨', lastAt };
    }
    if (last.type === 'help') return { key: 'help', label: '도움 필요', lastAt };
    return { key: 'safe', label: '무사함', lastAt };
  }
  if (!lastAt) return { key: 'idle', label: '신고 기록 없음', lastAt };
  return { key: 'idle', label: `마지막: ${CHECKIN_LABEL[last.type] || last.type}`, lastAt };
}

/** 상태 정렬 순서: 도움 필요 → 확인 안 됨 → 무사 */
export function statusRank(key) {
  return { help: 0, unknown: 1, idle: 2, safe: 3 }[key] ?? 4;
}

export function ageFromBirth(birthDate, now = new Date()) {
  if (!birthDate || !/^\d{4}-\d{2}-\d{2}$/.test(birthDate)) return null;
  const [y, m, d] = birthDate.split('-').map(Number);
  let age = now.getFullYear() - y;
  if (now.getMonth() + 1 < m || (now.getMonth() + 1 === m && now.getDate() < d)) age--;
  return age >= 0 && age < 150 ? age : null;
}

/** 전화번호에서 숫자와 맨 앞 +만 남긴다 (tel:, sms: 링크용). */
export function cleanPhone(p) {
  if (!p) return '';
  const s = String(p).trim();
  const digits = s.replace(/[^\d]/g, '');
  return s.startsWith('+') ? `+${digits}` : digits;
}

/** 휴대폰 기본 문자 앱을 여는 링크. 아이폰과 안드로이드의 형식이 다르다. */
export function smsHref(phones, body, isIOS) {
  const nums = (phones || []).map(cleanPhone).filter(Boolean);
  const text = encodeURIComponent(body || '');
  if (isIOS) return `sms:/open?addresses=${nums.join(',')}&body=${text}`;
  return `sms:${nums.join(',')}?body=${text}`;
}

export function hasLocation(p) {
  return p && typeof p.lat === 'number' && typeof p.lng === 'number';
}

/** 지도 앱 길찾기 링크 */
export function directionLinks(p, name = '목적지') {
  if (!hasLocation(p)) return [];
  const label = encodeURIComponent(String(name).replace(/,/g, ' '));
  return [
    { label: '카카오맵', href: `https://map.kakao.com/link/to/${label},${p.lat},${p.lng}` },
    { label: '구글지도', href: `https://www.google.com/maps/dir/?api=1&destination=${p.lat},${p.lng}` },
  ];
}

export function locationUrl(p) {
  if (!hasLocation(p)) return '';
  return `https://maps.google.com/?q=${p.lat.toFixed(5)},${p.lng.toFixed(5)}`;
}

/** 생존신고 문자 내용 */
export function safetySmsBody(name, pos, now = new Date()) {
  const where = hasLocation(pos) ? ` 위치: ${locationUrl(pos)}` : ' (위치 확인 안 됨)';
  return `[가족 비상연락] ${name} 무사합니다. ${formatDateTime(now)}${where}`;
}

/** 체크리스트 진행률 */
export function checklistProgress(protocols, done) {
  let total = 0;
  let checked = 0;
  for (const p of protocols || []) {
    for (const item of p.checklist || []) {
      total++;
      if (done?.[checklistKey(p.id, item.id)]) checked++;
    }
  }
  return { total, checked, percent: total ? Math.round((checked / total) * 100) : 0 };
}

export function checklistKey(protocolId, itemId) {
  return `${protocolId}__${itemId}`;
}

/** 프로토콜 편집 화면의 텍스트를 데이터로. "## 단계명" 줄로 단계를 나누고, 나머지 줄은 항목. */
export function parseSteps(text) {
  const steps = [];
  let cur = null;
  for (const raw of String(text || '').split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith('##')) {
      cur = { phase: line.replace(/^#+\s*/, '').slice(0, 30), items: [] };
      steps.push(cur);
    } else {
      if (!cur) {
        cur = { phase: '대처법', items: [] };
        steps.push(cur);
      }
      cur.items.push(line.replace(/^[-*•]\s*/, '').slice(0, 300));
    }
  }
  return steps.slice(0, 10);
}

export function stepsToText(steps) {
  return (steps || []).map((s) => [`## ${s.phase}`, ...s.items.map((i) => `- ${i}`)].join('\n')).join('\n\n');
}

/**
 * 체크리스트 텍스트를 데이터로. 기존 항목과 문구가 같으면 id를 유지해 체크 상태가 날아가지 않게 한다.
 */
export function parseChecklist(text, previous = []) {
  const byText = new Map(previous.map((i) => [i.text, i.id]));
  const used = new Set();
  let next = 1;
  const out = [];
  for (const raw of String(text || '').split('\n')) {
    const line = raw.trim().replace(/^[-*•]\s*/, '').replace(/^\[.?\]\s*/, '');
    if (!line) continue;
    let id = byText.get(line);
    if (!id || used.has(id)) {
      do { id = `i${next++}`; } while (used.has(id) || previous.some((p) => p.id === id && p.text !== line));
    }
    used.add(id);
    out.push({ id, text: line.slice(0, 200) });
  }
  return out.slice(0, 80);
}

// ---------- 오프라인 길찾기 (거리·방향) ----------
// 지도가 안 뜰 때도 GPS 좌표만으로 집합장소까지의 거리와 방향을 알려준다.

const EARTH_RADIUS_M = 6371_000;
const rad = (d) => (d * Math.PI) / 180;

/** 두 좌표 사이 거리(미터) */
export function distanceMeters(a, b) {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(s)));
}

/** a에서 b를 바라보는 방위각(0=북, 90=동) */
export function bearingDegrees(a, b) {
  const y = Math.sin(rad(b.lng - a.lng)) * Math.cos(rad(b.lat));
  const x = Math.cos(rad(a.lat)) * Math.sin(rad(b.lat)) - Math.sin(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.cos(rad(b.lng - a.lng));
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

const DIRECTIONS = ['북', '북동', '동', '남동', '남', '남서', '서', '북서'];
const ARROWS = ['↑', '↗', '→', '↘', '↓', '↙', '←', '↖'];

export function compassLabel(deg) {
  const i = Math.round(deg / 45) % 8;
  return { label: `${DIRECTIONS[i]}쪽`, arrow: ARROWS[i] };
}

export function formatDistance(m) {
  if (m < 1000) return `${Math.round(m / 10) * 10}m`;
  return `${(m / 1000).toFixed(m < 10_000 ? 1 : 0)}km`;
}

/** 걸어서 걸리는 시간 (시속 4km 기준) */
export function walkingMinutes(m) {
  return Math.max(1, Math.round(m / (4000 / 60)));
}

/** 현재 위치 → 목적지 안내 문구 */
export function routeHint(from, to) {
  if (!hasLocation(from) || !hasLocation(to)) return null;
  const m = distanceMeters(from, to);
  const dir = compassLabel(bearingDegrees(from, to));
  return {
    meters: m,
    text: `${formatDistance(m)} · ${dir.label}`,
    arrow: dir.arrow,
    walk: `걸어서 약 ${formatDuration(walkingMinutes(m))}`,
  };
}

function formatDuration(min) {
  if (min < 60) return `${min}분`;
  const h = Math.floor(min / 60);
  return `${h}시간${min % 60 ? ` ${min % 60}분` : ''}`;
}

/** 위도·경도를 도·분 형식으로 (종이에 적거나 무전으로 불러줄 때) */
export function formatDms(lat, lng) {
  const part = (v, pos, neg) => {
    const a = Math.abs(v);
    const d = Math.floor(a);
    const m = ((a - d) * 60).toFixed(3);
    return `${v >= 0 ? pos : neg} ${d}° ${m}'`;
  };
  return `${part(lat, 'N', 'S')}, ${part(lng, 'E', 'W')}`;
}

// ---------- CSV (관리자 기록 내려받기) ----------

/** 엑셀에서 수식으로 실행되지 않도록 =, +, -, @ 로 시작하는 칸은 앞에 '를 붙인다. */
function csvCell(v) {
  let s = v == null ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** 엑셀에서 한글이 깨지지 않도록 BOM을 붙인다. */
export function toCsv(headers, rows) {
  return `﻿${[headers, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n')}`;
}

// ---------- 관리자 기록 화면: 여러 기록을 하나의 시간순 목록으로 ----------

export const LOG_KINDS = {
  emergency: '비상',
  safe: '생존신고',
  help: '도움 요청',
  checkpoint: '체크포인트',
  meet: '집합 기록',
  notify: '알림 발송',
  admin: '관리 작업',
};

const AUDIT_LABELS = {
  'member.create': '가족 추가',
  'member.update': '가족 정보 수정',
  'member.delete': '가족 삭제',
  'member.activate': '접근 허용',
  'member.deactivate': '접근 차단',
  'member.credit': '비상선언권 다시 줌',
  'member.resetCode': '비밀코드 초기화',
  'checkin.delete': '신고 기록 삭제',
  'meet.save': '집합장소 저장',
  'meet.delete': '집합장소 삭제',
  'protocol.save': '대처법 저장',
  'protocol.delete': '대처법 삭제',
  'protocol.seed': '기본 대처법 불러옴',
  'contact.save': '연락처 저장',
  'contact.delete': '연락처 삭제',
  'notify.emergency': '비상 알림 발송',
  'notify.end': '해제 알림 발송',
  'notify.test': '테스트 알림 발송',
};

export function auditLabel(action) {
  return AUDIT_LABELS[action] || action;
}

/**
 * 비상 기록, 생존신고, 집합 기록, 관리 기록을 같은 모양으로 바꿔 시간 역순으로 합친다.
 * @returns {Array<{id, kind, at: Date, who, whoId, title, detail, lat, lng}>}
 */
export function buildTimeline({ emergencyLog = [], checkins = [], meetingLogs = [], auditLog = [] }) {
  const out = [];
  for (const e of emergencyLog) {
    out.push({
      id: `e-${e.id}`, kind: 'emergency', at: toDate(e.at), who: e.byName, whoId: e.by,
      title: e.action === 'declare' ? `비상 선언: ${emergencyLabel(e.type)}` : '비상 해제',
      detail: e.message || '',
    });
  }
  for (const c of checkins) {
    out.push({
      id: `c-${c.id}`, kind: c.type, at: toDate(c.clientAt) || toDate(c.at), who: c.name, whoId: c.uid,
      title: CHECKIN_LABEL[c.type] || c.type, detail: c.note || '', lat: c.lat, lng: c.lng, accuracy: c.accuracy,
    });
  }
  for (const m of meetingLogs) {
    out.push({
      id: `m-${m.id}`, kind: 'meet', at: toDate(m.clientAt) || toDate(m.at), who: m.name, whoId: m.uid,
      title: `${m.rank}순위 집합장소 기록`, detail: m.message || '', lat: m.lat, lng: m.lng,
    });
  }
  for (const a of auditLog) {
    const isNotify = String(a.action).startsWith('notify.');
    out.push({
      id: `a-${a.id}`, kind: isNotify ? 'notify' : 'admin', at: toDate(a.at), who: a.byName, whoId: a.by,
      title: `${auditLabel(a.action)}${a.targetName ? ` — ${a.targetName}` : ''}`, detail: a.detail || '',
    });
  }
  return out.filter((x) => x.at).sort((a, b) => b.at - a.at);
}

/** 기록 목록 거르기 */
export function filterTimeline(items, { kind = 'all', who = 'all', days = 0, q = '' } = {}, now = new Date()) {
  const since = days ? now.getTime() - days * 86_400_000 : 0;
  const text = q.trim().toLowerCase();
  return items.filter((x) => (kind === 'all' || x.kind === kind)
    && (who === 'all' || x.whoId === who)
    && x.at.getTime() >= since
    && (!text || `${x.title} ${x.detail} ${x.who || ''}`.toLowerCase().includes(text)));
}

/** 날짜 제목 ("2026년 10월 27일 화요일") */
export function formatDayHeading(d) {
  return `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일 ${WEEK[d.getDay()]}요일`;
}

export function formatTime(v) {
  const d = toDate(v);
  return d ? `${pad(d.getHours())}:${pad(d.getMinutes())}` : '-';
}

// ---------- 아이디 + 비밀코드 로그인 ----------
// Firebase 로그인은 이메일 형식이 필요하므로, 아이디를 이 프로젝트 전용 주소로 바꿔 쓴다.
// (projectId.firebaseapp.com 은 이 프로젝트의 도메인이고, 이 주소로는 메일을 보내지 않는다)

export const LOGIN_ID_RULE = '영문 소문자·숫자로 시작하는 3~20자 (영문 소문자, 숫자, . _ - 사용 가능)';

export function normalizeLoginId(input) {
  return String(input || '').trim().toLowerCase();
}

export function isValidLoginId(id) {
  return /^[a-z0-9][a-z0-9._-]{2,19}$/.test(id);
}

/** 로그인 칸에 넣은 값을 Firebase 로그인 주소로. @가 있으면 예전 방식(이메일) 그대로. */
export function loginEmail(input, projectId) {
  const s = normalizeLoginId(input);
  return s.includes('@') ? s : `${s}@${projectId}.firebaseapp.com`;
}

/** 로그인 주소에서 아이디를 꺼낸다. 이메일 계정이면 이메일을 그대로 돌려준다. */
export function loginIdFromEmail(email, projectId) {
  const suffix = `@${projectId}.firebaseapp.com`;
  if (!email) return '';
  return email.endsWith(suffix) ? email.slice(0, -suffix.length) : email;
}

/** 비밀코드 검사. 문제가 없으면 null, 있으면 안내 문구. */
export function secretCodeProblem(code) {
  const s = String(code || '');
  if (s.length < 6) return '비밀코드는 6자 이상이어야 합니다.';
  if (s.length > 64) return '비밀코드는 64자 이하여야 합니다.';
  if (/^(\d)\1+$/.test(s) || ['123456', '1234567', '12345678', '654321', '000000', 'password', 'qwerty'].includes(s)) {
    return '너무 쉬운 비밀코드입니다. 다른 조합을 쓰세요.';
  }
  return null;
}

export const BLOOD_TYPES =['A+', 'A-', 'B+', 'B-', 'O+', 'O-', 'AB+', 'AB-', '모름'];
export const GENDERS = ['남', '여', '기타'];
export const EMERGENCY_TYPES = [
  { id: 'war', label: '전쟁·공습' },
  { id: 'cbrn', label: '화생방·핵' },
  { id: 'earthquake', label: '지진' },
  { id: 'flood', label: '태풍·홍수' },
  { id: 'tsunami', label: '지진해일' },
  { id: 'landslide', label: '산사태' },
  { id: 'fire', label: '화재·산불' },
  { id: 'heat', label: '폭염' },
  { id: 'cold', label: '한파·폭설' },
  { id: 'pandemic', label: '감염병' },
  { id: 'blackout', label: '정전·통신두절' },
  { id: 'other', label: '기타' },
];

export function emergencyLabel(type) {
  return EMERGENCY_TYPES.find((t) => t.id === type)?.label || '비상 상황';
}
