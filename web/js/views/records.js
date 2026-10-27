// 관리자 전용: 모든 기록 한눈에(비상·알림·생존신고·집합·관리 작업), 가족 정보 한눈에
import { h, field, select, panel, pageHeader, empty, alertBox, table, downloadText } from '../dom.js';
import { errorMessage } from '../firebase.js';
import {
  watchAuditLog, watchAllCheckins, watchAllEmergencyLog, watchAllMeetingLogs, listCollection,
} from '../store.js';
import {
  buildTimeline, filterTimeline, LOG_KINDS, toCsv, formatDayHeading, formatTime, formatDateTime,
  hasLocation, locationUrl, ageFromBirth, checklistProgress, memberStatus, CHECKIN_LABEL, formatAgo,
} from '../logic.js';

const PERIODS = [
  { value: '1', label: '오늘 (24시간)' },
  { value: '7', label: '최근 7일' },
  { value: '30', label: '최근 30일' },
  { value: '0', label: '전체' },
];

const STAT_KINDS = ['emergency', 'safe', 'help', 'notify', 'admin'];

export function recordsAdminView({ state }) {
  const sources = { emergencyLog: [], checkins: [], meetingLogs: [], auditLog: [] };
  const filters = { kind: 'all', who: 'all', days: 7, q: '' };
  let items = [];

  const statsBox = h('div', { class: 'stats' });
  const listBox = h('div', null, h('p', { class: 'muted' }, '불러오는 중…'));
  const errorBox = h('div');

  const kindSel = select('kind', [{ value: 'all', label: '전체' }, ...Object.entries(LOG_KINDS).map(([value, label]) => ({ value, label }))], 'all');
  const whoSel = select('who', [{ value: 'all', label: '가족 전체' }, ...state.members.map((m) => ({ value: m.id, label: m.name }))], 'all');
  const periodSel = select('period', PERIODS, '7');
  const search = h('input', { type: 'search', placeholder: '이름, 내용 검색', 'aria-label': '기록 검색' });

  function filtered() {
    return filterTimeline(items, filters);
  }

  function draw() {
    items = buildTimeline(sources);
    const list = filtered();
    const count = (k) => list.filter((x) => x.kind === k).length;
    statsBox.replaceChildren(...STAT_KINDS.map((k) => h('div', { class: 'stat' },
      h('strong', null, String(count(k))), h('span', null, LOG_KINDS[k]))));
    if (!list.length) {
      listBox.replaceChildren(empty('조건에 맞는 기록이 없습니다.'));
      return;
    }
    // 날짜별로 묶는다
    const groups = [];
    for (const x of list) {
      const day = formatDayHeading(x.at);
      if (!groups.length || groups.at(-1).day !== day) groups.push({ day, rows: [] });
      groups.at(-1).rows.push(x);
    }
    listBox.replaceChildren(
      h('p', { class: 'small muted' }, `${list.length}건`),
      ...groups.map((g) => h('section', null,
        h('h3', { class: 'timeline-date' }, g.day),
        h('ol', { class: 'timeline' }, g.rows.map((x) => h('li', null,
          h('time', { datetime: x.at.toISOString() }, formatTime(x.at)),
          h('div', null,
            h('div', null,
              h('span', { class: `tag kind-${x.kind}`, style: { marginRight: '0.5rem' } }, LOG_KINDS[x.kind] || x.kind),
              h('span', { class: 'tl-title' }, x.title)),
            h('div', { class: 'tl-detail' },
              x.who ? `${x.who}` : '',
              x.detail ? ` · ${x.detail}` : '',
              hasLocation(x) ? [' · ', h('a', { href: locationUrl(x), target: '_blank', rel: 'noopener' }, '위치')] : null))))))));
  }

  const onErr = (err) => errorBox.replaceChildren(alertBox('error', '일부 기록을 불러오지 못했습니다', h('p', null, errorMessage(err))));
  const unsubs = [
    watchAllEmergencyLog((l) => { sources.emergencyLog = l; draw(); }, onErr),
    watchAllCheckins((l) => { sources.checkins = l; draw(); }, onErr),
    watchAllMeetingLogs((l) => { sources.meetingLogs = l; draw(); }, onErr),
    watchAuditLog((l) => { sources.auditLog = l; draw(); }, onErr),
  ];
  window.addEventListener('hashchange', () => unsubs.forEach((u) => u()), { once: true });

  kindSel.addEventListener('change', () => { filters.kind = kindSel.value; draw(); });
  whoSel.addEventListener('change', () => { filters.who = whoSel.value; draw(); });
  periodSel.addEventListener('change', () => { filters.days = Number(periodSel.value); draw(); });
  search.addEventListener('input', () => { filters.q = search.value; draw(); });

  const exportBtn = h('button', {
    class: 'btn btn-outline',
    onClick: () => {
      const list = filtered();
      const csv = toCsv(['일시', '종류', '누가', '내용', '상세', '위도', '경도'],
        list.map((x) => [formatDateTime(x.at), LOG_KINDS[x.kind] || x.kind, x.who || '', x.title, x.detail, x.lat ?? '', x.lng ?? '']));
      const d = new Date();
      downloadText(`가족비상연락_기록_${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}.csv`, csv);
    },
  }, '⬇ CSV 내려받기');

  return h('div', { class: 'page' },
    pageHeader('관리자 기록', { lead: '비상 선언·해제, 알림 발송 결과, 생존신고, 집합장소 기록, 관리 작업을 시간순으로 모아 봅니다.' }, exportBtn),
    errorBox,
    h('div', { class: 'card' },
      h('div', { class: 'filters' },
        field('종류', kindSel), field('가족', whoSel), field('기간', periodSel), field('검색', search))),
    statsBox,
    panel('기록', null, listBox),
    alertBox('info', null, h('p', null, '종류별 최근 기록(생존신고 500건, 집합 기록 300건, 관리 기록 300건, 비상 기록 200건)까지 보여줍니다. 알림 발송 결과는 알림 서버(Worker)가 설정돼 있어야 남습니다.')));
}

