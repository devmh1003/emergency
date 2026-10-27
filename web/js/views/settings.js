// 설정: 알림, 앱 설치, 내 정보, 비밀코드, 내 기록, 인쇄용 비상카드
import { h, field, select, formData, toast, busy, panel, pageHeader, empty, alertBox, table, isIOS, isStandalone } from '../dom.js';
import { config, logout, changePassword, errorMessage, callWorker } from '../firebase.js';
import { getProfile, updateMyInfo, watchCheckins } from '../store.js';
import { enablePush, pushStatus, disablePush } from '../push.js';
import { mapView } from '../map.js';
import {
  BLOOD_TYPES, GENDERS, CHECKIN_LABEL, formatDateTime, formatOffset, hasLocation, locationUrl, meetingSchedule,
  loginIdFromEmail, secretCodeProblem, formatDms,
} from '../logic.js';

const PUSH_TEXT = {
  on: ['success', '켜짐 — 비상선언 알림을 받습니다.'],
  off: ['warning', '꺼짐 — 아래 "알림 켜기"를 누르세요.'],
  denied: ['error', '차단됨 — 휴대폰 설정에서 이 사이트의 알림을 허용해야 합니다.'],
  unsupported: ['error', '이 브라우저는 알림을 지원하지 않습니다.'],
  'ios-needs-install': ['warning', '아이폰은 먼저 홈 화면에 추가하고, 홈 화면 아이콘으로 열어야 알림을 받을 수 있습니다.'],
};

function pushPanel(state) {
  const statusBox = h('div');
  const showStatus = (key) => {
    const [kind, text] = PUSH_TEXT[key];
    statusBox.replaceChildren(alertBox(kind, null, h('p', null, text)));
  };
  showStatus(pushStatus());
  return panel('🔔 비상선언 알림', null,
    statusBox,
    h('div', { class: 'row', style: { marginTop: '0.75rem' } },
      h('button', {
        class: 'btn',
        onClick: (e) => busy(e.currentTarget, async () => {
          try {
            await enablePush(state.me.id);
            showStatus('on');
            toast('알림을 켰습니다.');
          } catch (err) {
            toast(errorMessage(err), 'error');
          }
        }),
      }, '알림 켜기'),
      h('button', {
        class: 'btn btn-outline',
        onClick: (e) => busy(e.currentTarget, async () => {
          try {
            const r = await callWorker('/test-push');
            toast(r.sent ? '테스트 알림을 보냈습니다. 잠시 후 도착합니다.' : '이 계정에 등록된 기기가 없습니다. 먼저 알림을 켜세요.');
          } catch (err) {
            toast(errorMessage(err), 'error');
          }
        }),
      }, '테스트 알림')),
    h('p', { class: 'muted small', style: { marginTop: '0.75rem' } }, '알림은 휴대폰마다 따로 켜야 합니다. 사이트가 열려 있을 때는 경보음도 울립니다.'));
}

function installPanel() {
  if (isStandalone) return panel('📲 앱 설치', null, alertBox('success', null, h('p', null, '홈 화면 앱으로 실행 중입니다. 인터넷 없이도 열립니다.')));
  return panel('📲 홈 화면에 추가', null,
    h('ol', { class: 'process-list' },
      ...(isIOS
        ? [['Safari 아래쪽 공유 버튼(□↑)을 누릅니다.'], ['"홈 화면에 추가"를 누릅니다.'], ['홈 화면에 생긴 아이콘으로 열고 "알림 켜기"를 누릅니다.']]
        : [['Chrome 오른쪽 위 ⋮ 메뉴를 누릅니다.'], ['"홈 화면에 추가" 또는 "앱 설치"를 누릅니다.'], ['홈 화면 아이콘으로 열고 "알림 켜기"를 누릅니다.']])
        .map(([t]) => h('li', null, h('p', { class: 'process-heading', style: { fontWeight: 600, fontSize: '1rem' } }, t)))),
    h('p', { class: 'muted small' }, '홈 화면에 추가하면 인터넷이 없어도 열리고, 알림을 받을 수 있습니다.'));
}

