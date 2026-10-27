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

export const BLOOD_TYPES = ['A+', 'A-', 'B+', 'B-', 'O+', 'O-', 'AB+', 'AB-', '모름'];
export const GENDERS = ['남', '여', '기타'];
export const EMERGENCY_TYPES = [
  { id: 'war', label: '전쟁·공습' },
  { id: 'cbrn', label: '화생방·핵' },
  { id: 'earthquake', label: '지진' },
  { id: 'flood', label: '태풍·홍수' },
  { id: 'fire', label: '화재·산불' },
  { id: 'pandemic', label: '감염병' },
  { id: 'blackout', label: '정전·통신두절' },
  { id: 'other', label: '기타' },
];

export function emergencyLabel(type) {
  return EMERGENCY_TYPES.find((t) => t.id === type)?.label || '비상 상황';
}
