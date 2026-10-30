// 앱 시작점: 로그인 상태 확인, 실시간 데이터 구독, 화면 전환, 머리말·메뉴·바닥글.
import { isConfigured, watchAuth, config, logout } from './firebase.js';
import { h, mount, toast, savedFontScale, ask } from './dom.js';
import { DEFAULT_PROTOCOLS, RETIRED_PROTOCOL_IDS } from './data/protocols.js';
import { DEFAULT_PROTOCOLS_EN } from './data/protocols.en.js';
import { t, lang } from './i18n.js';
import { maybeAutoPrepare, prepareOffline } from './offline.js';
import { formatRemaining, meetingSchedule, emergencyLabel, emergencyLevel, toDate } from './logic.js';
import * as store from './store.js';
import { refreshPushToken } from './push.js';
import { standbyWanted, startStandby } from './siren.js';
import {
  configNeededView, loginView, setupView, notRegisteredView, loadingView, pickerView, backupView, langToggle,
} from './views/auth.js';
import { homeView } from './views/home.js';
import { meetView } from './views/meet.js';
import { protocolsView, protocolDetailView } from './views/protocols.js';
import { familyView, memberDetailView } from './views/family.js';
import { emergencyView, maybeAlarm, maybeTestAlarm, applyNativeAck } from './views/emergency.js';
import { memberEditView, meetEditListView, meetEditView, protocolAdminView, protocolEditView } from './views/admin.js';
import { recordsAdminView, directoryView } from './views/records.js';
import { adminHubView } from './views/adminhub.js';
import { contactsView } from './views/contacts.js';
import { guideView } from './views/guide.js';
import { sosView } from './views/sos.js';
import { suppliesView } from './views/supplies.js';
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
  // public/gates: 접속 코드(관문 계정)와 세대. 세대가 다른 가족 문서는 예전 방식 계정이다.
  gates: null,
  // 관리자 화면용: 예전 방식으로 남아 있는 가족 문서 (정리 대상)
  legacyMembers: [],
  // 관리자: 가족 전체. 일반 가족: 본인 + 관리자가 지정한 최대 3명.
  members: [],
  emergency: null,
  meetingPoints: [],
  serverProtocols: [],
  contacts: [],
  supplies: [],
  disasterRecent: null,
  checklist: {},
  online: navigator.onLine,
  // Firestore 서버에 실제로 닿는지 (와이파이는 되는데 인터넷이 안 되면 navigator.onLine 은 true 라 이 값으로 안다)
  serverReachable: true,
  get protocols() {
    // 영어 화면: 기본 대처법은 영어판을 쓰고, 관리자가 따로 추가한 대처법만 서버 것을 붙인다.
    // 한국어: 서버 대처법이 우선이고, 서버에 없는 기본 대처법(새로 추가된 것)은 뒤에 붙인다.
    let list;
    const server = this.serverProtocols.filter((p) => !RETIRED_PROTOCOL_IDS.includes(p.id));
    if (lang === 'en') {
      const builtIn = new Set(DEFAULT_PROTOCOLS_EN.map((p) => p.id));
      list = [...DEFAULT_PROTOCOLS_EN, ...server.filter((p) => !builtIn.has(p.id))];
    } else {
      const onServer = new Set(server.map((p) => p.id));
      list = [...server, ...DEFAULT_PROTOCOLS.filter((p) => !onServer.has(p.id))];
    }
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
  ['/sos', sosView],
  ['/supplies', suppliesView],
  ['/emergency', emergencyView],
  ['/settings', settingsView],
  ['/records', recordsView],
  ['/print', printView],
  ['/admin', adminHubView, true],
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
    mount(viewEl, h('p', { class: 'empty' }, t('화면을 그리지 못했습니다: {error}', { error: err.message })));
  }
  window.scrollTo(0, 0);
  renderChrome();
}

// ---------- 머리말·메뉴·바닥글 ----------

