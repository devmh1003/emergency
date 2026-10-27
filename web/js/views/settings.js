// 설정: 알림, 앱 설치, 글자 크기, 내 정보, 접속 코드 관리(관리자), 내 기록, 인쇄용 비상카드
import {
  h, field, select, formData, toast, busy, panel, pageHeader, empty, alertBox, table, isIOS, isStandalone,
  FONT_SCALES, savedFontScale, applyFontScale,
} from '../dom.js';
import { config, logout, errorMessage, callWorker } from '../firebase.js';
import { getProfile, updateMyInfo, watchCheckins, changeAccessCode, deleteLegacyMembers } from '../store.js';
import { enablePush, pushStatus, disablePush } from '../push.js';
import { mapView } from '../map.js';
import { previewAlarm } from './emergency.js';
import { offlineStatus, prepareOffline } from '../offline.js';
import { t } from '../i18n.js';
import {
  BLOOD_TYPES, GENDERS, CHECKIN_LABEL, formatDateTime, formatOffset, hasLocation, locationUrl, meetingSchedule,
  formatDms, CODE_KINDS, codeLabel, accessCodeProblem, randomDigits,
} from '../logic.js';

const PUSH_TEXT = {
  on: ['success', t('켜짐 — 비상 경보 알림을 받습니다.')],
  off: ['warning', t('꺼짐 — 아래 "알림 켜기"를 누르세요.')],
  denied: ['error', t('차단됨 — 휴대폰 설정에서 이 사이트의 알림을 허용해야 합니다.')],
  unsupported: ['error', t('이 브라우저는 알림을 지원하지 않습니다.')],
  'ios-needs-install': ['warning', t('아이폰은 먼저 홈 화면에 추가하고, 홈 화면 아이콘으로 열어야 알림을 받을 수 있습니다.')],
};

function pushPanel(state) {
  const statusBox = h('div');
  const showStatus = (key) => {
    const [kind, text] = PUSH_TEXT[key];
    statusBox.replaceChildren(alertBox(kind, null, h('p', null, text)));
  };
  showStatus(pushStatus());
  return panel(t('🔔 비상 경보 알림'), null,
    statusBox,
    h('div', { class: 'row', style: { marginTop: '0.75rem' } },
      h('button', {
        class: 'btn',
        onClick: (e) => busy(e.currentTarget, async () => {
          try {
            await enablePush(state.me.id);
            showStatus('on');
            toast(t('알림을 켰습니다.'));
          } catch (err) {
            toast(errorMessage(err), 'error');
          }
        }),
      }, t('알림 켜기')),
      h('button', {
        class: 'btn btn-outline',
        onClick: (e) => busy(e.currentTarget, async () => {
          try {
            const r = await callWorker('/test-push');
            toast(r.sent ? t('테스트 알림을 보냈습니다. 잠시 후 도착합니다.') : t('이 계정에 등록된 기기가 없습니다. 먼저 알림을 켜세요.'));
          } catch (err) {
            toast(errorMessage(err), 'error');
          }
        }),
      }, t('테스트 알림')),
      h('button', { class: 'btn btn-outline', onClick: () => previewAlarm('real') }, t('🔊 경보음 시험'))),
    h('p', { class: 'muted small', style: { marginTop: '0.75rem' } }, t('알림은 휴대폰마다 따로 켜야 합니다. 사이트가 열려 있을 때는 경보음도 울립니다.')));
}

function fontPanel() {
  const buttons = FONT_SCALES.map(([scale, label]) => h('button', {
    type: 'button',
    class: 'btn btn-outline',
    'data-font': scale,
    'aria-pressed': String(savedFontScale() === scale),
    onClick: () => {
      applyFontScale(scale);
      for (const b of buttons) b.setAttribute('aria-pressed', String(b.dataset.font === scale));
    },
  }, t(label)));
  return panel(t('🔠 글자 크기'), null,
    h('div', { class: 'row', role: 'group', 'aria-label': t('글자 크기') }, buttons),
    h('p', { class: 'muted small', style: { marginTop: '0.75rem' } }, t('이 휴대폰에만 적용됩니다.')));
}