function myInfoPanel(state) {
  const form = h('form', { class: 'stack' }, h('p', { class: 'muted' }, '불러오는 중…'));
  getProfile(state.me.id).then((p) => {
    form.replaceChildren(
      field('전화번호', h('input', { name: 'phone', type: 'tel', maxlength: 30, value: state.me.phone || '' }), '나를 볼 수 있도록 지정된 가족과 관리자에게 보입니다'),
      h('div', { class: 'field-row' },
        field('성별', select('gender', ['', ...GENDERS].map((g) => ({ value: g, label: g || '선택 안 함' })), p.gender || '')),
        field('생년월일', h('input', { name: 'birthDate', type: 'date', value: p.birthDate || '' }))),
      h('div', { class: 'field-row' },
        field('혈액형', select('bloodType', ['', ...BLOOD_TYPES].map((b) => ({ value: b, label: b || '선택 안 함' })), p.bloodType || '')),
        field('이메일 (연락용)', h('input', { name: 'email', type: 'email', maxlength: 120, value: p.email || '' }))),
      field('집주소', h('input', { name: 'address', maxlength: 200, value: p.address || '' })),
      field('비상연락처 (가족 외)', h('input', { name: 'emergencyContact', maxlength: 100, value: p.emergencyContact || '' })),
      field('의료 메모', h('textarea', { name: 'medical', rows: 3, maxlength: 500, value: p.medical || '', placeholder: '지병, 복용약, 알레르기' }),
        '비상시 구조대와 가족이 알아야 할 내용을 적으세요'),
      h('button', { class: 'btn', type: 'submit' }, '저장'));
  }).catch((err) => form.replaceChildren(h('p', { class: 'text-danger' }, errorMessage(err))));
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    busy(form.querySelector('button[type=submit]'), async () => {
      try {
        await updateMyInfo(state.me.id, formData(form));
        toast('저장했습니다.');
      } catch (err) {
        toast(errorMessage(err), 'error');
      }
    });
  });
  const loginId = loginIdFromEmail(state.user.email, config.firebase.projectId);
  return panel('👤 내 정보', null,
    h('div', { class: 'info-row' }, h('span', null, '이름'), h('strong', null, state.me.name)),
    h('div', { class: 'info-row' }, h('span', null, '아이디'), h('span', { class: 'mono' }, loginId)),
    h('div', { class: 'info-row', style: { marginBottom: '1rem' } }, h('span', null, '권한'), h('span', null, state.isAdmin ? '관리자' : '가족')),
    form);
}

function codePanel() {
  const form = h('form', { class: 'stack' },
    field('현재 비밀코드', h('input', { name: 'current', type: 'password', required: true, autocomplete: 'current-password' })),
    h('div', { class: 'field-row' },
      field('새 비밀코드', h('input', { name: 'next', type: 'password', required: true, minlength: 6, autocomplete: 'new-password' }), '6자 이상'),
      field('새 비밀코드 확인', h('input', { name: 'next2', type: 'password', required: true, minlength: 6, autocomplete: 'new-password' }))),
    h('button', { class: 'btn btn-outline', type: 'submit' }, '비밀코드 바꾸기'));
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const d = formData(form);
    const problem = secretCodeProblem(d.next);
    if (problem) { toast(problem, 'error'); return; }
    if (d.next !== d.next2) { toast('새 비밀코드가 서로 다릅니다.', 'error'); return; }
    busy(form.querySelector('button[type=submit]'), async () => {
      try {
        await changePassword(d.current, d.next);
        form.reset();
        toast('비밀코드를 바꿨습니다.');
      } catch (err) {
        toast(errorMessage(err), 'error');
      }
    });
  });
  return panel('🔑 비밀코드', null, form);
}

export function settingsView({ state }) {
  return h('div', { class: 'page' },
    pageHeader('설정', { lead: '알림, 앱 설치, 내 정보와 비밀코드를 관리합니다.' }),
    h('div', { class: 'tiles' },
      [['#/guide', '📖', '사용 안내', '처음 설정과 비상시 행동 순서'],
        ['#/records', '🗂', '내 신고 기록', '내가 남긴 위치와 시간'],
        ['#/print', '🖨', '인쇄용 비상카드', '종이로 들고 다니기'],
        ['#/contacts', '☎️', '비상 연락처', '공공 번호와 가족 연락처']].map(([href, icon, title, desc]) => h('a', { class: 'tile', href },
        h('span', { class: 'tile-icon', 'aria-hidden': 'true' }, icon), h('strong', null, title), h('span', null, desc)))),
    h('div', { class: 'grid grid-2' }, pushPanel(state), installPanel()),
    myInfoPanel(state),
    codePanel(),
    panel('로그아웃', null,
      h('p', { class: 'muted' }, '본인 휴대폰에서는 로그아웃하지 않는 것을 권장합니다. 로그아웃하면 이 휴대폰으로 비상 알림이 오지 않습니다.'),
      h('button', {
        class: 'btn btn-outline-secondary',
        onClick: async () => {
          if (!confirm('로그아웃할까요? 이 휴대폰으로 비상 알림이 오지 않게 됩니다.')) return;
          await disablePush();
          await logout();
        },
      }, '로그아웃')));
}

