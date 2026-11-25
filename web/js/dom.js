// 화면을 만드는 작은 도구들.
// 사용자 입력은 항상 텍스트 노드로 넣는다. innerHTML 은 쓰지 않는다 (스크립트 삽입 공격 방지).
import { t } from './i18n.js';

/**
 * h('button', { class: 'btn', onClick: fn }, '텍스트', 자식요소...)
 */
export function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  let value;
  for (const [key, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (key === 'class') el.className = v;
    else if (key === 'value') value = v;
    else if (key.startsWith('on') && typeof v === 'function') el.addEventListener(key.slice(2).toLowerCase(), v);
    else if (key === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (key === 'checked' || key === 'selected' || key === 'disabled') el[key] = Boolean(v);
    else if (key === 'href' && !isSafeHref(v)) continue;
    else el.setAttribute(key, v === true ? '' : String(v));
  }
  append(el, children);
  if (value !== undefined) el.value = value;
  return el;
}

function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

const SAFE_SCHEMES = ['https:', 'http:', 'tel:', 'sms:', 'mailto:'];

function isSafeHref(href) {
  const s = String(href).trim();
  if (s.startsWith('#') || s.startsWith('./')) return true;
  return SAFE_SCHEMES.some((scheme) => s.toLowerCase().startsWith(scheme));
}

export function clear(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
  return el;
}

export function mount(el, ...children) {
  clear(el);
  append(el, children);
  return el;
}

let toastTimer;
export function toast(message, kind = 'info') {
  let box = document.getElementById('toast');
  if (!box) {
    box = h('div', { id: 'toast', role: 'status', 'aria-live': 'polite' });
    document.body.append(box);
  }
  box.className = `toast show ${kind}`;
  box.textContent = message;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => box.classList.remove('show'), kind === 'error' ? 6000 : 3500);
}

/**
 * 저장 결과 안내. store.js 의 쓰기 함수는 오프라인이면 'queued'(휴대폰에 보관, 연결되면 자동 전송)를 돌려준다.
 * 그때는 성공 문구 대신 보관됐다는 노란 안내를 보여 준다.
 */
export function savedToast(result, message, kind = 'info') {
  if (result === 'queued') toast(t('저장됨 — 오프라인이라 연결되면 자동으로 전송됩니다.'), 'warn');
  else toast(message, kind);
}

/**
 * 화면 정중앙에 확인 창을 띄운다 (휴대폰 위쪽에 뜨는 브라우저 기본 confirm 창 대신).
 * 확인하면 true, 취소·바깥 누름·Esc 면 false.
 */
export function ask(message, { ok = t('예'), cancel = t('아니요'), danger = false } = {}) {
  return new Promise((resolve) => {
    const before = document.activeElement;
    const done = (answer) => {
      dialog.remove();
      document.removeEventListener('keydown', onKey);
      before?.focus?.();
      resolve(answer);
    };
    const onKey = (e) => { if (e.key === 'Escape') done(false); };
    const okButton = h('button', { type: 'button', class: `btn btn-lg ${danger ? 'btn-secondary' : ''}`, onClick: () => done(true) }, ok);
    const dialog = h('div', {
      class: 'modal', role: 'alertdialog', 'aria-modal': 'true', 'aria-labelledby': 'modal-message',
      onClick: (e) => { if (e.target === dialog) done(false); },
    },
    h('div', { class: 'modal-box' },
      h('p', { id: 'modal-message', class: 'modal-message' }, message),
      h('div', { class: 'modal-actions' },
        h('button', { type: 'button', class: 'btn btn-outline btn-lg', onClick: () => done(false) }, cancel),
        okButton)));
    document.body.append(dialog);
    document.addEventListener('keydown', onKey);
    okButton.focus();
  });
}

/**
 * 화면 정중앙에 고르는 창을 띄운다. options: [{ value, label, cls }]. 고른 value, 취소·바깥 누름·Esc 면 null.
 */
