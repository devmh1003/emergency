// 화면과 Firebase에 의존하지 않는 순수 로직. tests/logic.test.js 에서 검사한다.
import { t, lang } from './i18n.js';

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

// ---------- 경보 단계 ----------
// 2급(alert): 준위험 상황. 알림만 가고 경보음은 없다. 집합 시간은 아직 시작하지 않는다.
// 1급(real): 지진·전쟁·대형재난. 경보음 + 알림. 이때부터 집합장소 시간이 계산된다.
// level 이 없는 예전 문서는 1급으로 본다.

export const EMERGENCY_LEVELS = {
  alert: { label: '2급', title: '2급 비상 발령' },
  real: { label: '1급', title: '1급 비상' },
};

/** 지금 경보 단계: 'alert' | 'real' | null(평상시) */
export function emergencyLevel(emergency) {
  if (!emergency?.active) return null;
  return emergency.level === 'alert' ? 'alert' : 'real';
}

export function levelTitle(level) {
  return t(EMERGENCY_LEVELS[level]?.title || '비상');
}

/** 경보 단계 짧은 이름 ('2급' / '1급'), 지금 언어로 */
export function levelLabel(level) {
  return t(EMERGENCY_LEVELS[level]?.label || '비상');
}

/** 1급 비상이 시작된 시각 (집합 시간의 기준). 2급 비상 중이거나 평상시면 null. */
export function realStartedAt(emergency) {
  if (emergencyLevel(emergency) !== 'real') return null;
  return toDate(emergency.realAt) || toDate(emergency.declaredAt);
}

/** 경보를 한 번만 띄우기 위한 키. 2급 → 1급으로 바뀌면 키가 달라져 다시 울린다. */
export function alarmKey(emergency) {
  const level = emergencyLevel(emergency);
  const at = level === 'real' ? realStartedAt(emergency) : toDate(emergency?.declaredAt);
  return level && at ? `${level}:${at.getTime()}` : null;
}

/** 이 단계를 연 사람 (2급에서 1급으로 올린 사람이 있으면 그 사람) */
export function levelActor(emergency) {
  if (emergencyLevel(emergency) === 'real' && emergency.escalatedBy) {
    return { id: emergency.escalatedBy, name: emergency.escalatedByName };
  }
  return { id: emergency?.declaredBy, name: emergency?.declaredByName };
}

/**
 * 집합장소 일정 계산.
 * 각 순위는 "1급 비상 발생 후 offsetHours 시간"에 도착하고 waitMinutes 동안 기다린다.
 * 관리자가 overrideAt을 넣으면 그 시각이 우선한다.
 * 지금 가야 할 곳은 "도착 시각 + 대기 시간"이 아직 지나지 않은 가장 높은 순위다.
 *
 * @returns {{ points: Array, currentRank: number|null }}
 */
export function meetingSchedule(points, emergency, now = new Date()) {
  const sorted = [...(points || [])].sort((a, b) => a.rank - b.rank);
  const declaredAt = realStartedAt(emergency);

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
      warnings.push(t('{rank}순위 시간이 {prev}순위의 대기 종료보다 빠릅니다.', { rank: cur.rank, prev: prev.rank }));
    }
  }
  return warnings;
}

/** "비상 발생 직후", "발생 후 6시간", "발생 후 1일 6시간" */
export function formatOffset(hours) {
  const h = Number(hours) || 0;
  if (h <= 0) return t('비상 발생 직후');
  const days = Math.floor(h / 24);
  const rest = Math.round((h - days * 24) * 10) / 10;
  const parts = [];
  if (lang === 'en') {
    if (days) parts.push(plural(days, 'day', 'days'));
    if (rest) parts.push(plural(rest, 'hour', 'hours'));
    return `${parts.join(' ')} after start`;
  }
  if (days) parts.push(`${days}일`);
  if (rest) parts.push(`${rest}시간`);
  return `발생 후 ${parts.join(' ')}`;
}

/** 영어 단수/복수: plural(1, 'day', 'days') → "1 day" */
function plural(n, one, many) {
  return `${n} ${n === 1 ? one : many}`;
}

