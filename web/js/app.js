// 앱 시작점: 로그인 상태 확인, 실시간 데이터 구독, 화면 전환.
import { isConfigured, watchAuth } from './firebase.js';
import { h, mount, toast } from './dom.js';
import { DEFAULT_PROTOCOLS } from './data/protocols.js';
import { formatRemaining } from './logic.js';
import * as store from './store.js';
import { refreshPushToken } from './push.js';
import { configNeededView, loginView, setupView, notRegisteredView, loadingView } from './views/auth.js';
import { homeView } from './views/home.js';
import { meetView } from './views/meet.js';
import { protocolsView, protocolDetailView } from './views/protocols.js';
import { familyView, memberDetailView } from './views/family.js';
import { emergencyView, emergencyBanner, maybeAlarm } from './views/emergency.js';
import { memberEditView, meetEditListView, meetEditView, protocolAdminView, protocolEditView } from './views/admin.js';
import { settingsView, recordsView, printView } from './views/settings.js';

const viewEl = document.getElementById('view');
const navEl = document.getElementById('nav');
const bannerEl = document.getElementById('banner');

/** 앱 전체 상태. 구독한 데이터가 바뀌면 화면의 live 영역만 다시 그린다. */
export const state = {
  user: null,
  me: null,
  members: [],
  emergency: null,
  meetingPoints: [],
  serverProtocols: [],
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
  ['/emergency', emergencyView],
  ['/settings', settingsView],
  ['/records', recordsView],
  ['/print', printView],
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

const NAV = [
  ['/', '🏠', '홈'],
  ['/meet', '📍', '집합'],
  ['/protocols', '📘', '대처법'],
  ['/family', '👪', '가족'],
  ['/settings', '⚙️', '설정'],
];

function renderChrome() {
  if (!state.me) {
    mount(navEl);
    mount(bannerEl);
    return;
  }
  const path = currentPath();
  const section = '/' + (path.split('/')[1] || '');
  mount(navEl, NAV.map(([to, icon, label]) => {
    const active = to === '/' ? path === '/' : section === to || (to === '/family' && section === '/member');
    return h('a', { href: `#${to}`, class: active ? 'active' : '', 'aria-current': active ? 'page' : null },
      h('span', { class: 'nav-icon', 'aria-hidden': 'true' }, icon), h('span', null, label));
  }));
  mount(bannerEl,
    state.online ? null : h('div', { class: 'offline-bar' }, '오프라인 — 저장된 정보를 보여줍니다. 신고는 연결되면 자동 전송됩니다.'),
    emergencyBanner(state));
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

function stopDataSubscriptions() {
  for (const u of unsubs) u();
  unsubs = [];
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
      startDataSubscriptions(state.user.uid);
    }
  }, 5000);
}

// 내 members 문서를 계속 지켜본다. 등록되면 바로 홈으로, 삭제·비활성화되면 바로 차단 화면으로.
function startSubscriptions(uid) {
  stopSubscriptions();
  let active = false;
  meUnsub = store.watchDoc(['members', uid], (me, snap) => {
    // 방금 등록한 문서가 아직 서버에 저장되기 전이면 기다린다. 서버가 모르는 상태로 구독하면 거부된다.
    if (!active && snap.metadata.hasPendingWrites) return;
    state.me = me && me.active ? me : null;
    if (!state.me) {
      active = false;
      stopDataSubscriptions();
      listeners = [];
      mount(viewEl, notRegisteredView(state.user));
      renderChrome();
      return;
    }
    if (!active) {
      active = true;
      startDataSubscriptions(uid);
      route();
      refreshPushToken(uid);
    } else {
      notify();
    }
  }, (err) => {
    console.error(err);
    mount(viewEl, notRegisteredView(state.user));
  });
}

function startDataSubscriptions(uid) {
  unsubs.push(store.watchMembers((list) => {
    state.members = list.sort((a, b) => (a.order ?? 99) - (b.order ?? 99) || a.name.localeCompare(b.name, 'ko'));
    notify();
  }, onSubError));
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
  unsubs.push(store.watchChecklist(uid, (d) => {
    state.checklist = d?.done || {};
    notify();
  }, onSubError));
}

// ---------- 시작 ----------

function start() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch((err) => console.warn('서비스 워커 등록 실패', err));
  }
  window.addEventListener('online', () => { state.online = true; renderChrome(); });
  window.addEventListener('offline', () => { state.online = false; renderChrome(); });

  if (!isConfigured) {
    mount(viewEl, configNeededView());
    return;
  }

  mount(viewEl, loadingView());
  window.addEventListener('hashchange', route);

  watchAuth(async (user) => {
    state.user = user;
    state.me = null;
    stopSubscriptions();
    listeners = [];
    renderChrome();
    if (!user) {
      mount(viewEl, currentPath() === '/setup' ? setupView({ navigate }) : loginView({ navigate }));
      return;
    }
    startSubscriptions(user.uid);
  });

  // 로그인 전 "초기 설정" 링크
  window.addEventListener('hashchange', () => {
    if (!state.user && isConfigured) {
      mount(viewEl, currentPath() === '/setup' ? setupView({ navigate }) : loginView({ navigate }));
    }
  });
}

// 화면이 다시 보일 때 남은 시간 즉시 갱신
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && state.me) notify();
});

start();
