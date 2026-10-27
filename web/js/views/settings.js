// 설정: 알림, 앱 설치, 내 정보, 비밀번호, 내 기록, 인쇄용 비상카드
import { h, field, select, formData, toast, busy, card, pageHeader, empty, isIOS, isStandalone } from '../dom.js';
import { config, logout, changePassword, errorMessage, callWorker } from '../firebase.js';
import { getProfile, updateMyInfo, watchCheckins } from '../store.js';
import { enablePush, pushStatus, disablePush } from '../push.js';
import { mapView } from '../map.js';
import {
  BLOOD_TYPES, GENDERS, CHECKIN_LABEL, formatDateTime, formatOffset, hasLocation, locationUrl, meetingSchedule,
} from '../logic.js';

const PUSH_TEXT = {
  on: '켜짐 — 비상선언 알림을 받습니다.',
  off: '꺼짐',
  denied: '차단됨 — 휴대폰 설정에서 이 사이트의 알림을 허용해야 합니다.',
  unsupported: '이 브라우저는 알림을 지원하지 않습니다.',
  'ios-needs-install': '아이폰은 먼저 홈 화면에 추가해야 알림을 받을 수 있습니다.',
};

function pushCard(state) {
  const status = h('p', null, PUSH_TEXT[pushStatus()]);
  return card(
    h('h2', null, '🔔 비상선언 알림'),
    status,
    h('div', { class: 'row' },
      h('button', {
        class: 'btn btn-primary',
        onClick: (e) => busy(e.currentTarget, async () => {
          try {
            await enablePush(state.me.id);
            status.textContent = PUSH_TEXT.on;
            toast('알림을 켰습니다.');
          } catch (err) {
            toast(errorMessage(err), 'error');
          }
        }),
      }, '알림 켜기'),
      h('button', {
        class: 'btn',
        onClick: (e) => busy(e.currentTarget, async () => {
          try {
            const r = await callWorker('/test-push');
            toast(r.sent ? '테스트 알림을 보냈습니다. 잠시 후 도착합니다.' : '이 계정에 등록된 기기가 없습니다. 먼저 알림을 켜세요.');
          } catch (err) {
            toast(errorMessage(err), 'error');
          }
        }),
      }, '테스트 알림')),
    h('p', { class: 'muted small' }, '알림은 휴대폰마다 따로 켜야 합니다. 사이트가 열려 있을 때는 경보음도 울립니다.'));
}

function installCard() {
  if (isStandalone) return card(h('h2', null, '📲 앱 설치'), h('p', null, '홈 화면 앱으로 실행 중입니다.'));
  return card(
    h('h2', null, '📲 홈 화면에 추가'),
    isIOS
      ? h('ol', { class: 'steps' },
        h('li', null, 'Safari 아래쪽의 공유 버튼(□↑)을 누릅니다.'),
        h('li', null, '"홈 화면에 추가"를 누릅니다.'),
        h('li', null, '홈 화면에 생긴 아이콘으로 열고 "알림 켜기"를 누릅니다.'))
      : h('ol', { class: 'steps' },
        h('li', null, 'Chrome 오른쪽 위 ⋮ 메뉴를 누릅니다.'),
        h('li', null, '"홈 화면에 추가" 또는 "앱 설치"를 누릅니다.')),
    h('p', { class: 'muted small' }, '홈 화면에 추가하면 인터넷이 없어도 열리고, 알림을 받을 수 있습니다.'));
}

function myInfoCard(state) {
  const form = h('form', { class: 'stack' }, h('p', { class: 'muted' }, '불러오는 중…'));
  getProfile(state.me.id).then((p) => {
    form.replaceChildren(
      field('전화번호 (가족 모두에게 보임)', h('input', { name: 'phone', type: 'tel', maxlength: 30, value: state.me.phone || '' })),
      field('성별', select('gender', ['', ...GENDERS].map((g) => ({ value: g, label: g || '선택 안 함' })), p.gender || '')),
      field('생년월일', h('input', { name: 'birthDate', type: 'date', value: p.birthDate || '' })),
      field('혈액형', select('bloodType', ['', ...BLOOD_TYPES].map((b) => ({ value: b, label: b || '선택 안 함' })), p.bloodType || '')),
      field('이메일 (연락용)', h('input', { name: 'email', type: 'email', maxlength: 120, value: p.email || '' })),
      field('집주소', h('input', { name: 'address', maxlength: 200, value: p.address || '' })),
      field('비상연락처 (가족 외)', h('input', { name: 'emergencyContact', maxlength: 100, value: p.emergencyContact || '' })),
      field('의료 메모', h('textarea', { name: 'medical', rows: 3, maxlength: 500, value: p.medical || '', placeholder: '지병, 복용약, 알레르기' })),
      h('p', { class: 'muted small' }, '전화번호 외의 정보는 나와 관리자만 볼 수 있습니다.'),
      h('button', { class: 'btn btn-primary', type: 'submit' }, '저장'));
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
  return card(h('h2', null, '👤 내 정보'), h('p', null, h('strong', null, state.me.name), ` · ${state.user.email}`), form);
}

function passwordCard() {
  const form = h('form', { class: 'stack' },
    field('현재 비밀번호', h('input', { name: 'current', type: 'password', required: true, autocomplete: 'current-password' })),
    field('새 비밀번호', h('input', { name: 'next', type: 'password', required: true, minlength: 8, autocomplete: 'new-password' }), '8자 이상'),
    h('button', { class: 'btn', type: 'submit' }, '비밀번호 바꾸기'));
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const d = formData(form);
    busy(form.querySelector('button[type=submit]'), async () => {
      try {
        await changePassword(d.current, d.next);
        form.reset();
        toast('비밀번호를 바꿨습니다.');
      } catch (err) {
        toast(errorMessage(err), 'error');
      }
    });
  });
  return card(h('h2', null, '🔑 비밀번호'), form);
}