/** 남은 시간을 "2시간 13분"처럼. 지났으면 "지남". */
export function formatRemaining(ms) {
  if (ms < 0) return t('지남');
  const totalMin = Math.floor(ms / MINUTE);
  const d = Math.floor(totalMin / 1440);
  const h = Math.floor((totalMin % 1440) / 60);
  const m = totalMin % 60;
  if (lang === 'en') {
    if (d) return `${d} d ${h} h`;
    if (h) return `${h} h ${m} min`;
    return `${m} min`;
  }
  if (d) return `${d}일 ${h}시간`;
  if (h) return `${h}시간 ${m}분`;
  return `${m}분`;
}

const pad = (n) => String(n).padStart(2, '0');
const WEEK = ['일', '월', '화', '수', '목', '금', '토'];
const WEEK_EN = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS_EN = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** 영어 12시간제: "3:05 PM" */
function clock12(d) {
  const h = d.getHours();
  return `${h % 12 || 12}:${pad(d.getMinutes())} ${h < 12 ? 'AM' : 'PM'}`;
}

/** "10/27(화) 14:05" (영어: "Tue, Oct 27, 2:05 PM") */
export function formatDateTime(v) {
  const d = toDate(v);
  if (!d) return '-';
  if (lang === 'en') return `${WEEK_EN[d.getDay()].slice(0, 3)}, ${MONTHS_EN[d.getMonth()].slice(0, 3)} ${d.getDate()}, ${clock12(d)}`;
  return `${d.getMonth() + 1}/${d.getDate()}(${WEEK[d.getDay()]}) ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** "방금", "5분 전", "3시간 전", 그 이상은 날짜 */
export function formatAgo(v, now = new Date()) {
  const d = toDate(v);
  if (!d) return t('기록 없음');
  const diff = now.getTime() - d.getTime();
  if (diff < MINUTE) return t('방금');
  if (diff < HOUR) return t('{n}분 전', { n: Math.floor(diff / MINUTE) });
  if (diff < 24 * HOUR) return t('{n}시간 전', { n: Math.floor(diff / HOUR) });
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
      return { key: 'unknown', label: t('확인 안 됨'), lastAt };
    }
    if (last.type === 'help') return { key: 'help', label: t('도움 필요'), lastAt };
    return { key: 'safe', label: t('무사함'), lastAt };
  }
  if (!lastAt) return { key: 'idle', label: t('신고 기록 없음'), lastAt };
  return { key: 'idle', label: t('마지막: {label}', { label: checkinLabel(last.type) }), lastAt };
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
export function directionLinks(p, name = t('목적지')) {
  if (!hasLocation(p)) return [];
  const label = encodeURIComponent(String(name).replace(/,/g, ' '));
  return [
    { label: t('카카오맵'), href: `https://map.kakao.com/link/to/${label},${p.lat},${p.lng}` },
    { label: t('구글지도'), href: `https://www.google.com/maps/dir/?api=1&destination=${p.lat},${p.lng}` },
  ];
}

export function locationUrl(p) {
  if (!hasLocation(p)) return '';
  return `https://maps.google.com/?q=${p.lat.toFixed(5)},${p.lng.toFixed(5)}`;
}

/** 생존신고 문자 내용 */
export function safetySmsBody(name, pos, now = new Date()) {
  const where = hasLocation(pos) ? ` ${t('위치: {url}', { url: locationUrl(pos) })}` : ` ${t('(위치 확인 안 됨)')}`;
  return t('[가족 비상연락] {name} 무사합니다. {time}{where}', { name, time: formatDateTime(now), where });
}

