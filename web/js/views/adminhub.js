// 관리자 설정: 비상 선언·격상·해제, 소리·알림 테스트, 가족 등록·관리, 설정 바로가기를 한 화면에서.
// 기록은 맨 아래에 최근 몇 줄만 보여주고, 전체는 관리자 기록 화면에서 본다.
import { h, field, select, formData, toast, busy, panel, pageHeader, empty, alertBox, table } from '../dom.js';
import { errorMessage } from '../firebase.js';
import { createMember, updateMember, watchEmergencyLog } from '../store.js';
import { emergencyLogTitle, formatDateTime } from '../logic.js';
import { t } from '../i18n.js';
import { emergencyControl, testPanel } from './emergency.js';
import { statusSummary, familyStatusList } from './family.js';

const MAX_MEMBERS = 20;

/** 가족 한 명 빠르게 추가: 이름·전화번호·권한만. 개인정보와 "볼 수 있는 가족"은 나중에 수정 화면에서. */
function quickAddForm(state) {
  const form = h('form', { class: 'stack' },
    h('div', { class: 'field-row' },
      field(t('이름'), h('input', { name: 'name', required: true, maxlength: 40, placeholder: t('예: 엄마') })),
      field(t('전화번호'), h('input', { name: 'phone', type: 'tel', maxlength: 30, inputmode: 'tel', placeholder: '010-0000-0000' }))),
    h('div', { class: 'field-row' },
      field(t('권한'), select('role', [{ value: 'member', label: t('가족') }, { value: 'admin', label: t('관리자') }], 'member')),
      h('div', { class: 'field', style: { alignSelf: 'end' } }, h('button', { class: 'btn btn-block', type: 'submit' }, t('+ 가족 등록')))));
  form.addEventListener('submit', (ev) => {
    ev.preventDefault();
    const d = formData(form);
    const name = d.name.trim();
    if (!name) return;
    if (state.members.length >= MAX_MEMBERS) { toast(t('가족은 최대 {max}명까지 등록할 수 있습니다.', { max: MAX_MEMBERS }), 'error'); return; }
    if (state.members.some((m) => m.name === name)) { toast(t('같은 이름의 가족이 이미 있습니다. 로그인 목록에서 구분되도록 다르게 적어 주세요.'), 'error'); return; }
    busy(form.querySelector('button[type=submit]'), async () => {
      try {
        await createMember({
          name, phone: d.phone.trim(), role: d.role, order: state.members.length + 1, links: [], active: true, declareCredits: 1,
        }, state.gates.gen);
        form.reset();
        toast(t('{name}님을 추가했습니다. {code}를 알려 주면 목록에서 이름을 골라 들어올 수 있습니다.', { name, code: d.role === 'admin' ? t('관리자 코드') : t('가족 코드') }));
      } catch (err) {
        toast(errorMessage(err), 'error');
      }
    });
  });
  return form;
}

function creditCell(m) {
  if (m.role === 'admin') return h('span', { class: 'muted small' }, t('제한 없음'));
  if (m.declareCredits >= 1) return h('span', { class: 'tag status-safe' }, t('{n}회 남음', { n: m.declareCredits }));
  return h('button', {
    class: 'btn btn-sm btn-outline',
    onClick: (ev) => busy(ev.currentTarget, async () => {
      try {
        await updateMember(m.id, { declareCredits: 1 }, m.name);
        toast(t('비상선언권 1회를 다시 줬습니다.'));
      } catch (err) { toast(errorMessage(err), 'error'); }
    }),
  }, t('다시 주기'));
}

