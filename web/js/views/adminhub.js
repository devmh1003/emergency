// 관리자 설정: 비상 선언·격상·해제, 소리·알림 테스트, 가족 등록·관리, 설정 바로가기를 한 화면에서.
// 기록은 맨 아래에 최근 몇 줄만 보여주고, 전체는 관리자 기록 화면에서 본다.
import { h, field, select, formData, toast, busy, panel, pageHeader, empty, alertBox, table } from '../dom.js';
import { errorMessage } from '../firebase.js';
import {
  createMember, updateMember, watchEmergencyLog, watchDisasterSettings, watchDisasterFeed, saveDisasterSettings,
  watchLoginLocks, clearLoginLock,
} from '../store.js';
import { emergencyLogTitle, formatDateTime, toDate } from '../logic.js';
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

// 알림 서버는 1~2분마다 확인한다. 이보다 오래 소식이 없으면 멈춘 것으로 본다.
const FEED_STALE_MS = 5 * 60 * 1000;
// 재난문자 인증키 하나의 하루 호출 한도 (알림 서버가 940번 안에서 나눠 쓴다)
const DAILY_LIMIT = 1000;
const DAILY_BUDGET = 940;

/** "오늘 312/1,000회 사용 · 지금 2분마다 확인" (한국 시각 날짜가 바뀌면 0부터) */
function feedUsage(feed) {
  const today = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10).replace(/-/g, '');
  const used = feed?.callsDay === today ? Number(feed.calls) || 0 : 0;
  const every = feed?.callsDay === today ? Number(feed.every) || 0 : 0;
  return h('p', { class: 'muted small' }, every
    ? t('오늘 재난문자 조회 {used}/{limit}회 · 지금 {every}분마다 확인', { used, limit: DAILY_LIMIT.toLocaleString(), every })
    : t('오늘 재난문자 조회 {used}/{limit}회', { used, limit: DAILY_LIMIT.toLocaleString() }));
}

function feedStatus(feed) {
  if (!feed?.checkedAt) {
    return alertBox('warning', null, h('p', null, t('알림 서버가 아직 재난문자를 확인하지 않았습니다. 재난문자 인증키를 알림 서버에 등록하면 1분 안에 시작합니다.')));
  }
  const at = toDate(feed.checkedAt);
  if (feed.error) {
    return alertBox('error', null, h('p', null, t('재난문자를 받아 오지 못했습니다 ({time}): {error}', { time: formatDateTime(at), error: feed.error })));
  }
  const today = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10).replace(/-/g, '');
  if (feed.callsDay === today && Number(feed.calls) >= DAILY_BUDGET) {
    return alertBox('warning', null, h('p', null, t('오늘 재난문자 조회 한도를 다 써서 자정(한국 시각)까지 확인을 쉽니다. 마지막 확인: {time}', { time: formatDateTime(at) })));
  }
  if (!at || Date.now() - at.getTime() > FEED_STALE_MS) {
    return alertBox('warning', null, h('p', null, t('최근 5분 동안 재난문자를 확인하지 않았습니다. 마지막 확인: {time}', { time: formatDateTime(at) })));
  }
  return alertBox('success', null, h('p', null, t('정상 작동 중 · 마지막 확인 {time}', { time: formatDateTime(at) })));
}

function lastHit(feed) {
  if (!feed?.lastHitAt) return h('p', { class: 'muted small' }, t('아직 자동 경보가 울린 적이 없습니다.'));
  const level = feed.lastHitLevel === 'alert' ? t('2급') : t('1급');
  const action = feed.lastHitAction === 'skip' ? t('이미 비상 중이라 새로 선언하지 않음') : t('자동 선언');
  return h('div', { class: 'small' },
    h('p', null, h('strong', null, t('마지막 자동 경보')), ` · ${formatDateTime(feed.lastHitAt)} · ${level} · ${feed.lastHitKind || ''} · ${action}`),
    feed.lastHitRegion ? h('p', { class: 'muted' }, feed.lastHitRegion) : null,
    h('p', null, feed.lastHitText || ''));
}