export function choose(message, options) {
  return new Promise((resolve) => {
    const before = document.activeElement;
    const done = (answer) => {
      dialog.remove();
      document.removeEventListener('keydown', onKey);
      before?.focus?.();
      resolve(answer);
    };
    const onKey = (e) => { if (e.key === 'Escape') done(null); };
    const dialog = h('div', {
      class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'modal-message',
      onClick: (e) => { if (e.target === dialog) done(null); },
    },
    h('div', { class: 'modal-box' },
      h('p', { id: 'modal-message', class: 'modal-message' }, message),
      h('div', { class: 'choose-grid' }, options.map((o) => h('button', {
        type: 'button', class: `btn btn-lg ${o.cls || ''}`, onClick: () => done(o.value),
      }, o.label))),
      h('button', { type: 'button', class: 'btn btn-unstyled', onClick: () => done(null) }, t('취소'))));
    document.body.append(dialog);
    document.addEventListener('keydown', onKey);
    dialog.querySelector('button').focus();
  });
}

/** 폼 입력 한 줄 (라벨 + 입력) */
export function field(label, input, hint) {
  return h('label', { class: 'field' },
    h('span', { class: 'field-label' }, label),
    input,
    hint ? h('span', { class: 'field-hint' }, hint) : null);
}

export function select(name, options, value) {
  return h('select', { name, value },
    options.map((o) => (typeof o === 'string'
      ? h('option', { value: o }, o)
      : h('option', { value: o.value }, o.label))));
}

/** 폼 값을 객체로 */
export function formData(form) {
  const out = {};
  for (const el of form.elements) {
    if (!el.name) continue;
    if (el.type === 'radio') {
      if (el.checked) out[el.name] = el.value;
      continue;
    }
    out[el.name] = el.type === 'checkbox' ? el.checked : el.value.trim();
  }
  return out;
}

/** 버튼을 누르는 동안 비활성화하고 오류를 토스트로 보여준다. */
export async function busy(button, fn) {
  if (button) button.disabled = true;
  try {
    return await fn();
  } finally {
    if (button) button.disabled = false;
  }
}

export function card(...children) {
  return h('section', { class: 'card' }, ...children);
}

/** 제목 띠가 있는 카드. link: { href, label } */
export function panel(title, link, ...children) {
  return h('section', { class: 'card' },
    h('div', { class: 'card-header' }, h('h2', null, title), link ? h('a', { href: link.href }, link.label) : null),
    ...children);
}

// 접은 구역을 열어 둔 상태 (화면이 다시 그려져도 유지, 앱을 닫으면 처음 상태로)
const foldState = new Map();

/**
 * 접었다 펴는 카드. key 로 열림 상태를 기억한다.
 * opts: { key, open: 처음부터 펼침, hint: 제목 아래 짧은 설명, id }
 */
export function foldPanel(title, { key = title, open = false, hint = null, id = null } = {}, ...children) {
  const el = h('details', { class: 'card fold', id },
    h('summary', { class: 'fold-summary' },
      h('span', { class: 'fold-title' }, h('strong', null, title), hint ? h('span', { class: 'fold-hint' }, hint) : null)),
    h('div', { class: 'fold-body' }, ...children));
  el.open = foldState.get(key) ?? open;
  el.addEventListener('toggle', () => foldState.set(key, el.open));
  return el;
}

/** 아이콘·제목·설명이 있는 메뉴 줄 목록. items: [href, icon, title, desc] */
export function menuList(items) {
  return h('nav', { class: 'menu-list' }, items.filter(Boolean).map(([href, icon, title, desc]) => h('a', { class: 'menu-row', href },
    h('span', { class: 'menu-icon', 'aria-hidden': 'true' }, icon),
    h('span', { class: 'menu-text' }, h('strong', null, title), desc ? h('span', null, desc) : null),
    h('span', { class: 'menu-arrow', 'aria-hidden': 'true' }, '›'))));
}