function installPanel() {
  if (isStandalone) return panel(t('📲 앱 설치'), null, alertBox('success', null, h('p', null, t('홈 화면 앱으로 실행 중입니다. 인터넷 없이도 열립니다.'))));
  return panel(t('📲 홈 화면에 추가'), null,
    h('ol', { class: 'process-list' },
      ...(isIOS
        ? [[t('Safari 아래쪽 공유 버튼(□↑)을 누릅니다.')], [t('"홈 화면에 추가"를 누릅니다.')], [t('홈 화면에 생긴 아이콘으로 열고 "알림 켜기"를 누릅니다.')]]
        : [[t('Chrome 오른쪽 위 ⋮ 메뉴를 누릅니다.')], [t('"홈 화면에 추가" 또는 "앱 설치"를 누릅니다.')], [t('홈 화면 아이콘으로 열고 "알림 켜기"를 누릅니다.')]])
        .map(([text]) => h('li', null, h('p', { class: 'process-heading', style: { fontWeight: 600, fontSize: '1rem' } }, text)))),
    h('p', { class: 'muted small' }, t('홈 화면에 추가하면 인터넷이 없어도 열리고, 알림을 받을 수 있습니다.')));
}

function myInfoPanel(state) {
  const form = h('form', { class: 'stack' }, h('p', { class: 'muted' }, t('불러오는 중…')));
  getProfile(state.me.id).then((p) => {
    form.replaceChildren(
      field(t('전화번호'), h('input', { name: 'phone', type: 'tel', maxlength: 30, value: state.me.phone || '' }), t('나를 볼 수 있도록 지정된 가족과 관리자에게 보입니다')),
      h('div', { class: 'field-row' },
        field(t('성별'), select('gender', ['', ...GENDERS].map((g) => ({ value: g, label: g ? t(g) : t('선택 안 함') })), p.gender || '')),
        field(t('생년월일'), h('input', { name: 'birthDate', type: 'date', value: p.birthDate || '' }))),
      h('div', { class: 'field-row' },
        field(t('혈액형'), select('bloodType', ['', ...BLOOD_TYPES].map((b) => ({ value: b, label: b ? t(b) : t('선택 안 함') })), p.bloodType || '')),
        field(t('이메일 (연락용)'), h('input', { name: 'email', type: 'email', maxlength: 120, value: p.email || '' }))),
      field(t('집주소'), h('input', { name: 'address', maxlength: 200, value: p.address || '' })),
      field(t('비상연락처 (가족 외)'), h('input', { name: 'emergencyContact', maxlength: 100, value: p.emergencyContact || '' })),
      field(t('의료 메모'), h('textarea', { name: 'medical', rows: 3, maxlength: 500, value: p.medical || '', placeholder: t('지병, 복용약, 알레르기') }),
        t('비상시 구조대와 가족이 알아야 할 내용을 적으세요')),
      h('button', { class: 'btn', type: 'submit' }, t('저장')));
  }).catch((err) => form.replaceChildren(h('p', { class: 'text-danger' }, errorMessage(err))));
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    busy(form.querySelector('button[type=submit]'), async () => {
      try {
        await updateMyInfo(state.me.id, formData(form));
        toast(t('저장했습니다.'));
      } catch (err) {
        toast(errorMessage(err), 'error');
      }
    });
  });
  return panel(t('👤 내 정보'), null,
    h('div', { class: 'info-row' }, h('span', null, t('이름')), h('strong', null, state.me.name)),
    h('div', { class: 'info-row', style: { marginBottom: '1rem' } }, h('span', null, t('권한')), h('span', null, state.isAdmin ? t('관리자') : t('가족'))),
    form);
}