/** 도움 요청 문자 내용 (메모, 위치 지도 링크, 시각) */
export function helpSmsBody(name, note, pos, now = new Date()) {
  const where = hasLocation(pos) ? ` ${t('위치: {url}', { url: locationUrl(pos) })}` : ` ${t('(위치 확인 안 됨)')}`;
  const what = note ? ` ${note}.` : '';
  return t('[가족 비상연락] 🆘 {name} 도움 요청.{what} {time}{where}', { name, what, time: formatDateTime(now), where });
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
const DIRECTIONS_EN = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
const ARROWS = ['↑', '↗', '→', '↘', '↓', '↙', '←', '↖'];

export function compassLabel(deg) {
  const i = Math.round(deg / 45) % 8;
  return { label: lang === 'en' ? DIRECTIONS_EN[i] : `${DIRECTIONS[i]}쪽`, arrow: ARROWS[i] };
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
    walk: t('걸어서 약 {time}', { time: formatDuration(walkingMinutes(m)) }),
  };
}

function formatDuration(min) {
  if (lang === 'en') {
    if (min < 60) return `${min} min`;
    return `${Math.floor(min / 60)} h${min % 60 ? ` ${min % 60} min` : ''}`;
  }
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
  test: '테스트 알람',
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
  'notify.drill': '테스트 알람 발송',
  'disaster.settings': '재난문자 자동 경보 설정',
  'notify.help': '도움 요청 알림 발송',
  'code.rekey': '접속 코드 사용자 모두 로그아웃',
  'lock.clear': '접속 잠금 해제',
  'code.change': '접속 코드 변경',
  'backup.adminCode': '백업 코드로 관리자 코드 변경',
  'backup.adminAdd': '백업 코드로 관리자 추가',
  'member.legacyCleanup': '예전 방식 계정 정리',
};

/** 비상 기록 한 줄의 제목 */
export function emergencyLogTitle(e) {
  if (e.action === 'end') return t('비상 해제');
  const type = emergencyLabel(e.type);
  if (e.action === 'escalate') return t('1급 격상: {type}', { type });
  return e.level === 'alert' ? t('2급 비상 발령: {type}', { type }) : t('1급 비상 선언: {type}', { type });
}

export function auditLabel(action) {
  return AUDIT_LABELS[action] ? t(AUDIT_LABELS[action]) : action;
}

/** 생존신고 종류 이름 (CHECKIN_LABEL), 지금 언어로. 모르는 종류는 그대로. */
export function checkinLabel(type) {
  return CHECKIN_LABEL[type] ? t(CHECKIN_LABEL[type]) : type;
}

/** 기록 종류 이름 (LOG_KINDS), 지금 언어로. 모르는 종류는 그대로. */
export function logKindLabel(kind) {
  return LOG_KINDS[kind] ? t(LOG_KINDS[kind]) : kind;
}

/**
 * 비상 기록, 생존신고, 집합 기록, 관리 기록을 같은 모양으로 바꿔 시간 역순으로 합친다.
 * @returns {Array<{id, kind, at: Date, who, whoId, title, detail, lat, lng}>}
 */
