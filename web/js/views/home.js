// 홈: 현재 상황, "나 무사해요" 생존신고, 바로가기, 가족 현황, 준비 상태, 현재 위치, 긴급 전화
import { h, toast, busy, card, panel, alertBox, isIOS } from '../dom.js';
import { errorMessage } from '../firebase.js';
import { checkIn } from '../store.js';
import { getBestPosition, lastKnownPosition } from '../geo.js';
import {
  CHECKIN_LABEL, formatAgo, formatDateTime, formatRemaining, memberStatus, safetySmsBody, smsHref,
  emergencyLabel, meetingSchedule, checklistProgress, checklistKey,
} from '../logic.js';
import { familyStatusList, statusSummary } from './family.js';
import { locationPanel } from './location.js';

/** 위치를 읽고 신고를 저장한다. 위치를 못 읽어도 신고는 저장한다. */
async function report(state, type, note, knownPos) {
  let pos = knownPos || null;
  let locError = null;
  if (!pos) {
    try {
      pos = await getBestPosition();
    } catch (err) {
      locError = err.message;
    }
  }
  const result = await checkIn(state.me, type, pos, note, state.emergency);
  const what = CHECKIN_LABEL[type];
  if (result === 'queued') toast(`${what} 저장됨 — 오프라인이라 연결되면 자동으로 전송됩니다.`, 'warn');
  else toast(`${what} 전송 완료${pos ? '' : ' (위치 없이)'}`);
  if (locError) toast(`위치를 못 읽어 위치 없이 저장했습니다: ${locError}`, 'warn');
  return pos;
}

function situation(state) {
  const e = state.emergency;
  const me = memberStatus(state.me, e);
  if (!e?.active) {
    return alertBox('info', '현재 비상 상황이 아닙니다',
      h('p', null, '평상시에는 집합장소와 대처법을 미리 확인하고, 대비 체크리스트를 채워 두세요.'),
      h('div', { class: 'alert-actions' },
        h('a', { class: 'btn btn-sm', href: '#/protocols' }, '대비 체크리스트'),
        h('a', { class: 'btn btn-sm btn-outline', href: '#/guide' }, '사용 안내')));
  }
  const { currentRank, points } = meetingSchedule(state.meetingPoints, e);
  const target = points.find((p) => p.rank === currentRank);
  const until = target ? (target.at > Date.now() ? target.at.getTime() : target.deadline.getTime()) : null;
  return alertBox('emergency', `비상 선언: ${emergencyLabel(e.type)}`,
    h('p', null, `${e.declaredByName || '가족'} · ${formatDateTime(e.declaredAt)} 선언${e.message ? ` — ${e.message}` : ''}`),
    me.key === 'unknown' ? h('p', null, h('strong', null, '아직 생존신고를 하지 않았습니다. 아래 버튼을 먼저 누르세요.')) : null,
    target ? h('p', null, '지금 갈 곳: ', h('strong', null, `${target.rank}순위 ${target.name}`),
      ` · ${target.at > Date.now() ? '도착까지' : '대기 종료까지'} `, h('strong', { 'data-until': String(until) }, formatRemaining(until - Date.now()))) : null,
    h('div', { class: 'alert-actions' },
      h('a', { class: 'btn btn-sm', href: '#/meet', style: { background: '#fff', color: '#9c3d10' } }, '집합장소 보기'),
      h('a', { class: 'btn btn-sm', href: `#/protocols/${encodeURIComponent(e.type)}`, style: { background: 'transparent', boxShadow: 'inset 0 0 0 2px #fff' } }, '대처법 보기')));
}

function tiles(state) {
  const list = [
    ['#/meet', '📍', '집합장소', '1~10순위 장소와 시간, 거리·방향'],
    ['#/protocols', '📘', '상황별 대처법', '전쟁·지진·홍수 등 15가지'],
    ['#/contacts', '☎️', '비상 연락처', '119·112와 가족 지정 연락처'],
    ['#/family', '👪', '가족 현황', state.isAdmin ? '가족 전체 상태와 위치' : '지정된 가족의 상태'],
    ['#/records', '🗂', '내 신고 기록', '내가 남긴 위치와 시간'],
    ['#/print', '🖨', '인쇄용 비상카드', '지갑·배낭에 넣을 종이 카드'],
  ];
  const admin = state.isAdmin ? [
    ['#/admin/logs', '📋', '관리자 기록', '알림·신고·관리 작업 한눈에', 'tile-admin'],
    ['#/admin/directory', '🗃', '가족 정보 한눈에', '모든 가족의 개인정보 표', 'tile-admin'],
    ['#/emergency', '🚨', state.emergency?.active ? '비상 해제' : '비상선언', '가족 모두에게 알림', 'tile-admin tile-danger'],
  ] : [['#/emergency', '🚨', '비상선언', state.me.declareCredits >= 1 ? '선언권 1회 남음' : '선언권 없음', 'tile-danger']];
  return h('div', { class: 'tiles' }, [...list, ...admin].map(([href, icon, title, desc, cls = '']) => h('a', { class: `tile ${cls}`, href },
    h('span', { class: 'tile-icon', 'aria-hidden': 'true' }, icon),
    h('strong', null, title),
    h('span', null, desc))));
}

