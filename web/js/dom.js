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

export function pageHeader(title, ...actions) {
  return h('header', { class: 'page-header' }, h('h1', null, title), actions.length ? h('div', { class: 'actions' }, actions) : null);
}

export function empty(text) {
  return h('p', { class: 'empty' }, text);
}

export const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent)
  || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

export const isStandalone = window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone === true;