const NAV = [
  ['/', '🏠', t('홈')],
  ['/meet', '📍', t('집합장소')],
  ['/protocols', '📘', t('대처법')],
  ['/family', '👪', t('가족')],
  ['/contacts', '☎️', t('연락처')],
  ['/settings', '⚙️', t('설정')],
];

// 휴대폰 하단 메뉴는 5칸만. 관리자는 대처법 대신 관리자 설정 (대처법은 홈 바로가기에 있다).
const BOTTOM_NAV = ['/', '/meet', '/protocols', '/family', '/settings'];
const ADMIN_BOTTOM_NAV = ['/', '/meet', '/family', '/admin', '/settings'];
const ADMIN_NAV = ['/admin', '🛠', t('관리자')];

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
        h('strong', null, t(config.appName || '우리 가족 비상연락')),
        h('span', null, 'Family Emergency Response'))),
    h('div', { class: 'header-meta' },
      state.me ? h('span', { class: 'header-user' }, `${state.me.name}${state.isAdmin ? ` · ${t('관리자')}` : ''}`) : null,
      langToggle('btn btn-outline btn-sm header-lang'),
      state.me ? statusPill(emergencyLevel(e)) : null)));
}

function statusPill(level) {
  if (level === 'real') return h('a', { class: 'pill pill-emergency', href: '#/meet' }, t('● 1급 비상'));
  if (level === 'alert') return h('a', { class: 'pill pill-alert', href: '#/emergency' }, t('● 2급 비상'));
  return h('span', { class: 'pill pill-normal' }, t('● 평상시'));
}

function renderChrome() {
  renderHeader();
  if (!state.me) {
    mount(navEl);
    mount(topNavEl);
    mount(bannerEl, state.online && state.serverReachable ? null : offlineBanner());
    renderFooter();
    return;
  }
  const path = currentPath();
  mount(topNavEl, h('div', { class: 'top-nav-inner' },
    NAV.map(([to, , label]) => navLink(to, null, label, path)),
    state.isAdmin ? navLink(ADMIN_NAV[0], null, ADMIN_NAV[2], path, 'nav-admin') : null));
  const bottom = state.isAdmin ? ADMIN_BOTTOM_NAV : BOTTOM_NAV;
  mount(navEl, bottom.map((to) => [...NAV, ADMIN_NAV].find(([x]) => x === to)).map(([to, icon, label]) => navLink(to, icon, label, path)));
  mount(bannerEl, state.online && state.serverReachable ? null : offlineBanner(), emergencyBanner());
  renderFooter();
}

function offlineBanner() {
  return h('div', { class: 'offline-banner', role: 'status' },
    h('div', null, state.online
      ? t('서버에 연결되지 않습니다 (인터넷이 안 되는 와이파이일 수 있습니다). 저장된 정보를 보여주고, 신고·선언은 휴대폰에 보관했다가 연결되면 자동 전송합니다.')
      : t('오프라인 상태입니다. 저장된 정보를 보여주고, 생존신고는 휴대폰에 보관했다가 연결되면 자동 전송합니다. GPS 위치 확인은 계속 됩니다.')));
}

// 서버에 닿지 않는 상태가 잠깐(처음 열 때 저장본을 먼저 보여 주는 순간)이 아니라 이어질 때만 띠를 보인다.
let unreachableTimer = null;
function noteServerReachable(reachable) {
  clearTimeout(unreachableTimer);
  unreachableTimer = null;
  if (reachable) {
    if (!state.serverReachable) { state.serverReachable = true; renderChrome(); }
    return;
  }
  if (state.serverReachable) {
    unreachableTimer = setTimeout(() => { state.serverReachable = false; renderChrome(); }, 8000);
  }
}

