// 앱 시작점: 로그인 상태 확인, 실시간 데이터 구독, 화면 전환, 머리말·메뉴·바닥글.
import { isConfigured, watchAuth, config } from './firebase.js';
import { h, mount, toast } from './dom.js';
import { DEFAULT_PROTOCOLS } from './data/protocols.js';
import { formatRemaining, meetingSchedule, emergencyLabel } from './logic.js';
import * as store from './store.js';
import { refreshPushToken } from './push.js';
import { configNeededView, loginView, setupView, notRegisteredView, loadingView } from './views/auth.js';
import { homeView } from './views/home.js';
import { meetView } from './views/meet.js';
import { protocolsView, protocolDetailView } from './views/protocols.js';
import { familyView, memberDetailView } from './views/family.js';
import { emergencyView, maybeAlarm } from './views/emergency.js';
import { memberEditView, meetEditListView, meetEditView, protocolAdminView, protocolEditView } from './views/admin.js';
import { recordsAdminView, directoryView } from './views/records.js';
import { contactsView } from './views/contacts.js';
import { guideView } from './views/guide.js';
import { settingsView, recordsView, printView } from './views/settings.js';

const viewEl = document.getElementById('view');
const navEl = document.getElementById('nav');
const topNavEl = document.getElementById('topnav');
const headerEl = document.getElementById('header');
const bannerEl = document.getElementById('banner');
const footerEl = document.getElementById('footer');

/** 앱 전체 상태. 구독한 데이터가 바뀌면 화면의 live 영역만 다시 그린다. */
export const state = {
  user: null,
  me: null,
  // 관리자: 가족 전체. 일반 가족: 본인 + 관리자가 지정한 최대 3명.
  members: [],
  emergency: null,
  meetingPoints: [],
  serverProtocols: [],
  contacts: [],
  checklist: {},
  online: navigator.onLine,
  get protocols() {
    const list = this.serverProtocols.length ? this.serverProtocols : DEFAULT_PROTOCOLS;
    return [...list].sort((a, b) => (a.order ?? 99) - (b.order ?? 99));
  },
  get isAdmin() {
    return this.me?.role === 'admin';
  },
};

// ---------- 화면 갱신 ----------

let listeners = [];

/** 상태가 바뀔 때마다 fn() 결과로 다시 그려지는 영역 */
export function live(fn, tag = 'div', attrs = {}) {
  const el = h(tag, attrs);
  const draw = () => {
    try {
      mount(el, fn());
    } catch (err) {
      console.error(err);
    }
  };
  listeners.push(draw);
  draw();
  return el;
}

/** 상태가 바뀔 때 호출될 함수 등록 (지도 마커 갱신 등) */
export function onChange(cb) {
  listeners.push(cb);
}

function notify() {
  for (const cb of listeners) cb();
  renderChrome();
}

export function navigate(path) {
  if (location.hash === `#${path}`) route();
  else location.hash = path;
}

// ---------- 라우팅 ----------

const routes = [
  ['/', homeView],
  ['/meet', meetView],
  ['/protocols', protocolsView],
  ['/protocols/:id', protocolDetailView],
  ['/family', familyView],
  ['/member/:uid', memberDetailView],
  ['/contacts', contactsView],
  ['/guide', guideView],
  ['/emergency', emergencyView],
  ['/settings', settingsView],
  ['/records', recordsView],
  ['/print', printView],
  ['/admin/logs', recordsAdminView, true],
  ['/admin/directory', directoryView, true],
  ['/admin/member/:uid', memberEditView, true],
  ['/admin/meet', meetEditListView, true],
  ['/admin/meet/:rank', meetEditView, true],
  ['/admin/protocols', protocolAdminView, true],
  ['/admin/protocols/:id', protocolEditView, true],
];

function match(path) {
  for (const [pattern, view, adminOnly] of routes) {
    const p = pattern.split('/');
    const s = path.split('/');
    if (p.length !== s.length) continue;
    const params = {};
    if (p.every((seg, i) => (seg.startsWith(':') ? ((params[seg.slice(1)] = decodeURIComponent(s[i])), true) : seg === s[i]))) {
      return { view, params, adminOnly };
    }
  }
  return null;
}