/** 인터넷이 끊겨도 쓸 수 있도록 미리 해 둔 것들을 점검하고, 한 번에 준비한다. */
function offlinePanel(state) {
  const box = h('div', null, h('p', { class: 'muted' }, t('확인 중…')));
  const row = (ok, label, detail) => h('div', { class: 'info-row' },
    h('span', null, `${ok ? '✅' : '⚠️'} ${label}`),
    h('span', { class: 'small muted' }, detail));
  const draw = async () => {
    const st = await offlineStatus();
    box.replaceChildren(
      row(st.serviceWorker && st.appSaved, t('앱 화면 저장'), st.appSaved ? t('인터넷 없이 열림') : t('한 번 새로고침하세요')),
      row(st.persisted, t('저장 공간 고정'), st.persisted ? t('브라우저가 지우지 않음') : t('"지금 준비하기"를 누르세요')),
      row(st.tiles > 0, t('지도 미리 받기'), t('{n}장 저장됨', { n: st.tiles })),
      row(st.location === 'granted', t('위치 권한'), st.location === 'granted' ? t('허용됨') : st.location === 'denied' ? t('차단됨 — 휴대폰 설정에서 허용하세요') : t('"지금 준비하기"를 누르면 묻습니다')),
      row(Boolean(st.lastPosition), t('마지막 위치'), st.lastPosition ? formatDateTime(st.lastPosition.at) : t('아직 없음')),
      row(true, t('가족·집합장소·대처법 데이터'), t('로그인해 있는 동안 휴대폰에 자동 보관')),
      st.prep ? h('p', { class: 'small muted', style: { marginTop: '0.5rem' } }, t('마지막 준비: {at}', { at: formatDateTime(st.prep.at) })) : null);
  };
  draw();
  return panel(t('📴 오프라인 준비'), null,
    h('p', { class: 'small muted' }, t('비상시에는 인터넷이 끊길 수 있습니다. 앱을 설치하고 인터넷이 될 때 한 번 준비해 두면, 끊겨도 화면·대처법·가족 정보·집합장소 지도·GPS를 쓸 수 있습니다.')),
    box,
    h('button', {
      class: 'btn',
      style: { marginTop: '0.75rem' },
      onClick: (e) => busy(e.currentTarget, async () => {
        if (!navigator.onLine) { toast(t('인터넷이 될 때 준비할 수 있습니다.'), 'warn'); return; }
        try {
          const r = await prepareOffline(state, { askLocation: true });
          toast(t('준비했습니다. 지도 {n}장 저장.', { n: r.tiles ?? 0 }));
        } catch (err) {
          toast(errorMessage(err), 'error');
        }
        await draw();
      }),
    }, t('📥 지금 준비하기')));
}

/** 관리자: 접속 코드 3가지 바꾸기. 예전 코드를 몰라도 새 코드로 바꿀 수 있다. */
function accessCodePanel(state) {
  const rows = CODE_KINDS.map((kind) => {
    const form = h('form', { class: 'stack', hidden: true },
      field(t('새 {label}', { label: codeLabel(kind) }), h('div', { class: 'input-group' },
        h('input', { name: 'code', type: 'text', required: true, minlength: kind === 'family' ? 6 : 8, maxlength: 64, autocomplete: 'off', spellcheck: 'false', autocapitalize: 'off' }),
        h('button', { class: 'btn btn-base btn-sm', type: 'button', onClick: () => { form.elements.code.value = randomDigits(8); } }, t('자동 생성')))),
      h('div', { class: 'row' },
        h('button', { class: 'btn btn-outline btn-sm', type: 'button', onClick: () => { form.hidden = true; form.reset(); } }, t('취소')),
        h('button', { class: 'btn btn-sm', type: 'submit' }, t('바꾸기'))));
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const { code } = formData(form);
      const problem = accessCodeProblem(code, kind);
      if (problem) { toast(problem, 'error'); return; }
      if (!confirm(t('{label}를 바꿀까요? 예전 코드로는 더 이상 들어올 수 없습니다. 이미 들어와 있는 휴대폰은 그대로입니다.', { label: codeLabel(kind) }))) return;
      busy(form.querySelector('button[type=submit]'), async () => {
        try {
          await changeAccessCode(kind, code);
          form.hidden = true;
          form.reset();
          toast(t('{label}를 바꿨습니다. 새 코드를 적어 두고 필요한 가족에게 알려 주세요.', { label: codeLabel(kind) }));
        } catch (err) {
          toast(errorMessage(err), 'error');
        }
      });
    });
    return h('div', { class: 'code-row' },
      h('div', { class: 'info-row' },
        h('span', null, h('strong', null, codeLabel(kind)), h('span', { class: 'small muted', style: { display: 'block' } }, CODE_HINT[kind]())),
        h('button', { class: 'btn btn-outline btn-sm', type: 'button', onClick: () => { form.hidden = false; form.elements.code.focus(); } }, t('바꾸기'))),
      form);
  });
  const legacy = state.legacyMembers?.length
    ? alertBox('warning', t('예전 방식 계정 {n}개', { n: state.legacyMembers.length }),
      h('p', null, t('예전 아이디 방식으로 만든 계정입니다. 이미 접근이 막혀 있습니다. 정리하면 목록에서 지워집니다.')),
      h('button', {
        class: 'btn btn-sm btn-outline',
        onClick: (e) => busy(e.currentTarget, async () => {
          if (!confirm(t('예전 방식 계정 문서를 정리할까요?'))) return;
          try {
            await deleteLegacyMembers(state.legacyMembers);
            toast(t('정리했습니다.'));
          } catch (err) { toast(errorMessage(err), 'error'); }
        }),
      }, t('정리하기')))
    : null;
  return panel(t('🔑 접속 코드 관리'), null,
    h('p', { class: 'small muted' }, t('코드는 어디에도 저장되지 않아 다시 볼 수 없습니다. 잊었다면 여기서 새로 정하세요. 관리자 코드를 잊었다면 백업 코드로 들어와 바꿀 수 있습니다.')),
    rows,
    legacy);
}

