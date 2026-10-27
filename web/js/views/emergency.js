// 비상선언·해제 화면, 상단 비상 배너, 비상 경보 화면
import { h, field, select, formData, toast, busy, panel, pageHeader, empty, alertBox, table } from '../dom.js';
import { errorMessage } from '../firebase.js';
import { declareEmergency, endEmergency, watchEmergencyLog } from '../store.js';
import {
  EMERGENCY_TYPES, emergencyLabel, formatDateTime, formatRemaining, toDate,
} from '../logic.js';
import { startSiren, stopSiren } from '../siren.js';

// ---------- 경보 화면 ----------

// 사람마다 따로 저장한다 (한 휴대폰을 가족이 같이 쓸 수도 있다).
const ackStorageKey = (uid) => `family.ackedEmergency.${uid}`;

function ackedKey(uid) {
  try { return localStorage.getItem(ackStorageKey(uid)); } catch { return null; }
}

function setAcked(uid, key) {
  try { localStorage.setItem(ackStorageKey(uid), key); } catch { /* 무시 */ }
}

/** 새 비상선언을 처음 보면 전체 화면 경보를 띄우고 경보음을 울린다. 확인하면 다시 울리지 않는다. */
export function maybeAlarm(state) {
  const e = state.emergency;
  const declaredAt = toDate(e?.declaredAt);
  const existing = document.getElementById('alarm');
  if (!e?.active || !declaredAt) {
    if (existing) existing.remove();
    stopSiren();
    return;
  }
  const uid = state.me?.id;
  const key = String(declaredAt.getTime());
  if (!uid || ackedKey(uid) === key || existing) return;
  // 선언한 본인에게는 울리지 않는다.
  if (e.declaredBy === uid) {
    setAcked(uid, key);
    return;
  }

  const playing = startSiren();
  const overlay = h('div', { id: 'alarm', class: 'alarm', role: 'alertdialog', 'aria-modal': 'true', 'aria-labelledby': 'alarm-title' },
    h('div', { class: 'alarm-box' },
      h('div', { class: 'alarm-label' }, 'EMERGENCY ALERT · 비상 경보'),
      h('div', { class: 'alarm-icon', 'aria-hidden': 'true' }, '🚨'),
      h('h2', { id: 'alarm-title' }, `비상 선언: ${emergencyLabel(e.type)}`),
      h('p', null, `${e.declaredByName || '가족'} · ${formatDateTime(declaredAt)}`),
      e.message ? h('p', { class: 'alarm-message' }, e.message) : null,
      playing ? null : h('button', { class: 'btn btn-lg btn-outline', style: { color: '#fff', boxShadow: 'inset 0 0 0 2px #fff' }, onClick: () => startSiren() }, '🔊 경보음 켜기'),
      h('button', {
        class: 'btn btn-safe btn-lg btn-block',
        onClick: () => {
          setAcked(uid, key);
          stopSiren();
          overlay.remove();
          location.hash = '/';
        },
      }, '확인 — 생존신고 하러 가기')));
  document.body.append(overlay);
}

// ---------- 비상선언·해제 화면 ----------

export function emergencyView({ state, onChange, navigate }) {
  // 입력 중인 메시지가 지워지지 않도록 비상 여부가 바뀔 때만 다시 그린다.
  const main = h('div');
  let shownActive;
  const drawMain = () => {
    const active = Boolean(state.emergency?.active);
    if (active === shownActive) return;
    shownActive = active;
    main.replaceChildren(active ? activeCard(state) : declareCard(state, navigate));
  };
  onChange(drawMain);
  drawMain();

  const logBox = h('div');
  let logs = [];
  const drawLogs = () => {
    logBox.replaceChildren(logs.length
      ? table(['일시', '구분', '누가', '메시지'], logs.map((l) => [
        h('span', { class: 'num' }, formatDateTime(l.at)),
        l.action === 'declare'
          ? h('span', { class: 'tag kind-emergency' }, `선언 · ${emergencyLabel(l.type)}`)
          : h('span', { class: 'tag status-safe' }, '해제'),
        l.byName,
        l.message || '-',
      ]))
      : empty('기록이 없습니다.'));
  };
  drawLogs();
  const unsub = watchEmergencyLog((list) => { logs = list; drawLogs(); }, () => {});
  window.addEventListener('hashchange', unsub, { once: true });

  return h('div', { class: 'page' },
    pageHeader('비상선언', { lead: '비상을 선언하면 가족 모두에게 알림과 경보가 가고, 집합장소 시간이 그때부터 계산됩니다.' }),
    main,
    panel('선언·해제 기록', state.isAdmin ? { href: '#/admin/logs', label: '전체 기록' } : null, logBox));
}

