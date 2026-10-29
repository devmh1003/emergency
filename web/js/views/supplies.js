// 비상 물품: 가족이 함께 보는 물·식량·약·건전지 목록과 유통기한. 기한이 가까우면 홈에서 알려 준다.
import { h, field, formData, toast, busy, panel, pageHeader, empty, alertBox, ask } from '../dom.js';
import { errorMessage } from '../firebase.js';
import { saveSupply, deleteSupply, seedSupplies } from '../store.js';
import { toDate, expiryState, suppliesStatus, SUPPLY_PRESETS } from '../logic.js';
import { t } from '../i18n.js';

const STATE_TAG = { expired: 'status-help', soon: 'status-unknown', ok: 'status-safe', none: 'tag-light' };

function stateLabel(st, item) {
  if (st === 'expired') return t('기한 지남');
  if (st === 'soon') return t('{days}일 남음', { days: Math.max(0, Math.ceil((toDate(item.expiresAt) - Date.now()) / 86400e3)) });
  if (st === 'ok') return t('괜찮음');
  return t('기한 없음');
}

function dateInputValue(v) {
  const d = toDate(v);
  if (!d) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function formatDate(v) {
  const d = toDate(v);
  return d ? `${d.getFullYear()}.${d.getMonth() + 1}.${d.getDate()}` : '';
}

/** 추가·수정 폼. item 이 있으면 수정. */
function supplyForm(state, item, onDone) {
  const form = h('form', { class: 'stack' },
    h('div', { class: 'field-row' },
      field(t('물품'), h('input', { name: 'name', required: true, maxlength: 60, value: item?.name || '', placeholder: t('예: 생수 2L') })),
      field(t('수량'), h('input', { name: 'qty', maxlength: 40, value: item?.qty || '', placeholder: t('예: 12병') }))),
    h('div', { class: 'field-row' },
      field(t('유통기한'), h('input', { name: 'expires', type: 'date', value: dateInputValue(item?.expiresAt) }), t('없으면 비워 둡니다.')),
      field(t('보관 장소'), h('input', { name: 'where', maxlength: 60, value: item?.where || '', placeholder: t('예: 현관 배낭, 베란다') }))),
    field(t('메모'), h('input', { name: 'note', maxlength: 200, value: item?.note || '' })),
    h('div', { class: 'row' },
      h('button', { class: 'btn btn-sm', type: 'submit' }, item ? t('저장') : t('+ 추가')),
      item ? h('button', { class: 'btn btn-sm btn-outline', type: 'button', onClick: () => onDone() }, t('취소')) : null));
  form.addEventListener('submit', (ev) => {
    ev.preventDefault();
    const d = formData(form);
    if (!d.name.trim()) return;
    const expiresAt = d.expires ? new Date(`${d.expires}T12:00:00`) : null;
    busy(form.querySelector('button[type=submit]'), async () => {
      try {
        await saveSupply(state.me, item?.id || null, { name: d.name.trim(), qty: d.qty.trim(), where: d.where.trim(), note: d.note.trim(), expiresAt });
        form.reset();
        onDone();
      } catch (err) { toast(errorMessage(err), 'error'); }
    });
  });
  return form;
}

function supplyRow(state, item, now) {
  const st = expiryState(item, now);
  const row = h('li', { class: 'list-item' });
  const view = () => h('div', null,
    h('div', { class: 'item-main' },
      h('span', null, h('strong', { class: 'item-title' }, item.name), item.qty ? h('span', { class: 'muted' }, ` · ${item.qty}`) : null),
      h('span', { class: `tag ${STATE_TAG[st]}` }, stateLabel(st, item))),
    h('div', { class: 'small muted' },
      [item.expiresAt ? t('기한 {date}', { date: formatDate(item.expiresAt) }) : null, item.where || null, item.note || null].filter(Boolean).join(' · ')),
    h('div', { class: 'row-actions', style: { marginTop: '0.375rem' } },
      h('button', { class: 'btn btn-sm btn-outline', type: 'button', onClick: () => row.replaceChildren(supplyForm(state, item, () => row.replaceChildren(view()))) }, t('수정')),
      h('button', {
        class: 'btn btn-sm btn-outline-secondary', type: 'button',
        onClick: (e) => busy(e.currentTarget, async () => {
          if (!(await ask(t('"{name}"을(를) 목록에서 지울까요?', { name: item.name })))) return;
          try { await deleteSupply(item.id); } catch (err) { toast(errorMessage(err), 'error'); }
        }),
      }, t('지우기'))));
  row.append(view());
  return row;
}

export function suppliesView({ state, live }) {
  const addBox = h('div');
  const showAdd = () => addBox.replaceChildren(supplyForm(state, null, () => addBox.replaceChildren()));

  return h('div', { class: 'page' },
    pageHeader(t('📦 비상 물품'), { lead: t('가족이 함께 보는 물·식량·약·건전지 목록입니다. 유통기한이 30일 안에 오면 홈 화면에서 알려 줍니다.') },
      h('button', { class: 'btn', type: 'button', onClick: showAdd }, t('+ 물품 추가'))),
    live(() => {
      const s = suppliesStatus(state.supplies);
      if (!s.expired.length && !s.soon.length) return null;
      return alertBox('warning', t('바꿀 때가 된 물품'),
        s.expired.length ? h('p', null, t('기한 지남: {names}', { names: s.expired.map((i) => i.name).join(', ') })) : null,
        s.soon.length ? h('p', null, t('30일 안에 기한: {names}', { names: s.soon.map((i) => i.name).join(', ') })) : null);
    }),
    addBox,
    live(() => {
      const now = Date.now();
      const order = { expired: 0, soon: 1, ok: 2, none: 3 };
      const list = [...state.supplies].sort((a, b) => {
        const d = order[expiryState(a, now)] - order[expiryState(b, now)];
        return d || (toDate(a.expiresAt)?.getTime() || Infinity) - (toDate(b.expiresAt)?.getTime() || Infinity) || a.name.localeCompare(b.name, 'ko');
      });
      if (!list.length) {
        return panel(t('목록'), null,
          empty(t('아직 등록한 물품이 없습니다.')),
          h('p', { class: 'small muted' }, t('기본 목록(물·식량·약·건전지·부탄가스·마스크·보조배터리 등 {n}개)을 불러온 뒤 수량과 기한만 적으면 됩니다.', { n: SUPPLY_PRESETS.length })),
          h('button', {
            class: 'btn btn-outline', type: 'button',
            onClick: (e) => busy(e.currentTarget, async () => {
              try { await seedSupplies(state.me); toast(t('기본 목록을 불러왔습니다. 수량과 유통기한을 적어 주세요.')); } catch (err) { toast(errorMessage(err), 'error'); }
            }),
          }, t('기본 목록 불러오기')));
      }
      return panel(t('목록 ({n}개)', { n: list.length }), null,
        h('ul', { class: 'list' }, list.map((item) => supplyRow(state, item, now))));
    }),
    h('p', { class: 'small muted' }, t('팁: 생수·통조림은 6개월마다, 건전지·부탄가스는 1년마다 확인하세요. 유통기한이 지난 생수도 끓이거나 씻는 물로는 쓸 수 있습니다.')));
}