const CODE_HINT = {
  family: () => t('일반 가족이 들어올 때'),
  admin: () => t('관리자가 들어올 때'),
  backup: () => t('관리자 코드를 잊었을 때 (종이에 보관)'),
};

export function settingsView({ state }) {
  return h('div', { class: 'page' },
    pageHeader(t('설정'), { lead: t('알림, 앱 설치, 글자 크기, 내 정보를 관리합니다.') }),
    h('div', { class: 'tiles' },
      [['#/guide', '📖', t('사용 안내'), t('처음 설정과 비상시 행동 순서')],
        ['#/records', '🗂', t('내 신고 기록'), t('내가 남긴 위치와 시간')],
        ['#/print', '🖨', t('인쇄용 비상카드'), t('종이로 들고 다니기')],
        ['#/contacts', '☎️', t('비상 연락처'), t('공공 번호와 가족 연락처')]].map(([href, icon, title, desc]) => h('a', { class: 'tile', href },
        h('span', { class: 'tile-icon', 'aria-hidden': 'true' }, icon), h('strong', null, title), h('span', null, desc)))),
    h('div', { class: 'grid grid-2' }, pushPanel(state), installPanel()),
    offlinePanel(state),
    fontPanel(),
    myInfoPanel(state),
    state.isAdmin ? accessCodePanel(state) : null,
    panel(t('로그아웃'), null,
      h('p', { class: 'muted' }, t('본인 휴대폰에서는 로그아웃하지 않는 것을 권장합니다. 로그아웃하면 이 휴대폰으로 비상 알림이 오지 않습니다.')),
      h('button', {
        class: 'btn btn-outline-secondary',
        onClick: async () => {
          if (!confirm(t('로그아웃할까요? 이 휴대폰으로 비상 알림이 오지 않게 됩니다.'))) return;
          await disablePush();
          await logout();
        },
      }, t('로그아웃'))));
}

// ---------- 내 기록 ----------

