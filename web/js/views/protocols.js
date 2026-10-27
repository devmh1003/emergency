// 비상 프로토콜: 상황별 대처법과 체크리스트
import { h, toast, card, pageHeader, empty } from '../dom.js';
import { errorMessage } from '../firebase.js';
import { setChecklistItem } from '../store.js';
import { checklistKey, checklistProgress } from '../logic.js';

function progressOf(state, p) {
  return checklistProgress([p], state.checklist);
}

export function protocolsView({ state, live }) {
  return h('div', { class: 'page' },
    pageHeader('대처법', state.isAdmin ? h('a', { class: 'btn btn-sm', href: '#/admin/protocols' }, '관리') : null),
    live(() => {
      const all = checklistProgress(state.protocols, state.checklist);
      return card(
        h('p', { class: 'small' }, `내 대비 체크리스트: ${all.checked}/${all.total}`),
        h('div', { class: 'progress' }, h('div', { class: 'progress-bar', style: { width: `${all.percent}%` } })));
    }),
    live(() => {
      const current = state.emergency?.active ? state.emergency.type : null;
      const list = [...state.protocols].sort((a, b) => (a.id === current ? -1 : b.id === current ? 1 : 0));
      if (!list.length) return empty('등록된 프로토콜이 없습니다.');
      return h('ul', { class: 'list protocol-list' }, list.map((p) => {
        const pr = progressOf(state, p);
        return h('li', null, h('a', { class: `protocol-item${p.id === current ? ' protocol-current' : ''}`, href: `#/protocols/${encodeURIComponent(p.id)}` },
          h('span', { class: 'protocol-icon', 'aria-hidden': 'true' }, p.icon || '📄'),
          h('span', { class: 'protocol-text' },
            h('strong', null, p.title, p.id === current ? ' — 지금 상황' : ''),
            p.summary ? h('span', { class: 'muted small' }, p.summary) : null),
          pr.total ? h('span', { class: 'chip' }, `${pr.checked}/${pr.total}`) : null));
      }));
    }),
    h('p', { class: 'muted small center' }, '이 내용은 휴대폰에 저장돼 인터넷이 없어도 볼 수 있습니다.'));
}

export function protocolDetailView({ state, params, live }) {
  const find = () => state.protocols.find((p) => p.id === params.id);
  if (!find()) return h('div', { class: 'page' }, pageHeader('대처법'), empty('없는 프로토콜입니다.'));

  return h('div', { class: 'page' },
    live(() => {
      const p = find();
      return p ? pageHeader(`${p.icon || ''} ${p.title}`) : pageHeader('삭제된 프로토콜');
    }),
    live(() => {
      const p = find();
      if (!p) return null;
      return h('div', null,
        p.summary ? card(h('p', { class: 'lead' }, p.summary)) : null,
        (p.steps || []).map((s) => card(
          h('h2', null, s.phase),
          h('ol', { class: 'steps' }, s.items.map((i) => h('li', null, i))))),
        p.checklist?.length ? card(
          h('h2', null, '체크리스트'),
          h('p', { class: 'muted small' }, '체크한 내용은 내 계정에 저장됩니다.'),
          h('ul', { class: 'checklist' }, p.checklist.map((item) => {
            const key = checklistKey(p.id, item.id);
            const box = h('input', {
              type: 'checkbox',
              checked: Boolean(state.checklist[key]),
              onChange: async (e) => {
                try {
                  await setChecklistItem(state.me.id, key, e.target.checked);
                } catch (err) {
                  e.target.checked = !e.target.checked;
                  toast(errorMessage(err), 'error');
                }
              },
            });
            return h('li', null, h('label', { class: 'check' }, box, h('span', null, item.text)));
          }))) : null);
    }));
}