export function buildTimeline({ emergencyLog = [], checkins = [], meetingLogs = [], auditLog = [], alarmTests = [] }) {
  const out = [];
  for (const e of emergencyLog) {
    out.push({
      id: `e-${e.id}`, kind: 'emergency', at: toDate(e.at), who: e.byName, whoId: e.by,
      title: emergencyLogTitle(e),
      detail: e.message || '',
    });
  }
  for (const a of alarmTests) {
    out.push({
      id: `t-${a.id}`, kind: 'test', at: toDate(a.at), who: a.byName, whoId: a.by,
      title: t('가족 전체 테스트 알람 ({sound})', { sound: t(a.sound === 'alert' ? '2급' : '1급') }), detail: a.message || '',
    });
  }
  for (const c of checkins) {
    out.push({
      id: `c-${c.id}`, kind: c.type, at: toDate(c.clientAt) || toDate(c.at), who: c.name, whoId: c.uid,
      title: checkinLabel(c.type), detail: c.note || '', lat: c.lat, lng: c.lng, accuracy: c.accuracy,
    });
  }
  for (const m of meetingLogs) {
    out.push({
      id: `m-${m.id}`, kind: 'meet', at: toDate(m.clientAt) || toDate(m.at), who: m.name, whoId: m.uid,
      title: t('{rank}순위 집합장소 기록', { rank: m.rank }), detail: m.message || '', lat: m.lat, lng: m.lng,
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
  if (lang === 'en') return `${WEEK_EN[d.getDay()]}, ${MONTHS_EN[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
  return `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일 ${WEEK[d.getDay()]}요일`;
}

export function formatTime(v) {
  const d = toDate(v);
  if (!d) return '-';
  return lang === 'en' ? clock12(d) : `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// ---------- 접속 코드 (가족 · 관리자 · 백업) ----------

export const CODE_KINDS = ['family', 'admin', 'backup'];
const CODE_LABEL = { family: '가족 코드', admin: '관리자 코드', backup: '백업 코드' };
const WEAK_CODES = ['123456', '1234567', '12345678', '123456789', '654321', '000000', 'password', 'qwerty', 'abcdef'];

export function codeLabel(kind) {
  return t(CODE_LABEL[kind] || kind);
}

/** 접속 코드 검사. 문제가 없으면 null. 관리자·백업 코드는 더 길게(8자 이상) 쓴다. */
export function accessCodeProblem(code, kind = 'family') {
  const s = String(code || '');
  const min = kind === 'family' ? 6 : 8;
  if (s.length < min) return t('{label}는 {n}자 이상이어야 합니다.', { label: codeLabel(kind), n: min });
  if (s.length > 64) return t('접속 코드는 64자 이하여야 합니다.');
  if (/^(.)\1+$/.test(s) || WEAK_CODES.includes(s.toLowerCase())) return t('너무 쉬운 코드입니다. 다른 조합을 쓰세요.');
  return null;
}

/** 세 코드를 한꺼번에 검사 (서로 달라야 어떤 코드인지 구분된다) */
export function accessCodesProblem(codes) {
  for (const kind of CODE_KINDS) {
    const p = accessCodeProblem(codes[kind], kind);
    if (p) return p;
  }
  const values = CODE_KINDS.map((k) => codes[k]);
  if (new Set(values).size !== values.length) return t('세 코드는 서로 달라야 합니다.');
  return null;
}

/** 외우기 쉬운 무작위 숫자 코드 */
export function randomDigits(length = 8) {
  const a = new Uint32Array(length);
  let code;
  do {
    crypto.getRandomValues(a);
    code = Array.from(a, (n) => String(n % 10)).join('');
  } while (accessCodeProblem(code, 'admin'));
  return code;
}

export const BLOOD_TYPES =['A+', 'A-', 'B+', 'B-', 'O+', 'O-', 'AB+', 'AB-', '모름'];
export const GENDERS = ['남', '여', '기타'];
export const EMERGENCY_TYPES = [
  { id: 'war', label: '전쟁·공습' },
  { id: 'cbrn', label: '화생방·핵' },
  { id: 'earthquake', label: '지진' },
  { id: 'flood', label: '태풍·홍수' },
  { id: 'tsunami', label: '지진해일' },
  { id: 'disaster', label: '대형재난' },
  { id: 'landslide', label: '산사태' },
  { id: 'fire', label: '화재·산불' },
  { id: 'heat', label: '폭염' },
  { id: 'cold', label: '한파·폭설' },
  { id: 'pandemic', label: '감염병' },
  { id: 'blackout', label: '정전·통신두절' },
  { id: 'other', label: '기타' },
];

export function emergencyLabel(type) {
  return t(EMERGENCY_TYPES.find((x) => x.id === type)?.label || '비상 상황');
}

// ---------- 테스트 알람 ----------

/** 가족 전체 테스트 알람은 보낸 뒤 30분 안에만 울린다 (나중에 처음 연 휴대폰이 옛 테스트로 울리지 않게). */
export const ALARM_TEST_WINDOW_MS = 30 * MINUTE;

export function isFreshAlarmTest(test, now = new Date()) {
  const at = toDate(test?.at);
  return Boolean(at) && now.getTime() - at.getTime() < ALARM_TEST_WINDOW_MS && at.getTime() - now.getTime() < 5 * MINUTE;
}