// ---------- 가족 정보 한눈에 ----------

export function directoryView({ state, live }) {
  const box = h('div', null, h('p', { class: 'muted' }, '불러오는 중…'));
  let profiles = new Map();
  let checklists = new Map();

  const nameOf = (id) => state.members.find((m) => m.id === id)?.name || '(삭제됨)';

  function rows() {
    return state.members.map((m) => {
      const p = profiles.get(m.id) || {};
      const age = ageFromBirth(p.birthDate);
      const prog = checklistProgress(state.protocols, checklists.get(m.id) || {});
      const s = m.active ? memberStatus(m, state.emergency) : { key: 'idle', label: '차단됨' };
      return { m, p, age, prog, s };
    });
  }

  function draw() {
    const list = rows();
    if (!list.length) {
      box.replaceChildren(empty('가족이 없습니다.'));
      return;
    }
    box.replaceChildren(table(
      ['이름', '아이디', '권한', '상태', '전화', '성별·나이', '혈액형', '의료 메모', '비상연락처', '주소', '마지막 신고', '대비', '볼 수 있는 가족'],
      list.map(({ m, p, age, prog, s }) => [
        h('a', { href: `#/member/${encodeURIComponent(m.id)}`, class: 'item-title' }, m.name),
        h('span', { class: 'mono' }, p.loginId || p.email || '-'),
        m.role === 'admin' ? '관리자' : '가족',
        h('span', { class: `tag status-${s.key}` }, s.label),
        m.phone || '-',
        [p.gender, age != null ? `${age}세` : ''].filter(Boolean).join(' · ') || '-',
        p.bloodType || '-',
        p.medical || '-',
        p.emergencyContact || '-',
        p.address || '-',
        m.last ? `${CHECKIN_LABEL[m.last.type] || ''} ${formatAgo(m.last.clientAt || m.last.at)}` : '-',
        `${prog.percent}%`,
        (m.links || []).map(nameOf).join(', ') || h('span', { class: 'text-danger' }, '지정 안 됨'),
      ])));
  }

  Promise.all([listCollection('profiles'), listCollection('checklists')]).then(([ps, cs]) => {
    profiles = new Map(ps.map((p) => [p.id, p]));
    checklists = new Map(cs.map((c) => [c.id, c.done || {}]));
    draw();
  }).catch((err) => box.replaceChildren(alertBox('error', '불러오지 못했습니다', h('p', null, errorMessage(err)))));

  const exportBtn = h('button', {
    class: 'btn btn-outline',
    onClick: () => {
      if (!confirm('가족 개인정보가 담긴 파일을 내려받습니다. 파일은 안전한 곳에 보관하고, 다 쓰면 지우세요.')) return;
      const csv = toCsv(['이름', '아이디', '권한', '접근', '전화', '성별', '생년월일', '나이', '혈액형', '의료 메모', '비상연락처', '주소', '이메일', '대비율', '볼 수 있는 가족'],
        rows().map(({ m, p, age, prog }) => [m.name, p.loginId || '', m.role === 'admin' ? '관리자' : '가족', m.active ? '허용' : '차단', m.phone, p.gender || '',
          p.birthDate || '', age ?? '', p.bloodType || '', p.medical || '', p.emergencyContact || '', p.address || '', p.email || '', `${prog.percent}%`,
          (m.links || []).map(nameOf).join(' / ')]));
      downloadText('가족정보.csv', csv);
    },
  }, '⬇ CSV 내려받기');

  const unlinked = live(() => {
    const n = state.members.filter((m) => m.active && m.role !== 'admin' && !(m.links || []).length).length;
    return n ? alertBox('warning', null, h('p', null, `"볼 수 있는 가족"이 지정되지 않은 가족이 ${n}명 있습니다. 이들은 다른 가족의 상태를 볼 수 없습니다. 가족 정보 수정에서 최대 3명을 지정하세요.`)) : null;
  });

  // 가족 목록(이름·상태)이 바뀌면 표를 다시 그린다
  const redraw = live(() => { if (profiles.size) draw(); return null; });

  return h('div', { class: 'page' },
    pageHeader('가족 정보 한눈에', { lead: '모든 가족의 기본 정보와 민감 정보, 대비 상태를 한 표로 봅니다. 관리자만 볼 수 있습니다.' }, exportBtn),
    unlinked,
    panel(`가족 ${state.members.length}명`, null, box),
    redraw);
}
