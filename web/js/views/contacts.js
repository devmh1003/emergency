// 비상 연락처: 공공 비상 번호(내장), 볼 수 있는 가족, 가족 지정 연락처(관리자가 관리), 유용한 사이트
import { h, field, formData, toast, savedToast, busy, panel, pageHeader, empty, table, ask } from '../dom.js';
import { errorMessage } from '../firebase.js';
import { saveContact, deleteContact } from '../store.js';
import { cleanPhone } from '../logic.js';
import { HOTLINE_GROUPS, USEFUL_LINKS } from '../data/contacts.js';
import { HOTLINE_GROUPS_EN, USEFUL_LINKS_EN } from '../data/contacts.en.js';
import { t, lang } from '../i18n.js';

const HOTLINES = lang === 'en' ? HOTLINE_GROUPS_EN : HOTLINE_GROUPS;
const LINKS = lang === 'en' ? USEFUL_LINKS_EN : USEFUL_LINKS;

function callLink(number) {
  const n = cleanPhone(number);
  return h('a', { class: 'btn btn-sm', href: `tel:${n}`, 'aria-label': t('{number}에 전화', { number }) }, `📞 ${number}`);
}

export function contactsView({ state, live }) {
  let editing = null; // 관리자가 수정 중인 연락처 id ('' = 새로 추가)

  const formBox = h('div');

  function openForm(c) {
    editing = c ? c.id : '';
    const form = h('form', { class: 'stack' },
      h('div', { class: 'field-row' },
        field(t('이름'), h('input', { name: 'name', required: true, maxlength: 40, value: c?.name || '', placeholder: t('예: 단골 병원, 아이 학교') })),
        field(t('전화번호'), h('input', { name: 'phone', type: 'tel', required: true, maxlength: 30, value: c?.phone || '' }))),
      h('div', { class: 'field-row' },
        field(t('분류'), h('input', { name: 'category', maxlength: 20, value: c?.category || '', placeholder: t('병원, 학교, 직장, 친척…') })),
        field(t('순서'), h('input', { name: 'order', type: 'number', min: 0, max: 99, value: String(c?.order ?? state.contacts.length + 1) }))),
      field(t('메모'), h('input', { name: 'note', maxlength: 200, value: c?.note || '', placeholder: t('예: 야간 응급실 있음') })),
      h('div', { class: 'row' },
        h('button', { class: 'btn btn-outline', type: 'button', onClick: () => { editing = null; formBox.replaceChildren(); } }, t('취소')),
        h('button', { class: 'btn', type: 'submit' }, c ? t('저장') : t('추가'))));
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      busy(form.querySelector('button[type=submit]'), async () => {
        try {
          savedToast(await saveContact(c?.id, formData(form)), t('저장했습니다.'));
          editing = null;
          formBox.replaceChildren();
        } catch (err) {
          toast(errorMessage(err), 'error');
        }
      });
    });
    formBox.replaceChildren(h('div', { class: 'fieldset' }, h('h3', { style: { marginTop: 0 } }, c ? t('연락처 수정') : t('연락처 추가')), form));
  }

  return h('div', { class: 'page' },
    pageHeader(t('비상 연락처'), { lead: t('공공 비상 번호와 우리 가족이 정한 연락처입니다. 인터넷이 없어도 이 화면은 열립니다.') }),

    h('div', { class: 'grid grid-3' }, HOTLINES.map((g) => panel(g.title, null,
      h('ul', { class: 'list' }, g.items.map((it) => h('li', { class: 'list-item' },
        h('div', { class: 'item-main' }, h('strong', null, it.name), callLink(it.number)),
        h('div', { class: 'small muted' }, it.note))))))),

    panel(state.isAdmin ? t('가족 연락처') : t('볼 수 있는 가족'), null,
      live(() => {
        const list = state.members.filter((m) => m.active && m.id !== state.me.id);
        if (!list.length) return empty(state.isAdmin ? t('다른 가족이 없습니다.') : t('관리자가 지정한 가족이 없습니다.'));
        return table([t('이름'), t('전화번호'), ''], list.map((m) => [
          h('strong', null, m.name),
          m.phone || '-',
          m.phone ? h('div', { class: 'row-actions', style: { margin: 0 } },
            h('a', { class: 'btn btn-sm', href: `tel:${cleanPhone(m.phone)}` }, t('전화 걸기')),
            h('a', { class: 'btn btn-sm btn-outline', href: `sms:${cleanPhone(m.phone)}` }, t('문자'))) : '',
        ]));
      })),

    panel(t('가족 지정 연락처'), null,
      h('p', { class: 'muted small' }, t('병원, 학교, 직장, 가까운 친척 등 비상시 연락할 곳입니다.') + (state.isAdmin ? ` ${t('관리자만 추가·수정할 수 있습니다.')}` : '')),
      live(() => {
        if (!state.contacts.length) return empty(t('아직 등록된 연락처가 없습니다.'));
        return table([t('이름'), t('분류'), t('전화번호'), t('메모'), ''], state.contacts.map((c) => [
          h('strong', null, c.name),
          c.category ? h('span', { class: 'tag tag-light' }, c.category) : '-',
          c.phone,
          c.note || '-',
          h('div', { class: 'row-actions', style: { margin: 0 } },
            h('a', { class: 'btn btn-sm', href: `tel:${cleanPhone(c.phone)}` }, t('전화 걸기')),
            state.isAdmin ? h('button', { class: 'btn btn-sm btn-outline', onClick: () => openForm(c) }, t('수정')) : null,
            state.isAdmin ? h('button', {
              class: 'btn btn-sm btn-outline-secondary',
              onClick: async () => {
                if (!(await ask(t('"{name}" 연락처를 지울까요?', { name: c.name })))) return;
                try { savedToast(await deleteContact(c.id, c.name), t('지웠습니다.')); } catch (err) { toast(errorMessage(err), 'error'); }
              },
            }, t('삭제')) : null),
        ]));
      }),
      state.isAdmin ? h('div', { style: { marginTop: '1rem' } },
        h('button', { class: 'btn btn-outline', onClick: () => openForm(null) }, t('+ 연락처 추가')),
        formBox) : null),

    panel(t('유용한 사이트'), null,
      h('ul', { class: 'list' }, LINKS.map((l) => h('li', { class: 'list-item' },
        h('a', { href: l.href, target: '_blank', rel: 'noopener', class: 'item-title' }, l.name),
        h('div', { class: 'small muted' }, l.note))))));
}
