// 화면을 만드는 작은 도구들.
// 사용자 입력은 항상 텍스트 노드로 넣는다. innerHTML 은 쓰지 않는다 (스크립트 삽입 공격 방지).

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

/**
 * 페이지 제목. 두 번째 인자로 { lead, crumbs: [{label, href}] } 를 줄 수 있고, 나머지는 오른쪽 버튼들.
 * 위에 "홈 › … › 제목" 경로 표시가 붙는다.
 */
export function pageHeader(title, ...rest) {
  let opts = {};
  if (rest[0] && !(rest[0] instanceof Node) && typeof rest[0] === 'object') opts = rest.shift();
  const actions = rest.filter(Boolean);
  const crumbs = [{ label: '홈', href: '#/' }, ...(opts.crumbs || [])];
  return h('div', null,
    h('nav', { class: 'breadcrumb', 'aria-label': '현재 위치' },
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

export const isStandalone = window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone === true;