/**
 * 페이지 제목. 두 번째 인자로 { lead, crumbs: [{label, href}] } 를 줄 수 있고, 나머지는 오른쪽 버튼들.
 * 위에 "홈 › … › 제목" 경로 표시가 붙는다.
 */
export function pageHeader(title, ...rest) {
  let opts = {};
  if (rest[0] && !(rest[0] instanceof Node) && typeof rest[0] === 'object') opts = rest.shift();
  const actions = rest.filter(Boolean);
  const crumbs = [{ label: t('홈'), href: '#/' }, ...(opts.crumbs || [])];
  const back = crumbs[crumbs.length - 1];
  return h('div', null,
    // 휴대폰에서는 경로 대신 한 단계 위로 가는 큰 버튼 하나만 보인다 (app.css)
    h('a', { class: 'back-link', href: back.href }, h('span', { 'aria-hidden': 'true' }, '‹'), back.label),
    h('nav', { class: 'breadcrumb', 'aria-label': t('현재 위치') },
      crumbs.map((c) => [h('a', { href: c.href }, c.label), h('span', { 'aria-hidden': 'true' }, '›')]),
      h('span', { 'aria-current': 'page' }, typeof title === 'string' ? title : '')),
    h('header', { class: 'page-header' },
      h('div', null, h('h1', null, title), opts.lead ? h('p', { class: 'lead' }, opts.lead) : null),
      actions.length ? h('div', { class: 'actions' }, actions) : null));
}

/** USWDS 알림 상자. kind: info | success | warning | error | emergency */
export function alertBox(kind, heading, ...children) {
  return h('div', { class: `alert alert-${kind}`, role: kind === 'error' || kind === 'emergency' ? 'alert' : 'status' },
    heading ? h('h2', { class: 'alert-heading' }, heading) : null,
    ...children);
}

/**
 * 표. 좁은 화면에서는 카드처럼 쌓인다.
 * @param {string[]} headers
 * @param {Array<Array<Node|string>>} rows
 */
export function table(headers, rows, caption) {
  return h('div', { class: 'table-wrap' },
    h('table', { class: 'table table-stack' },
      caption ? h('caption', null, caption) : null,
      h('thead', null, h('tr', null, headers.map((t) => h('th', { scope: 'col' }, t)))),
      h('tbody', null, rows.map((r) => h('tr', null, r.map((cell, i) => h('td', { 'data-label': headers[i] }, cell)))))));
}

/** 파일 내려받기 (CSV 등). 사용자가 버튼을 눌렀을 때만 호출한다. */
export function downloadText(filename, text, type = 'text/csv;charset=utf-8') {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: filename });
  a.href = url;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function empty(text) {
  return h('p', { class: 'empty' }, text);
}

export const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent)
  || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

/** 우리 안드로이드 앱(android/) 안에서 열렸으면 앱 기능(window.FamilyApp)을 쓸 수 있다. */
export const nativeApp = typeof window !== 'undefined' && window.FamilyApp ? window.FamilyApp : null;
export const isAndroid = /Android/i.test(navigator.userAgent);
export const ANDROID_APP_URL = 'https://github.com/devmh1003/emergency/releases/latest/download/family-emergency.apk';
export const isStandalone = window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone === true;

// ---------- 글자 크기 (이 휴대폰에만 저장) ----------

const FONT_KEY = 'family.fontScale';
export const FONT_SCALES = [['md', '보통'], ['lg', '크게'], ['xl', '아주 크게']];

export function savedFontScale() {
  try { return localStorage.getItem(FONT_KEY) || 'md'; } catch { return 'md'; }
}

export function applyFontScale(scale) {
  document.documentElement.dataset.fontScale = scale;
  try { localStorage.setItem(FONT_KEY, scale); } catch { /* 무시 */ }
}