function memberTable(state) {
  const list = [...state.members].sort((a, b) => (a.order ?? 99) - (b.order ?? 99));
  if (!list.length) return empty(t('등록된 가족이 없습니다.'));
  return table([t('이름'), t('권한'), t('접근'), t('비상선언권'), t('관리')], list.map((m) => [
    h('a', { href: `#/member/${encodeURIComponent(m.id)}`, class: 'item-title' }, m.name, m.id === state.me.id ? ` (${t('나')})` : ''),
    h('span', { class: `tag ${m.role === 'admin' ? 'tag-light' : ''}` }, m.role === 'admin' ? t('관리자') : t('가족')),
    m.active ? h('span', { class: 'tag status-safe' }, t('활성')) : h('span', { class: 'tag status-unknown' }, t('차단됨')),
    creditCell(m),
    h('a', { class: 'btn btn-sm btn-outline', href: `#/admin/member/${encodeURIComponent(m.id)}` }, t('수정')),
  ]));
}

const SHORTCUTS = [
  ['#/admin/meet', '📍', '집합장소 설정', '1~10순위 장소와 시간'],
  ['#/admin/protocols', '📘', '대처법 관리', '내용·체크리스트 편집'],
  ['#/contacts', '☎️', '연락처 관리', '가족 지정 연락처'],
  ['#/admin/directory', '🗃', '가족 정보 한눈에', '개인정보·연결 상태 표'],
  ['#/settings', '🔑', '접속 코드·오프라인', '코드 바꾸기, 오프라인 준비'],
  ['#/print', '🖨', '인쇄용 비상카드', '지갑·배낭에 넣을 종이 카드'],
];

export function adminHubView({ state, live, onChange }) {
  // 최근 비상 기록 몇 줄만 (전체는 관리자 기록 화면)
  const logBox = h('div', null, h('p', { class: 'muted small' }, t('불러오는 중…')));
  const unsubs = [watchEmergencyLog((list) => {
    logBox.replaceChildren(list.length
      ? h('ul', { class: 'list list-compact' }, list.slice(0, 5).map((l) => h('li', { class: 'list-item small' },
        h('span', { class: 'num muted' }, formatDateTime(l.at)), ' · ', emergencyLogTitle(l), l.byName ? ` · ${l.byName}` : '')))
      : h('p', { class: 'muted small' }, t('기록이 없습니다.')));
  }, () => logBox.replaceChildren(h('p', { class: 'muted small' }, t('기록을 불러오지 못했습니다.'))))];
  const tests = testPanel(state, unsubs, onChange);
  window.addEventListener('hashchange', () => unsubs.forEach((u) => u()), { once: true });

  return h('div', { class: 'page' },
    pageHeader(t('관리자 설정'), { lead: t('비상 선언과 해제, 소리·알림 테스트, 가족 등록을 이 화면에서 합니다.') }),

    panel(t('🚨 비상 선언·해제'), { href: '#/emergency', label: t('비상 경보 화면') },
      live(() => emergencyControl(state)),
      live(() => (state.emergency?.active
        ? h('div', { style: { marginTop: '1rem' } },
          h('h3', { class: 'panel-subhead' }, t('가족 확인 현황')),
          statusSummary(state),
          familyStatusList(state, { compact: true }))
        : null))),

    tests,

    panel(t('👪 가족 등록·관리'), { href: '#/family', label: t('가족 현황') },
      h('h3', { class: 'panel-subhead' }, t('가족 등록')),
      quickAddForm(state),
      h('p', { class: 'muted small' }, t('등록하면 바로 로그인 목록에 이름이 올라갑니다. 가족에게는 가족 코드를 알려 주세요. 혈액형·주소 같은 개인정보와 "볼 수 있는 가족"은 수정에서 넣습니다.')),
      h('h3', { class: 'panel-subhead' }, t('등록된 가족')),
      live(() => memberTable(state)),
      h('p', { class: 'small' }, h('a', { href: '#/admin/member/new' }, t('개인정보까지 한 번에 입력해서 추가하기 →')))),

    panel(t('⚙️ 설정 바로가기'), null,
      h('div', { class: 'tiles' }, SHORTCUTS.map(([href, icon, title, desc]) => h('a', { class: 'tile tile-admin', href },
        h('span', { class: 'tile-icon', 'aria-hidden': 'true' }, icon), h('strong', null, t(title)), h('span', null, t(desc)))))),

    panel(t('최근 기록'), { href: '#/admin/logs', label: t('전체 기록') }, logBox));
}