/** 정부 긴급재난문자 자동 경보: 켜기·지역·2급 알림, 알림 서버의 확인 상태 */
function disasterPanel(state, unsubs) {
  const enabled = h('input', { type: 'checkbox', name: 'enabled', checked: true });
  const regions = h('input', { name: 'regions', maxlength: 300, placeholder: t('예: 서울, 경기 수원') });
  const level2 = h('input', { type: 'checkbox', name: 'level2' });
  const saved = h('p', { class: 'muted small' });
  const status = h('div', null, h('p', { class: 'muted small' }, t('불러오는 중…')));
  const hit = h('div');

  const form = h('form', { class: 'stack' },
    h('label', { class: 'check' }, enabled, h('span', null, h('strong', null, t('재난문자로 자동 경보 켜기')))),
    field(t('우리 가족 지역'), regions, t('쉼표로 여러 곳을 적습니다. 비워 두면 전국 어디의 재난문자로도 울립니다.')),
    h('label', { class: 'check' }, level2, h('span', null, t('그 밖의 긴급재난(호우·산불 대피 등)은 2급 알림으로 받기'))),
    h('div', { class: 'row' }, h('button', { class: 'btn btn-sm', type: 'submit' }, t('저장'))),
    saved);
  form.addEventListener('submit', (ev) => {
    ev.preventDefault();
    const list = regions.value.split(/[,，]/).map((r) => r.trim().slice(0, 40)).filter(Boolean).slice(0, 20);
    busy(form.querySelector('button[type=submit]'), async () => {
      try {
        await saveDisasterSettings(state.me, { enabled: enabled.checked, regions: list, level2: level2.checked });
        toast(t('저장했습니다.'));
      } catch (err) { toast(errorMessage(err), 'error'); }
    });
  });

  unsubs.push(watchDisasterSettings((doc) => {
    enabled.checked = doc?.enabled !== false;
    level2.checked = doc?.level2 === true;
    if (document.activeElement !== regions) regions.value = (doc?.regions || []).join(', ');
    saved.textContent = doc?.updatedAt ? t('{name} · {time} 저장', { name: doc.updatedByName || '', time: formatDateTime(doc.updatedAt) }) : '';
  }, () => {}));
  unsubs.push(watchDisasterFeed((feed) => {
    status.replaceChildren(feedStatus(feed), feed?.checkedAt ? feedUsage(feed) : '');
    hit.replaceChildren(lastHit(feed));
  }, () => status.replaceChildren(h('p', { class: 'muted small' }, t('상태를 불러오지 못했습니다.')))));

  return panel(t('📡 정부 재난문자 자동 경보'), null,
    h('p', { class: 'small' }, t('행정안전부 긴급재난문자를 1~2분마다 확인합니다. 공습·경계경보 같은 위급재난과 지진·지진해일 문자가 우리 지역에 오면 1급 비상을 자동으로 선언해 가족 모두의 휴대폰에서 경보음이 울립니다.')),
    h('p', { class: 'muted small' }, t('조회는 하루 1,000번까지라 남은 횟수를 자정까지 나눠 씁니다. 우리 지역에 긴급 재난문자가 오거나 비상 중일 때는 1분마다 봅니다.')),
    h('p', { class: 'muted small' }, t('안전안내 문자, 훈련 안내, 해제 안내로는 울리지 않습니다. 이미 비상 중이면 새로 선언하지 않고, 해제는 관리자가 직접 합니다.')),
    status,
    form,
    h('h3', { class: 'panel-subhead' }, t('최근 자동 경보')),
    hit);
}

/** 접속 코드를 3번 틀려 잠긴 기기·인터넷 주소. 가족이 실수로 잠겼으면 여기서 풀어 준다. */
function lockPanel(unsubs) {
  const box = h('div', null, h('p', { class: 'muted small' }, t('불러오는 중…')));
  unsubs.push(watchLoginLocks((list) => {
    const now = Date.now();
    const locked = list.filter((l) => toDate(l.lockedUntil)?.getTime() > now)
      .sort((a, b) => toDate(b.lastAt) - toDate(a.lastAt));
    const trying = list.filter((l) => !locked.includes(l) && l.fails > 0 && now - (toDate(l.firstFailAt)?.getTime() || 0) < 24 * 3600e3);
    if (!locked.length && !trying.length) {
      box.replaceChildren(h('p', { class: 'muted small' }, t('잠긴 곳이 없습니다.')));
      return;
    }
    box.replaceChildren(h('ul', { class: 'list list-compact' }, [...locked, ...trying].map((l) => h('li', { class: 'list-item small' },
      h('span', null, h('strong', null, l.kind === 'device' ? t('기기') : t('인터넷 주소')), ` ${l.label || ''} · `,
        locked.includes(l) ? t('{time}까지 잠김', { time: formatDateTime(l.lockedUntil) }) : t('{n}번 틀림 (잠기지 않음)', { n: l.fails })),
      ' ',
      h('button', {
        class: 'btn btn-sm btn-outline',
        onClick: (ev) => busy(ev.currentTarget, async () => {
          try {
            await clearLoginLock(l);
            toast(t('잠금을 풀었습니다.'));
          } catch (err) { toast(errorMessage(err), 'error'); }
        }),
      }, locked.includes(l) ? t('잠금 풀기') : t('기록 지우기'))))));
  }, () => box.replaceChildren(h('p', { class: 'muted small' }, t('상태를 불러오지 못했습니다.')))));
  return panel(t('🔒 접속 잠금'), null,
    h('p', { class: 'small muted' }, t('같은 휴대폰이나 같은 인터넷(집 와이파이 등)에서 접속 코드를 3번 틀리면 하루 동안 새로 들어올 수 없습니다. 이미 들어와 있는 휴대폰은 그대로 씁니다. 가족이 실수로 잠겼다면 풀어 주세요.')),
    box);
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
    pageHeader(t('관리자 설정'), { lead: t('비상 선언과 해제, 소리·알림 테스트, 가족 등록을 이 화면에서 합니다.') },
      h('button', {
        type: 'button', class: 'btn btn-outline',
        onClick: () => document.getElementById('test-alarm')?.scrollIntoView({ behavior: 'smooth', block: 'start' }),
      }, t('🔔 테스트 경보'))),

    panel(t('🚨 비상 선언·해제'), { href: '#/emergency', label: t('비상 경보 화면') },
      live(() => emergencyControl(state)),
      live(() => (state.emergency?.active
        ? h('div', { style: { marginTop: '1rem' } },
          h('h3', { class: 'panel-subhead' }, t('가족 확인 현황')),
          statusSummary(state),
          familyStatusList(state, { compact: true }))
        : null))),

    disasterPanel(state, unsubs),

    lockPanel(unsubs),

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