function currentPath() {
  return location.hash.replace(/^#/, '') || '/';
}

function route() {
  if (!state.me) return;
  listeners = [];
  const path = currentPath();
  const m = match(path);
  if (!m || (m.adminOnly && !state.isAdmin)) {
    navigate('/');
    return;
  }
  const ctx = { state, params: m.params, navigate, live, onChange };
  try {
    mount(viewEl, m.view(ctx));
  } catch (err) {
    console.error(err);
    mount(viewEl, h('p', { class: 'empty' }, `화면을 그리지 못했습니다: ${err.message}`));
  }
  window.scrollTo(0, 0);
  renderChrome();
}

// ---------- 머리말·메뉴·바닥글 ----------

const NAV = [
  ['/', '🏠', '홈'],
  ['/meet', '📍', '집합장소'],
  ['/protocols', '📘', '대처법'],
  ['/family', '👪', '가족'],
  ['/contacts', '☎️', '연락처'],
  ['/settings', '⚙️', '설정'],
];

// 휴대폰 하단 메뉴는 5칸만
const BOTTOM_NAV = ['/', '/meet', '/protocols', '/family', '/settings'];

function isActive(to, path) {
  const section = '/' + (path.split('/')[1] || '');
  if (to === '/') return path === '/';
  if (to === '/family') return section === '/family' || section === '/member';
  if (to === '/settings') return ['/settings', '/records', '/print', '/guide'].includes(section);
  return section === to;
}

function navLink(to, icon, label, path, cls = '') {
  const active = isActive(to, path);
  return h('a', { href: `#${to}`, class: `${cls}${active ? ' active' : ''}`.trim(), 'aria-current': active ? 'page' : null },
    icon ? h('span', { class: 'nav-icon', 'aria-hidden': 'true' }, icon) : null,
    h('span', null, label));
}

function renderHeader() {
  const e = state.emergency;
  mount(headerEl, h('div', { class: 'site-header-inner' },
    h('a', { class: 'brand-link', href: '#/' },
      h('img', { class: 'brand-mark', src: 'icons/icon.svg', alt: '' }),
      h('span', { class: 'brand-title' },
        h('strong', null, config.appName || '우리 가족 비상연락'),
        h('span', null, 'Family Emergency Response'))),
    h('div', { class: 'header-meta' },
      state.me ? h('span', { class: 'header-user' }, `${state.me.name}${state.isAdmin ? ' · 관리자' : ''}`) : null,
      state.me
        ? (e?.active
          ? h('a', { class: 'pill pill-emergency', href: '#/meet' }, '● 비상')
          : h('span', { class: 'pill pill-normal' }, '● 평상시'))
        : null)));
}

function renderChrome() {
  renderHeader();
  if (!state.me) {
    mount(navEl);
    mount(topNavEl);
    mount(bannerEl, state.online ? null : offlineBanner());
    renderFooter();
    return;
  }
  const path = currentPath();
  mount(topNavEl, h('div', { class: 'top-nav-inner' },
    NAV.map(([to, , label]) => navLink(to, null, label, path)),
    state.isAdmin ? navLink('/admin/logs', null, '관리자 기록', path, 'nav-admin') : null));
  mount(navEl, NAV.filter(([to]) => BOTTOM_NAV.includes(to)).map(([to, icon, label]) => navLink(to, icon, label, path)));
  mount(bannerEl, state.online ? null : offlineBanner(), emergencyBanner());
  renderFooter();
}

function offlineBanner() {
  return h('div', { class: 'offline-banner', role: 'status' },
    h('div', null, '오프라인 상태입니다. 저장된 정보를 보여주고, 생존신고는 휴대폰에 보관했다가 연결되면 자동 전송합니다. GPS 위치 확인은 계속 됩니다.'));
}

function emergencyBanner() {
  const e = state.emergency;
  if (!e?.active) return null;
  const { currentRank, points } = meetingSchedule(state.meetingPoints, e);
  const target = points.find((p) => p.rank === currentRank);
  return h('a', { class: 'emergency-banner', href: '#/meet', role: 'alert' },
    h('div', { class: 'emergency-banner-inner' },
      h('span', { class: 'pulse-dot', 'aria-hidden': 'true' }),
      h('strong', null, `비상 선언 — ${emergencyLabel(e.type)}`),
      target ? h('span', { class: 'banner-target' }, `지금 갈 곳: ${target.rank}순위 ${target.name}`) : h('span', null, '집합장소 확인')));
}

function renderFooter() {
  mount(footerEl,
    h('div', { class: 'site-footer-inner' },
      h('div', null,
        h('h2', null, config.appName || '우리 가족 비상연락'),
        h('p', null, '비상 상황에서 가족의 안전을 확인하고 다시 모이기 위한 가족 전용 서비스입니다.'),
        h('p', null, '이 사이트는 개인이 운영하는 서비스이며, 어떤 정부기관과도 관련이 없습니다. 실제 재난 시에는 재난문자와 공공기관의 안내를 우선 따르세요.')),
      h('div', null,
        h('h2', null, '바로가기'),
        h('ul', null,
          h('li', null, h('a', { href: '#/guide' }, '사용 안내')),
          h('li', null, h('a', { href: '#/contacts' }, '비상 연락처')),
          h('li', null, h('a', { href: '#/protocols' }, '상황별 대처법')),
          h('li', null, h('a', { href: '#/print' }, '인쇄용 비상카드')))),
      h('div', null,
        h('h2', null, '긴급 신고'),
        h('ul', null,
          h('li', null, h('a', { href: 'tel:119' }, '119 화재·구조·구급')),
          h('li', null, h('a', { href: 'tel:112' }, '112 경찰')),
          h('li', null, h('a', { href: 'tel:1339' }, '1339 질병관리청'))))),
    h('div', { class: 'site-footer-bottom' },
      h('div', null,
        h('span', null, `버전 ${document.documentElement.dataset.build || 'dev'}`),
        h('span', null, '디자인: U.S. Web Design System 원칙 참고'))));
}

// ---------- 글자 크기 ----------

const FONT_KEY = 'family.fontScale';

function applyFontScale(scale) {
  document.documentElement.dataset.fontScale = scale;
  for (const b of document.querySelectorAll('[data-font]')) b.setAttribute('aria-pressed', String(b.dataset.font === scale));
  try { localStorage.setItem(FONT_KEY, scale); } catch { /* 무시 */ }
}

function setupFontControls() {
  let saved = 'md';
  try { saved = localStorage.getItem(FONT_KEY) || 'md'; } catch { /* 무시 */ }
  for (const b of document.querySelectorAll('[data-font]')) b.addEventListener('click', () => applyFontScale(b.dataset.font));
  applyFontScale(saved);
}

// 남은 시간 표시(data-until)는 30초마다 갱신
setInterval(() => {
  for (const el of document.querySelectorAll('[data-until]')) {
    el.textContent = formatRemaining(Number(el.dataset.until) - Date.now());
  }
}, 30_000);

// ---------- 데이터 구독 ----------

let meUnsub = null;
let unsubs = [];
let linkUnsubs = new Map();
let linkedDocs = new Map();
let subsKey = '';

function stopDataSubscriptions() {
  for (const u of unsubs) u();
  unsubs = [];
  for (const u of linkUnsubs.values()) u();
  linkUnsubs = new Map();
  linkedDocs = new Map();
  subsKey = '';
}

function stopSubscriptions() {
  stopDataSubscriptions();
  if (meUnsub) meUnsub();
  meUnsub = null;
}

// 거부된 구독은 다시 살아나지 않으므로, 아직 가족으로 등록돼 있으면 잠시 뒤 전체를 다시 구독한다.
let retryTimer = null;
function onSubError(err) {
  console.error(err);
  if (retryTimer || !state.user) return;
  retryTimer = setTimeout(() => {
    retryTimer = null;
    if (state.me && state.user) {
      stopDataSubscriptions();
      startDataSubscriptions();
    }
  }, 5000);
}

function sortMembers(list) {
  return list.sort((a, b) => (a.order ?? 99) - (b.order ?? 99) || a.name.localeCompare(b.name, 'ko'));
}

/** 일반 가족: 본인 + 지정된 가족 문서만 하나씩 구독 */
function refreshLinkedMembers() {
  if (state.isAdmin) return;
  state.members = sortMembers([state.me, ...linkedDocs.values()].filter(Boolean));
}

function syncLinkSubscriptions() {
  const wanted = new Set((state.me.links || []).filter((id) => id && id !== state.me.id).slice(0, 3));
  for (const [id, u] of linkUnsubs) {
    if (!wanted.has(id)) {
      u();
      linkUnsubs.delete(id);
      linkedDocs.delete(id);
    }
  }
  for (const id of wanted) {
    if (linkUnsubs.has(id)) continue;
    linkUnsubs.set(id, store.watchDoc(['members', id], (m) => {
      if (m && m.active) linkedDocs.set(id, m);
      else linkedDocs.delete(id);
      refreshLinkedMembers();
      notify();
    }, (err) => {
      // 지정이 풀린 직후 등 권한이 없으면 조용히 뺀다.
      console.warn('지정된 가족을 읽을 수 없습니다', id, err.code);
      linkedDocs.delete(id);
      refreshLinkedMembers();
      notify();
    }));
  }
  refreshLinkedMembers();
}

// 내 members 문서를 계속 지켜본다. 등록되면 바로 홈으로, 삭제·비활성화되면 바로 차단 화면으로.
function startSubscriptions(uid) {
  stopSubscriptions();
  let active = false;
  meUnsub = store.watchDoc(['members', uid], (me, snap) => {
    // 방금 등록한 문서가 아직 서버에 저장되기 전이면 기다린다. 서버가 모르는 상태로 구독하면 거부된다.
    if (!active && snap.metadata.hasPendingWrites) return;
    state.me = me && me.active ? me : null;
    store.setActor(state.me);
    if (!state.me) {
      active = false;
      stopDataSubscriptions();
      listeners = [];
      mount(viewEl, notRegisteredView(state.user));
      renderChrome();
      return;
    }
    // 권한이 바뀌면 (관리자 ↔ 가족) 구독 범위가 달라지므로 다시 구독한다.
    const key = state.me.role;
    if (!active || key !== subsKey) {
      const first = !active;
      active = true;
      stopDataSubscriptions();
      startDataSubscriptions();
      if (first) {
        route();
        refreshPushToken(uid);
      } else {
        route();
      }
    } else {
      if (!state.isAdmin) syncLinkSubscriptions();
      notify();
    }
  }, (err) => {
    console.error(err);
    mount(viewEl, notRegisteredView(state.user));
  });
}

function startDataSubscriptions() {
  const uid = state.me.id;
  subsKey = state.me.role;
  if (state.isAdmin) {
    unsubs.push(store.watchMembers((list) => {
      state.members = sortMembers(list);
      notify();
    }, onSubError));
  } else {
    syncLinkSubscriptions();
  }
  unsubs.push(store.watchEmergency((e) => {
    state.emergency = e;
    notify();
    maybeAlarm(state);
  }, onSubError));
  unsubs.push(store.watchMeetingPoints((list) => {
    state.meetingPoints = list.sort((a, b) => a.rank - b.rank);
    notify();
  }, onSubError));
  unsubs.push(store.watchProtocols((list) => {
    state.serverProtocols = list;
    notify();
  }, onSubError));
  unsubs.push(store.watchContacts((list) => {
    state.contacts = list.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    notify();
  }, onSubError));
  unsubs.push(store.watchChecklist(uid, (d) => {
    state.checklist = d?.done || {};
    notify();
  }, onSubError));
}

// ---------- 시작 ----------

function showSignedOut() {
  mount(viewEl, currentPath() === '/setup' ? setupView({ navigate }) : loginView({ navigate }));
}

function start() {
  setupFontControls();
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch((err) => console.warn('서비스 워커 등록 실패', err));
  }
  window.addEventListener('online', () => { state.online = true; renderChrome(); });
  window.addEventListener('offline', () => { state.online = false; renderChrome(); });
  renderChrome();

  if (!isConfigured) {
    mount(viewEl, configNeededView());
    return;
  }

  mount(viewEl, loadingView());
  window.addEventListener('hashchange', () => {
    if (state.me) route();
    else if (!state.user) showSignedOut();
  });

  watchAuth((user) => {
    state.user = user;
    state.me = null;
    store.setActor(null);
    stopSubscriptions();
    listeners = [];
    renderChrome();
    if (!user) {
      showSignedOut();
      return;
    }
    startSubscriptions(user.uid);
  });
}

// 화면이 다시 보일 때 남은 시간 즉시 갱신
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && state.me) notify();
});

window.addEventListener('error', (e) => {
  if (String(e.message).includes('ResizeObserver')) return;
  toast('문제가 생겼습니다. 화면을 새로고침해 주세요.', 'error');
});

start();