function emergencyBanner() {
  const e = state.emergency;
  const level = emergencyLevel(e);
  if (!level) return null;
  if (level === 'alert') {
    return h('a', { class: 'emergency-banner banner-alert', href: '#/emergency', role: 'alert' },
      h('div', { class: 'emergency-banner-inner' },
        h('span', { class: 'pulse-dot', 'aria-hidden': 'true' }),
        h('strong', null, t('2급 비상 발령 — {type}', { type: emergencyLabel(e.type) })),
        h('span', { class: 'banner-target' }, t('생존신고를 하고 대비하세요'))));
  }
  const { currentRank, points } = meetingSchedule(state.meetingPoints, e);
  const target = points.find((p) => p.rank === currentRank);
  return h('a', { class: 'emergency-banner', href: '#/meet', role: 'alert' },
    h('div', { class: 'emergency-banner-inner' },
      h('span', { class: 'pulse-dot', 'aria-hidden': 'true' }),
      h('strong', null, t('1급 비상 — {type}', { type: emergencyLabel(e.type) })),
      target ? h('span', { class: 'banner-target' }, t('지금 갈 곳: {rank}순위 {name}', { rank: target.rank, name: target.name })) : h('span', null, t('집합장소 확인'))));
}

function renderFooter() {
  mount(footerEl,
    h('div', { class: 'site-footer-inner' },
      h('div', null,
        h('h2', null, t(config.appName || '우리 가족 비상연락')),
        h('p', null, t('비상 상황에서 가족의 안전을 확인하고 다시 모이기 위한 가족 전용 서비스입니다.')),
        h('p', null, t('실제 재난 시에는 재난문자와 공공기관의 안내를 함께 확인하세요.'))),
      h('div', null,
        h('h2', null, t('바로가기')),
        h('ul', null,
          h('li', null, h('a', { href: '#/guide' }, t('사용 안내'))),
          h('li', null, h('a', { href: '#/contacts' }, t('비상 연락처'))),
          h('li', null, h('a', { href: '#/protocols' }, t('상황별 대처법'))),
          h('li', null, h('a', { href: '#/print' }, t('인쇄용 비상카드'))))),
      h('div', null,
        h('h2', null, t('긴급 신고')),
        h('ul', null,
          h('li', null, h('a', { href: 'tel:119' }, t('119 화재·구조·구급'))),
          h('li', null, h('a', { href: 'tel:112' }, t('112 경찰'))),
          h('li', null, h('a', { href: 'tel:1339' }, t('1339 질병관리청')))))),
    h('div', { class: 'site-footer-bottom' },
      h('div', null,
        h('span', null, t('버전 {build}', { build: document.documentElement.dataset.build || 'dev' })))));
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

// ---------- 가족의 도움 요청 ----------
// 사이트·앱을 보고 있을 때는 휴대폰 알림이 따로 뜨지 않으므로, 볼 수 있는 가족이 도움을 요청하면 바로 창을 띄운다.
const HELP_FRESH_MS = 30 * 60 * 1000;
const HELP_SEEN_KEY = 'family.helpSeen';
let helpShowing = false;

function helpSeen() {
  try { return JSON.parse(localStorage.getItem(HELP_SEEN_KEY) || '[]'); } catch { return []; }
}

async function maybeHelpAlert() {
  if (helpShowing || !state.me) return;
  const seen = helpSeen();
  const keyOf = (m) => `${m.id}:${toDate(m.last.clientAt || m.last.at)?.getTime() || 0}`;
  const m = state.members.find((x) => x.id !== state.me.id && x.last?.type === 'help'
    && Date.now() - (toDate(x.last.clientAt || x.last.at)?.getTime() || 0) < HELP_FRESH_MS
    && !seen.includes(keyOf(x)));
  if (!m) return;
  try { localStorage.setItem(HELP_SEEN_KEY, JSON.stringify([...seen, keyOf(m)].slice(-20))); } catch { /* 무시 */ }
  helpShowing = true;
  try { navigator.vibrate?.([400, 200, 400, 200, 400]); } catch { /* 무시 */ }
  const go = await ask(t('🆘 {name}님이 도움을 요청했습니다.{note}', { name: m.name, note: m.last.note ? ` "${m.last.note}"` : '' }),
    { ok: t('위치 보기'), cancel: t('닫기'), danger: true });
  helpShowing = false;
  if (go) location.hash = `#/member/${encodeURIComponent(m.id)}`;
  maybeHelpAlert();
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
      maybeHelpAlert();
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
    noteServerReachable(!snap.metadata.fromCache);
    state.me = me && me.active && state.gates && me.gen === state.gates.gen ? me : null;
    store.setActor(state.me);
    // 오프라인인데 휴대폰에 내 정보(또는 접속 정보)가 저장돼 있지 않으면, 계정 문제가 아니라 인터넷 문제다.
    if (!state.me && snap.metadata.fromCache && (!me || !state.gates)) {
      active = false;
      stopDataSubscriptions();
      listeners = [];
      mount(viewEl, offlineNoDataView());
      renderChrome();
      return;
    }
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
        takeNativeAck();
        // 예전 버전이 저장한 건강 정보와 응급처치 대처법을 지운다 (Play 건강 앱 규정). 실패해도 앱은 그대로 쓴다.
        if (state.online) store.scrubRetiredData(uid, state.isAdmin).catch((err) => console.warn('scrub', err));
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
  }, { metadata: true }); // 서버에 닿는지(fromCache)가 바뀔 때도 알아야 오프라인 띠를 맞게 보인다
}