// ---------- 내 기록 ----------

export function recordsView({ state }) {
  const trail = mapView({ height: 280, line: true });
  const box = h('div', null, h('p', { class: 'muted' }, '불러오는 중…'));
  const unsub = watchCheckins(state.me.id, (list) => {
    trail.setPoints([...list].reverse().filter(hasLocation).map((c, i, arr) => ({
      lat: c.lat, lng: c.lng,
      label: i === arr.length - 1 ? '최근' : String(i + 1),
      color: i === arr.length - 1 ? 'me' : 'default',
      popup: `${CHECKIN_LABEL[c.type]} · ${formatDateTime(c.clientAt)}`,
    })));
    box.replaceChildren(list.length ? table(['시각', '종류', '메모', '위치'], list.map((c) => [
      h('span', { class: 'num' }, formatDateTime(c.clientAt)),
      h('span', { class: `tag kind-${c.type}` }, CHECKIN_LABEL[c.type]),
      c.note || '-',
      hasLocation(c) ? h('a', { href: locationUrl(c), target: '_blank', rel: 'noopener' }, `${c.lat.toFixed(4)}, ${c.lng.toFixed(4)} (±${c.accuracy ?? '?'}m)`) : h('span', { class: 'muted' }, '위치 없음'),
    ])) : empty('아직 신고 기록이 없습니다.'));
  }, (err) => box.replaceChildren(h('p', { class: 'text-danger' }, errorMessage(err))));
  window.addEventListener('hashchange', unsub, { once: true });
  return h('div', { class: 'page' },
    pageHeader('내 신고 기록', { crumbs: [{ label: '설정', href: '#/settings' }], lead: '내가 남긴 생존신고와 체크포인트입니다. 관리자도 볼 수 있습니다.' }),
    panel('이동 경로', null, trail.el),
    panel('기록', null, box));
}

// ---------- 인쇄용 비상카드 ----------

export function printView({ state }) {
  const { points } = meetingSchedule(state.meetingPoints, null);
  const myProfile = h('div');
  getProfile(state.me.id).then((p) => {
    myProfile.replaceChildren(
      h('p', null, h('strong', null, state.me.name), ` · 혈액형 ${p.bloodType || '-'}${p.emergencyContact ? ` · 비상연락 ${p.emergencyContact}` : ''}`),
      p.medical ? h('p', null, `의료: ${p.medical}`) : null);
  }).catch(() => {});

  return h('div', { class: 'page print-page' },
    h('div', { class: 'no-print' },
      pageHeader('인쇄용 비상카드', { crumbs: [{ label: '설정', href: '#/settings' }], lead: '종이로 출력해 지갑과 생존배낭에 넣어 두세요. 휴대폰이 꺼져도 볼 수 있습니다.' },
        h('button', { class: 'btn', onClick: () => window.print() }, '🖨 인쇄'))),
    h('div', { class: 'card print-card' },
      h('h2', null, `${config.appName || '가족 비상연락'} 카드`),
      myProfile,
      h('h3', null, '집합장소 (시간은 비상 발생 기준)'),
      points.length ? h('table', null,
        h('thead', null, h('tr', null, h('th', null, '순위'), h('th', null, '장소'), h('th', null, '시간'), h('th', null, '좌표'))),
        h('tbody', null, points.map((p) => h('tr', null,
          h('td', null, String(p.rank)),
          h('td', null, p.name, p.address ? h('div', { class: 'small' }, p.address) : null),
          h('td', null, `${formatOffset(p.offsetHours)}, ${p.waitMinutes}분 대기`),
          h('td', { class: 'small mono' }, hasLocation(p) ? formatDms(p.lat, p.lng) : '-')))))
        : h('p', null, '집합장소가 아직 없습니다.'),
      h('h3', null, '가족 연락처'),
      h('table', null, h('tbody', null, state.members.filter((m) => m.active).map((m) => h('tr', null,
        h('td', null, m.name), h('td', null, m.phone || '-'))))),
      h('h3', null, '긴급 전화'),
      h('p', null, '119 화재·구조·구급 · 112 경찰 · 122 해양 · 1339 질병관리청 · 182 실종 · 110 정부민원'),
      h('h3', null, '기억할 것'),
      h('ul', null,
        h('li', null, '연락이 안 돼도 1순위 집합장소로 간다. 시간이 지나면 다음 순위로.'),
        h('li', null, '통화보다 문자. 매일 오전 9시·오후 9시에 생존신고.'),
        h('li', null, '집합장소에 도착하면 기록을 남긴다 (사이트 또는 쪽지).'))));
}