export function settingsView({ state }) {
  return h('div', { class: 'page' },
    pageHeader('설정'),
    pushCard(state),
    installCard(),
    card(h('div', { class: 'stack' },
      h('a', { class: 'btn', href: '#/records' }, '🗂 내 신고 기록'),
      h('a', { class: 'btn', href: '#/print' }, '🖨 인쇄용 비상카드'),
      h('a', { class: 'btn', href: '#/emergency' }, '🚨 비상선언'))),
    myInfoCard(state),
    passwordCard(),
    card(h('button', {
      class: 'btn btn-ghost',
      onClick: async () => {
        if (!confirm('로그아웃할까요? 이 휴대폰으로 비상 알림이 오지 않게 됩니다.')) return;
        await disablePush();
        await logout();
      },
    }, '로그아웃')),
    h('p', { class: 'muted small center' }, `${config.appName || ''} · 버전 ${document.documentElement.dataset.build || 'dev'}`));
}

// ---------- 내 기록 ----------

export function recordsView({ state }) {
  const trail = mapView({ height: 260, line: true });
  const box = h('div', null, h('p', { class: 'muted' }, '불러오는 중…'));
  const unsub = watchCheckins(state.me.id, (list) => {
    trail.setPoints([...list].reverse().filter(hasLocation).map((c, i, arr) => ({
      lat: c.lat, lng: c.lng,
      label: i === arr.length - 1 ? '최근' : String(i + 1),
      color: i === arr.length - 1 ? 'me' : 'default',
      popup: `${CHECKIN_LABEL[c.type]} · ${formatDateTime(c.clientAt)}`,
    })));
    box.replaceChildren(list.length ? h('ul', { class: 'list' }, list.map((c) => h('li', { class: 'list-item' },
      h('div', { class: 'member-main' }, h('strong', null, CHECKIN_LABEL[c.type]), h('span', { class: 'muted small' }, formatDateTime(c.clientAt))),
      c.note ? h('div', { class: 'small' }, c.note) : null,
      hasLocation(c) ? h('a', { class: 'small', href: locationUrl(c), target: '_blank', rel: 'noopener' }, `위치 보기 (±${c.accuracy ?? '?'}m)`) : h('span', { class: 'muted small' }, '위치 없음'))))
      : empty('아직 신고 기록이 없습니다.'));
  }, (err) => box.replaceChildren(h('p', { class: 'text-danger' }, errorMessage(err))));
  window.addEventListener('hashchange', unsub, { once: true });
  return h('div', { class: 'page' }, pageHeader('내 신고 기록'), card(trail.el), card(box));
}

// ---------- 인쇄용 비상카드 ----------

export function printView({ state }) {
  const { points } = meetingSchedule(state.meetingPoints, null);
  const myProfile = h('div');
  getProfile(state.me.id).then((p) => {
    myProfile.replaceChildren(
      h('p', null, `${state.me.name} · 혈액형 ${p.bloodType || '-'}`),
      p.medical ? h('p', null, `의료: ${p.medical}`) : null);
  }).catch(() => {});

  return h('div', { class: 'page print-page' },
    h('div', { class: 'no-print' },
      pageHeader('인쇄용 비상카드', h('button', { class: 'btn btn-primary btn-sm', onClick: () => window.print() }, '🖨 인쇄')),
      h('p', { class: 'muted small' }, '종이로 출력해 지갑과 생존배낭에 넣어 두세요. 휴대폰이 꺼져도 볼 수 있습니다.')),
    h('div', { class: 'print-card' },
      h('h2', null, `${config.appName || '가족 비상연락'} 카드`),
      myProfile,
      h('h3', null, '집합장소 (시간은 비상 발생 기준)'),
      points.length ? h('table', null,
        h('thead', null, h('tr', null, h('th', null, '순위'), h('th', null, '장소'), h('th', null, '시간'))),
        h('tbody', null, points.map((p) => h('tr', null,
          h('td', null, String(p.rank)),
          h('td', null, p.name, p.address ? h('div', { class: 'small' }, p.address) : null),
          h('td', null, `${formatOffset(p.offsetHours)}, ${p.waitMinutes}분 대기`)))))
        : h('p', null, '집합장소가 아직 없습니다.'),
      h('h3', null, '가족 연락처'),
      h('table', null, h('tbody', null, state.members.filter((m) => m.active).map((m) => h('tr', null,
        h('td', null, m.name), h('td', null, m.phone || '-'))))),
      h('h3', null, '기억할 것'),
      h('ul', null,
        h('li', null, '연락이 안 돼도 1순위 집합장소로 간다. 시간이 지나면 다음 순위로.'),
        h('li', null, '통화보다 문자. 119 화재·구조, 112 경찰, 1339 질병관리청.'),
        h('li', null, '집합장소에 도착하면 기록을 남긴다 (사이트 또는 쪽지).'))));
}
