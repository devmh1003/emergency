// 비상선언·해제 화면, 상단 비상 배너, 비상 경보 화면
import { h, field, select, formData, toast, busy, card, pageHeader, empty } from '../dom.js';
import { errorMessage } from '../firebase.js';
import { declareEmergency, endEmergency, watchEmergencyLog } from '../store.js';
import {
  EMERGENCY_TYPES, emergencyLabel, formatDateTime, formatRemaining, meetingSchedule, toDate,
} from '../logic.js';
import { startSiren, stopSiren } from '../siren.js';

export function emergencyBanner(state) {
  const e = state.emergency;
  if (!e?.active) return null;
  const { currentRank, points } = meetingSchedule(state.meetingPoints, e);
  const target = points.find((p) => p.rank === currentRank);
  return h('a', { class: 'emergency-bar', href: '#/meet' },
    h('strong', null, `🚨 비상: ${emergencyLabel(e.type)}`),
    h('span', null, ` · ${formatDateTime(e.declaredAt)} 선언`),
    target ? h('span', { class: 'emergency-target' }, ` → ${target.rank}순위 ${target.name}`) : null);
}

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
      h('div', { class: 'alarm-icon', 'aria-hidden': 'true' }, '🚨'),
      h('h2', { id: 'alarm-title' }, `비상 선언: ${emergencyLabel(e.type)}`),
      h('p', null, `${e.declaredByName || '가족'} · ${formatDateTime(declaredAt)}`),
      e.message ? h('p', { class: 'alarm-message' }, e.message) : null,
      playing ? null : h('button', { class: 'btn btn-lg', onClick: () => startSiren() }, '🔊 경보음 켜기'),
      h('button', {
        class: 'btn btn-safe btn-xl',
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
      ? h('ul', { class: 'list' }, logs.map((l) => h('li', { class: 'list-item' },
        h('div', null,
          h('strong', null, l.action === 'declare' ? `🚨 선언: ${emergencyLabel(l.type)}` : '✅ 해제'),
          h('div', { class: 'muted small' }, `${l.byName} · ${formatDateTime(l.at)}`),
          l.message ? h('div', { class: 'small' }, l.message) : null))))
      : empty('기록이 없습니다.'));
  };
  drawLogs();
  const unsub = watchEmergencyLog((list) => { logs = list; drawLogs(); }, () => {});
  window.addEventListener('hashchange', unsub, { once: true });

  return h('div', { class: 'page' },
    pageHeader('비상선언'),
    main,
    card(h('h2', null, '선언·해제 기록'), logBox));
}

function activeCard(state) {
  const e = state.emergency;
  return card(
    h('div', { class: 'status-big status-help' }, `🚨 비상 중: ${emergencyLabel(e.type)}`),
    h('p', null, `${e.declaredByName} · ${formatDateTime(e.declaredAt)} 선언`),
    e.message ? h('p', null, e.message) : null,
    toDate(e.declaredAt) ? h('p', { class: 'muted small' }, `선언 후 ${formatRemaining(Date.now() - toDate(e.declaredAt).getTime())} 지남`) : null,
    state.isAdmin
      ? h('button', {
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
      }, '✅ 비상 해제')
      : h('p', { class: 'muted' }, '비상 해제는 관리자만 할 수 있습니다.'));
}

function declareCard(state, navigate) {
  const me = state.me;
  const canDeclare = state.isAdmin || me.declareCredits >= 1;
  const form = h('form', { class: 'stack' },
    field('상황', select('type', EMERGENCY_TYPES.map((t) => ({ value: t.id, label: t.label })), 'war')),
    field('가족에게 보낼 메시지', h('textarea', { name: 'message', rows: 3, maxlength: 500, placeholder: '예: 지금 바로 1순위 집합장소로 이동하세요.' })),
    h('button', { class: 'btn btn-danger btn-xl', type: 'submit', disabled: !canDeclare }, '🚨 비상 선언'));

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

  return card(
    h('p', null, '비상을 선언하면 가족 모두에게 알림이 가고, 집합장소 시간이 지금부터 계산됩니다.'),
    state.isAdmin
      ? h('p', { class: 'muted small' }, '관리자는 횟수 제한 없이 선언할 수 있습니다.')
      : h('p', { class: me.declareCredits >= 1 ? 'small' : 'small text-danger' },
        me.declareCredits >= 1 ? `내 선언권: ${me.declareCredits}회 남음` : '선언권을 모두 썼습니다. 관리자에게 연락하세요.'),
    form);
}