function startDataSubscriptions() {
  const uid = state.me.id;
  subsKey = state.me.role;
  if (state.isAdmin) {
    unsubs.push(store.watchMembers((list) => {
      state.members = sortMembers(list.filter((m) => m.gen === state.gates?.gen));
      state.legacyMembers = list.filter((m) => m.gen !== state.gates?.gen);
      notify();
      maybeHelpAlert();
    }, onSubError));
  } else {
    syncLinkSubscriptions();
  }
  unsubs.push(store.watchEmergency((e) => {
    state.emergency = e;
    notify();
    maybeAlarm(state);
  }, onSubError));
  unsubs.push(store.watchLatestAlarmTest((test) => {
    maybeTestAlarm(state, test);
  }, onSubError));
  unsubs.push(store.watchMeetingPoints((list) => {
    state.meetingPoints = list.sort((a, b) => a.rank - b.rank);
    notify();
    // 집합장소 주변 지도를 미리 받아 둔다 (하루 한 번, 또는 집합장소가 바뀌었을 때).
    maybeAutoPrepare(state);
  }, onSubError));
  unsubs.push(store.watchProtocols((list) => {
    state.serverProtocols = list;
    notify();
  }, onSubError));
  unsubs.push(store.watchSupplies((list) => {
    state.supplies = list;
    notify();
  }, onSubError));
  unsubs.push(store.watchDisasterRecent((d) => {
    state.disasterRecent = d;
    notify();
  }, () => {}));
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

// 로그인 전: 처음 설정이 안 됐으면 설정 화면, 됐으면 접속 코드 화면
async function showSignedOut() {
  mount(viewEl, loadingView());
  try {
    state.gates = await store.getGates();
  } catch (err) {
    console.warn('접속 정보를 불러오지 못했습니다', err);
  }
  if (state.user) return; // 그 사이에 로그인됨
  mount(viewEl, state.gates ? loginView() : (state.online ? setupView() : offlineFirstView()));
}

function offlineFirstView() {
  return h('div', { class: 'auth-wrap' }, h('div', { class: 'auth-card' },
    h('h1', null, t('인터넷 연결이 필요합니다')),
    h('p', null, t('처음 들어올 때는 인터넷이 필요합니다. 한 번 들어온 뒤에는 인터넷 없이도 열립니다.'))));
}

/** 로그인은 돼 있지만 이 휴대폰에 저장된 내 정보가 없고 서버에도 닿지 않을 때 */
function offlineNoDataView() {
  return h('div', { class: 'auth-wrap' }, h('div', { class: 'auth-card' },
    h('h1', null, t('서버에 연결되지 않습니다')),
    h('p', null, t('이 휴대폰에는 아직 가족 정보가 저장되지 않았습니다. 인터넷이 연결되면 자동으로 이어집니다. 그동안은 전화·문자로 연락하세요.'))));
}

/** 관문 계정(접속 코드)으로 로그인한 상태면 어느 코드인지 */
function gateKind(user) {
  const g = state.gates;
  if (!g || !user) return null;
  return ['family', 'admin', 'backup'].find((k) => g[`${k}Uid`] === user.uid) || null;
}

// 안드로이드 앱: 알림 토큰이 새로 나오거나, 앱의 전체 화면 경보에서 확인을 누르고 들어온 경우
function takeNativeAck() {
  const ack = window.FamilyApp?.takePendingAck?.();
  if (ack) applyNativeAck(state, ack);
}
window.familyNativeToken = () => { if (state.me) refreshPushToken(state.me.id); };
window.familyNativeAckPending = () => { if (state.me) takeNativeAck(); };

function start() {
  document.documentElement.dataset.fontScale = savedFontScale();
  document.documentElement.lang = lang;
  document.title = t(config.appName || '우리 가족 비상연락');
  // index.html 에 직접 적힌 문구도 언어에 맞춘다.
  const skip = document.querySelector('.skip-link');
  if (skip) skip.textContent = t('본문 바로가기');
  topNavEl.setAttribute('aria-label', t('주 메뉴'));
  navEl.setAttribute('aria-label', t('하단 메뉴'));
  // 홈 화면에 앱을 설치하는 순간 오프라인 준비를 한다 (지도 미리 받기, 저장 공간 고정).
  window.addEventListener('appinstalled', () => {
    if (state.me) prepareOffline(state).catch(() => {});
  });
  if ('serviceWorker' in navigator) {
    // 새 버전이 설치되면 한 번 새로고침해서 화면·CSS·JS를 모두 같은 버전으로 맞춘다.
    // (처음 설치할 때는 기존 서비스 워커가 없으므로 새로고침하지 않는다.)
    const hadController = Boolean(navigator.serviceWorker.controller);
    let reloaded = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!hadController || reloaded || document.getElementById('alarm')) return;
      reloaded = true;
      location.reload();
    });
    navigator.serviceWorker.register('./sw.js').catch((err) => console.warn('서비스 워커 등록 실패', err));
  }
  if (standbyWanted()) {
    const resume = () => startStandby().then((ok) => { if (ok) document.removeEventListener('pointerdown', resume, true); });
    document.addEventListener('pointerdown', resume, true);
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
  });

  watchAuth(async (user) => {
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
    // 세대(gen)를 알아야 내 계정이 지금 유효한지 판단한다. 오프라인이면 휴대폰에 저장된 값을 쓴다.
    let gatesChecked = false;
    try {
      await store.setupSettled();
      state.gates = await store.getGates() || state.gates;
      gatesChecked = true;
    } catch (err) {
      console.warn('접속 정보를 불러오지 못했습니다', err);
    }
    if (state.user !== user) return;
    // 아직 처음 설정 전인데 예전 방식 계정으로 로그인돼 있으면, 로그아웃해서 처음 설정 화면을 보여준다.
    if (gatesChecked && !state.gates) {
      await logout();
      return;
    }
    const kind = gateKind(user);
    if (kind === 'backup') mount(viewEl, backupView());
    else if (kind) mount(viewEl, pickerView({ kind }));
    else startSubscriptions(user.uid);
  });
}

// 화면이 다시 보일 때 남은 시간 즉시 갱신
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && state.me) notify();
});

window.addEventListener('error', (e) => {
  if (String(e.message).includes('ResizeObserver')) return;
  toast(t('문제가 생겼습니다. 화면을 새로고침해 주세요.'), 'error');
});

start();