function activeCard(state) {
  const e = state.emergency;
  const since = toDate(e.declaredAt);
  return h('div', { class: 'stack' },
    alertBox('emergency', `비상 중: ${emergencyLabel(e.type)}`,
      h('p', null, `${e.declaredByName} · ${formatDateTime(e.declaredAt)} 선언${since ? ` (${formatRemaining(Date.now() - since.getTime())} 지남)` : ''}`),
      e.message ? h('p', null, e.message) : null),
    state.isAdmin
      ? panel('비상 해제', null,
        h('p', null, '상황이 끝났으면 해제하세요. 가족 모두에게 해제 알림이 가고, 집합장소 시간이 평상시 표시로 돌아갑니다.'),
        h('button', {
          class: 'btn btn-lg',
          onClick: (ev) => {
            if (!confirm('비상을 해제할까요? 가족 모두에게 해제 알림이 갑니다.')) return;
            busy(ev.currentTarget, async () => {
              try {
                const r = await endEmergency(state.me);
                toast(r?.error ? `해제됐습니다. 알림 발송 실패: ${r.error}` : '비상을 해제했습니다.');
              } catch (err) {
                toast(errorMessage(err), 'error');
              }
            });
          },
        }, '✅ 비상 해제'))
      : alertBox('info', null, h('p', null, '비상 해제는 관리자만 할 수 있습니다.')));
}

function declareCard(state, navigate) {
  const me = state.me;
  const canDeclare = state.isAdmin || me.declareCredits >= 1;
  const form = h('form', { class: 'stack' },
    field('상황', select('type', EMERGENCY_TYPES.map((t) => ({ value: t.id, label: t.label })), 'war')),
    field('가족에게 보낼 메시지', h('textarea', { name: 'message', rows: 3, maxlength: 500, placeholder: '예: 지금 바로 1순위 집합장소로 이동하세요.' }),
      '알림과 경보 화면에 그대로 표시됩니다.'),
    h('button', { class: 'btn btn-secondary btn-lg btn-block', type: 'submit', disabled: !canDeclare }, '🚨 비상 선언'));

  form.addEventListener('submit', (ev) => {
    ev.preventDefault();
    const data = formData(form);
    const warn = state.isAdmin
      ? '비상을 선언할까요? 가족 모두에게 알림이 갑니다.'
      : '비상을 선언할까요? 가족 모두에게 알림이 가고, 내 선언권 1회를 씁니다.';
    if (!confirm(warn)) return;
    busy(form.querySelector('button[type=submit]'), async () => {
      try {
        const r = await declareEmergency(me, data);
        if (r?.error) toast(`선언됐습니다. 다만 알림 발송에 실패했습니다: ${r.error}`, 'error');
        else toast(`비상을 선언했습니다. 알림 ${r?.sent ?? 0}건 발송.`);
        navigate('/');
      } catch (err) {
        toast(errorMessage(err), 'error');
      }
    });
  });

  return h('div', { class: 'stack' },
    state.isAdmin
      ? alertBox('warning', '관리자 선언', h('p', null, '관리자는 횟수 제한 없이 선언할 수 있습니다. 훈련이라면 메시지에 "훈련"이라고 적으세요.'))
      : alertBox(me.declareCredits >= 1 ? 'warning' : 'error', me.declareCredits >= 1 ? `내 선언권: ${me.declareCredits}회 남음` : '선언권을 모두 썼습니다',
        h('p', null, me.declareCredits >= 1 ? '정말 비상일 때만 쓰세요. 쓴 선언권은 관리자가 다시 채워 줄 수 있습니다.' : '관리자에게 연락하세요.')),
    panel('비상 선언', null, form));
}