function readiness(state) {
  const r = checklistProgress(state.protocols, state.checklist);
  let next = null;
  for (const p of state.protocols) {
    const item = (p.checklist || []).find((i) => !state.checklist[checklistKey(p.id, i.id)]);
    if (item) { next = { p, item }; break; }
  }
  return h('div', null,
    h('div', { class: 'readiness' },
      h('div', { class: 'readiness-score' }, `${r.percent}`, h('small', null, '%')),
      h('div', { style: { flex: 1 } },
        h('div', { class: 'progress' }, h('div', { class: 'progress-bar', style: { width: `${r.percent}%` } })),
        h('div', { class: 'small muted' }, `체크리스트 ${r.checked}/${r.total}개 완료`))),
    next ? h('p', { class: 'small', style: { marginTop: '0.75rem' } }, '다음 할 일: ',
      h('a', { href: `#/protocols/${encodeURIComponent(next.p.id)}` }, `${next.p.title} — ${next.item.text}`)) : h('p', { class: 'small' }, '모든 준비를 마쳤습니다. 6개월마다 다시 확인하세요.'));
}

export function homeView({ state, live, onChange }) {
  let lastPos = null;
  const note = h('input', { placeholder: '메모 (선택) 예: 회사 지하 대피소에 있음', maxlength: 300, 'aria-label': '신고 메모' });

  const run = (type, button) => busy(button, async () => {
    const original = [...button.childNodes];
    button.textContent = '위치 확인 중…';
    try {
      lastPos = await report(state, type, note.value.trim(), null) || lastPos;
      note.value = '';
    } catch (err) {
      toast(errorMessage(err), 'error');
    } finally {
      button.replaceChildren(...original);
    }
  });

  const safeBtn = h('button', { class: 'btn btn-safe btn-hero', onClick: (e) => run('safe', e.currentTarget) },
    '나 무사해요', h('small', null, '누르면 GPS 위치와 시간이 가족에게 전달됩니다'));
  const helpBtn = h('button', {
    class: 'btn btn-secondary btn-lg',
    onClick: (e) => {
      if (!note.value.trim() && !confirm('도움 요청으로 신고할까요? 메모에 상황을 적으면 가족이 더 빨리 도울 수 있습니다.')) return;
      run('help', e.currentTarget);
    },
  }, '🆘 도움 요청');

  const smsBtn = h('button', {
    class: 'btn btn-outline btn-lg',
    onClick: (e) => busy(e.currentTarget, async () => {
      let pos = lastPos;
      if (!pos) {
        try { pos = await getBestPosition(); } catch { pos = lastKnownPosition(); }
      }
      const phones = state.members.filter((m) => m.id !== state.me.id && m.phone).map((m) => m.phone);
      if (!phones.length) {
        toast('전화번호가 등록된 가족이 없습니다.', 'error');
        return;
      }
      location.href = smsHref(phones, safetySmsBody(state.me.name, pos), isIOS);
    }),
  }, '✉️ 문자로 알리기');

  return h('div', { class: 'page' },
    h('div', null,
      h('p', { class: 'muted', style: { margin: 0, fontWeight: 600 } }, '안녕하세요,'),
      h('h1', null, `${state.me.name}님`)),
    live(() => situation(state)),

    panel('생존 신고', null,
      safeBtn,
      h('div', { style: { margin: '0.75rem 0' } }, note),
      h('div', { class: 'row' }, helpBtn, smsBtn),
      live(() => {
        const last = state.me.last;
        return h('p', { class: 'small muted center', style: { margin: '0.75rem 0 0' } },
          last ? `마지막 신고: ${CHECKIN_LABEL[last.type] || last.type} · ${formatAgo(last.clientAt || last.at)} (${formatDateTime(last.clientAt || last.at)})` : '아직 신고 기록이 없습니다.');
      })),

    h('h2', { class: 'section-title' }, '바로가기'),
    live(() => tiles(state)),

    h('div', { class: 'grid grid-2' },
      panel(state.isAdmin ? '가족 현황' : '지정된 가족 현황', { href: '#/family', label: '전체 보기' },
        live(() => statusSummary(state)),
        live(() => familyStatusList(state, { compact: true }))),
      panel('나의 대비 상태', { href: '#/protocols', label: '체크리스트' },
        live(() => readiness(state)))),

    panel('현재 위치', null,
      locationPanel(state, {
        onChange,
        onPosition: (p) => { lastPos = p; },
        onCheckpoint: async (p) => {
          await report(state, 'checkpoint', note.value.trim(), p);
          note.value = '';
        },
      })),

    card(
      h('h2', null, '긴급 전화'),
      h('div', { class: 'hotlines' },
        h('a', { class: 'hotline hotline-red', href: 'tel:119' }, h('strong', null, '119'), h('span', null, '화재·구조·구급')),
        h('a', { class: 'hotline', href: 'tel:112' }, h('strong', null, '112'), h('span', null, '경찰')),
        h('a', { class: 'hotline', href: 'tel:1339' }, h('strong', null, '1339'), h('span', null, '질병관리청'))),
      h('p', { class: 'small', style: { margin: '0.75rem 0 0' } }, h('a', { href: '#/contacts' }, '전체 비상 연락처 보기 →'))),

    live(() => (state.emergency?.active || state.isAdmin ? null
      : alertBox('warning', null,
        h('p', null, `비상 상황인데 아직 선언되지 않았다면 직접 선언할 수 있습니다 (1회). `,
          h('a', { href: '#/emergency' }, '비상선언 화면으로'))))));
}