export function recordsView({ state }) {
  const trail = mapView({ height: 280, line: true });
  const box = h('div', null, h('p', { class: 'muted' }, t('불러오는 중…')));
  const unsub = watchCheckins(state.me.id, (list) => {
    trail.setPoints([...list].reverse().filter(hasLocation).map((c, i, arr) => ({
      lat: c.lat, lng: c.lng,
      label: i === arr.length - 1 ? t('최근') : String(i + 1),
      color: i === arr.length - 1 ? 'me' : 'default',
      popup: `${t(CHECKIN_LABEL[c.type])} · ${formatDateTime(c.clientAt)}`,
    })));
    box.replaceChildren(list.length ? table([t('시각'), t('종류'), t('메모'), t('위치')], list.map((c) => [
      h('span', { class: 'num' }, formatDateTime(c.clientAt)),
      h('span', { class: `tag kind-${c.type}` }, t(CHECKIN_LABEL[c.type])),
      c.note || '-',
      hasLocation(c) ? h('a', { href: locationUrl(c), target: '_blank', rel: 'noopener' }, `${c.lat.toFixed(4)}, ${c.lng.toFixed(4)} (±${c.accuracy ?? '?'}m)`) : h('span', { class: 'muted' }, t('위치 없음')),
    ])) : empty(t('아직 신고 기록이 없습니다.')));
  }, (err) => box.replaceChildren(h('p', { class: 'text-danger' }, errorMessage(err))));
  window.addEventListener('hashchange', unsub, { once: true });
  return h('div', { class: 'page' },
    pageHeader(t('내 신고 기록'), { crumbs: [{ label: t('설정'), href: '#/settings' }], lead: t('내가 남긴 생존신고와 체크포인트입니다. 관리자도 볼 수 있습니다.') }),
    panel(t('이동 경로'), null, trail.el),
    panel(t('기록'), null, box));
}

// ---------- 인쇄용 비상카드 ----------

export function printView({ state }) {
  const { points } = meetingSchedule(state.meetingPoints, null);
  const myProfile = h('div');
  getProfile(state.me.id).then((p) => {
    myProfile.replaceChildren(
      h('p', null, h('strong', null, state.me.name), ` · ${t('혈액형 {type}', { type: p.bloodType ? t(p.bloodType) : '-' })}${p.emergencyContact ? ` · ${t('비상연락 {contact}', { contact: p.emergencyContact })}` : ''}`),
      p.medical ? h('p', null, t('의료: {text}', { text: p.medical })) : null);
  }).catch(() => {});

  return h('div', { class: 'page print-page' },
    h('div', { class: 'no-print' },
      pageHeader(t('인쇄용 비상카드'), { crumbs: [{ label: t('설정'), href: '#/settings' }], lead: t('종이로 출력해 지갑과 생존배낭에 넣어 두세요. 휴대폰이 꺼져도 볼 수 있습니다.') },
        h('button', { class: 'btn', onClick: () => window.print() }, t('🖨 인쇄')))),
    h('div', { class: 'card print-card' },
      h('h2', null, t('{app} 카드', { app: t(config.appName || '가족 비상연락') })),
      myProfile,
      h('h3', null, t('집합장소 (시간은 1급 비상 발생 기준)')),
      points.length ? h('table', null,
        h('thead', null, h('tr', null, h('th', null, t('순위')), h('th', null, t('장소')), h('th', null, t('시간')), h('th', null, t('좌표')))),
        h('tbody', null, points.map((p) => h('tr', null,
          h('td', null, String(p.rank)),
          h('td', null, p.name, p.address ? h('div', { class: 'small' }, p.address) : null),
          h('td', null, t('{offset}, {min}분 대기', { offset: formatOffset(p.offsetHours), min: p.waitMinutes })),
          h('td', { class: 'small mono' }, hasLocation(p) ? formatDms(p.lat, p.lng) : '-')))))
        : h('p', null, t('집합장소가 아직 없습니다.')),
      h('h3', null, t('가족 연락처')),
      h('table', null, h('tbody', null, state.members.filter((m) => m.active).map((m) => h('tr', null,
        h('td', null, m.name), h('td', null, m.phone || '-'))))),
      h('h3', null, t('긴급 전화')),
      h('p', null, t('119 화재·구조·구급 · 112 경찰 · 122 해양 · 1339 질병관리청 · 182 실종 · 110 정부민원')),
      h('h3', null, t('기억할 것')),
      h('ul', null,
        h('li', null, t('연락이 안 돼도 1순위 집합장소로 간다. 시간이 지나면 다음 순위로.')),
        h('li', null, t('통화보다 문자. 매일 오전 9시·오후 9시에 생존신고.')),
        h('li', null, t('집합장소에 도착하면 기록을 남긴다 (사이트 또는 쪽지).')))));
}
