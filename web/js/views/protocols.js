// 상황별 대처법: 목록, 상세(핵심 요약, 단계별 행동, 체크리스트)
import { h, toast, panel, pageHeader, empty, alertBox } from '../dom.js';
import { errorMessage } from '../firebase.js';
import { setChecklistItem } from '../store.js';
import { checklistKey, checklistProgress, emergencyLabel } from '../logic.js';
import { t } from '../i18n.js';

const PHASE_ICON = {
  '지금 즉시': '⚡', '몇 시간 안에': '⏱', '며칠 동안': '📅', '평소에': '🗓',
  // 영어 기본 대처법(data/protocols.en.js)의 단계 이름
  'Right now': '⚡', 'Within a few hours': '⏱', 'Over the next few days': '📅', 'Ahead of time': '🗓',
};

function progressOf(state, p) {
  return checklistProgress([p], state.checklist);
}

export function protocolsView({ state, live }) {
  return h('div', { class: 'page' },
    pageHeader(t('상황별 대처법'), { lead: t('상황마다 지금 즉시, 몇 시간 안에, 며칠 동안 할 일과 준비물 체크리스트를 정리했습니다. 인터넷이 없어도 볼 수 있습니다.') },
      state.isAdmin ? h('a', { class: 'btn btn-outline', href: '#/admin/protocols' }, t('대처법 관리')) : null),
    live(() => {
      const all = checklistProgress(state.protocols, state.checklist);
      return h('div', { class: 'card' },
        h('div', { class: 'readiness' },
          h('div', { class: 'readiness-score' }, `${all.percent}`, h('small', null, '%')),
          h('div', { style: { flex: 1 } },
            h('strong', null, t('나의 대비 상태')),
            h('div', { class: 'progress' }, h('div', { class: 'progress-bar', style: { width: `${all.percent}%` } })),
            h('div', { class: 'small muted' }, t('전체 체크리스트 {done}/{total}개 완료', { done: all.checked, total: all.total })))));
    }),
    live(() => {
      const current = state.emergency?.active ? state.emergency.type : null;
      const list = [...state.protocols].sort((a, b) => (a.id === current ? -1 : b.id === current ? 1 : 0));
      if (!list.length) return empty(t('등록된 대처법이 없습니다.'));
      return h('div', null,
        current ? alertBox('emergency', t('지금 상황: {label}', { label: emergencyLabel(current) }), h('p', null, t('해당 대처법을 맨 앞에 두었습니다.'))) : null,
        h('div', { class: 'protocol-grid', style: { marginTop: current ? '1rem' : 0 } }, list.map((p) => {
          const pr = progressOf(state, p);
          return h('a', { class: `protocol-card${p.id === current ? ' current' : ''}`, href: `#/protocols/${encodeURIComponent(p.id)}` },
            h('span', { class: 'protocol-icon', 'aria-hidden': 'true' }, p.icon || '📄'),
            h('span', { class: 'protocol-text' },
              h('strong', null, p.title),
              p.summary ? h('span', null, p.summary) : null,
              pr.total ? h('span', null, h('span', { class: `tag ${pr.checked === pr.total ? 'status-safe' : 'tag-light'}` }, t('준비 {done}/{total}', { done: pr.checked, total: pr.total }))) : null));
        })));
    }));
}

export function protocolDetailView({ state, params, live }) {
  const find = () => state.protocols.find((p) => p.id === params.id);
  const crumbs = [{ label: t('상황별 대처법'), href: '#/protocols' }];
  if (!find()) return h('div', { class: 'page' }, pageHeader(t('대처법'), { crumbs }), empty(t('없는 대처법입니다.')));

  return h('div', { class: 'page' },
    live(() => {
      const p = find();
      return p ? pageHeader(`${p.icon || ''} ${p.title}`.trim(), { crumbs, lead: p.summary }) : pageHeader(t('삭제된 대처법'), { crumbs });
    }),
    live(() => {
      const p = find();
      if (!p) return null;
      const pr = progressOf(state, p);
      return h('div', { class: 'stack', style: { gap: '1.25rem' } },
        p.keyPoints?.length ? h('div', { class: 'summary-box' },
          h('h2', null, t('꼭 기억할 것')),
          h('ul', null, p.keyPoints.map((k) => h('li', null, k)))) : null,
        (p.steps || []).length ? panel(t('행동 순서'), null,
          h('ol', { class: 'process-list' }, p.steps.map((s) => h('li', null,
            h('p', { class: 'process-heading' }, `${PHASE_ICON[s.phase] || ''} ${s.phase}`.trim()),
            h('ul', null, s.items.map((i) => h('li', null, i))))))) : null,
        p.checklist?.length ? panel(t('준비 체크리스트 ({done}/{total})', { done: pr.checked, total: pr.total }), null,
          h('div', { class: 'progress' }, h('div', { class: 'progress-bar', style: { width: `${pr.percent}%` } })),
          h('p', { class: 'muted small' }, t('체크한 내용은 내 계정에 저장됩니다. 관리자는 가족별 준비 상태를 볼 수 있습니다.')),
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
          }))) : null,
        alertBox('info', null, h('p', null, t('이 내용은 일반적인 안내입니다. 실제 상황에서는 재난문자, 방송, 현장 공무원·소방·경찰의 지시를 우선 따르세요.'))));
    }));
}
