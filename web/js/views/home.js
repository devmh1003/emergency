// 홈: "나 무사해요" 생존신고, 현재 위치 확인·체크포인트, 문자로 알리기, 가족 상태
import { h, toast, busy, card, isIOS } from '../dom.js';
import { errorMessage } from '../firebase.js';
import { checkIn } from '../store.js';
import { getBestPosition } from '../geo.js';
import { mapView } from '../map.js';
import {
  CHECKIN_LABEL, formatAgo, formatDateTime, hasLocation, locationUrl, memberStatus, safetySmsBody, smsHref,
  emergencyLabel,
} from '../logic.js';
import { familyStatusList, statusSummary } from './family.js';

/** 위치를 읽고 신고를 저장한다. 위치를 못 읽어도 신고는 저장한다. */
async function report(state, type, note, knownPos) {
  let pos = knownPos || null;
  let locError = null;
  if (!pos) {
    try {
      pos = await getBestPosition();
    } catch (err) {
      locError = err.message;
    }
  }
  const result = await checkIn(state.me, type, pos, note, state.emergency);
  const what = CHECKIN_LABEL[type];
  if (result === 'queued') toast(`${what} 저장됨 — 오프라인이라 연결되면 자동으로 전송됩니다.`, 'warn');
  else toast(`${what} 전송 완료${pos ? '' : ' (위치 없이)'}`);
  if (locError) toast(`위치를 못 읽어 위치 없이 저장했습니다: ${locError}`, 'warn');
  return pos;
}

export function homeView({ state, live, navigate }) {
  let lastPos = null;
  const note = h('input', { class: 'note-input', placeholder: '메모 (선택) 예: 회사 지하 대피소에 있음', maxlength: 300 });

  const run = (type, button) => busy(button, async () => {
    const original = button.textContent;
    button.textContent = '위치 확인 중…';
    try {
      lastPos = await report(state, type, note.value.trim(), null);
      note.value = '';
      showPos(lastPos);
    } catch (err) {
      toast(errorMessage(err), 'error');
    } finally {
      button.textContent = original;
    }
  });

  const safeBtn = h('button', { class: 'btn btn-safe btn-hero', onClick: (e) => run('safe', e.currentTarget) }, '나 무사해요');
  const helpBtn = h('button', {
    class: 'btn btn-danger',
    onClick: (e) => {
      if (!note.value.trim() && !confirm('도움 필요로 신고할까요? 메모에 상황을 적으면 가족이 더 빨리 도울 수 있습니다.')) return;
      run('help', e.currentTarget);
    },
  }, '🆘 도움 필요');

  // ---- 현재 위치 ----
  const posInfo = h('p', { class: 'muted small' }, '버튼을 누르면 GPS로 현재 위치를 확인합니다.');
  const map = mapView({ height: 220 });
  map.el.hidden = true;
  const saveCheckpoint = h('button', {
    class: 'btn btn-primary', hidden: true,
    onClick: (e) => busy(e.currentTarget, async () => {
      try {
        await report(state, 'checkpoint', note.value.trim(), lastPos);
        note.value = '';
      } catch (err) {
        toast(errorMessage(err), 'error');
      }
    }),
  }, '📌 이 위치를 체크포인트로 저장');

  function showPos(pos) {
    if (!hasLocation(pos)) return;
    lastPos = pos;
    posInfo.replaceChildren(
      `위도 ${pos.lat.toFixed(5)}, 경도 ${pos.lng.toFixed(5)} · 오차 약 ${pos.accuracy}m · `,
      h('a', { href: locationUrl(pos), target: '_blank', rel: 'noopener' }, '지도 앱에서 보기'));
    map.el.hidden = false;
    map.setPoints([{ ...pos, label: '나', color: 'me', showAccuracy: true }]);
    saveCheckpoint.hidden = false;
  }

  const locateBtn = h('button', {
    class: 'btn',
    onClick: (e) => busy(e.currentTarget, async () => {
      posInfo.textContent = '위치 확인 중…';
      try {
        showPos(await getBestPosition());
      } catch (err) {
        posInfo.textContent = err.message;
      }
    }),
  }, '📍 현재 위치 확인');

  // ---- 문자로 알리기 ----
  const smsBtn = h('button', {
    class: 'btn',
    onClick: (e) => busy(e.currentTarget, async () => {
      let pos = lastPos;
      if (!pos) {
        try { pos = await getBestPosition(); } catch { pos = null; }
      }
      const phones = state.members.filter((m) => m.id !== state.me.id && m.phone).map((m) => m.phone);
      if (!phones.length) {
        toast('전화번호가 등록된 가족이 없습니다.', 'error');
        return;
      }
      location.href = smsHref(phones, safetySmsBody(state.me.name, pos), isIOS);
    }),
  }, '✉️ 문자로 알리기');

  return h('div', { class: 'page' },
    live(() => header(state)),
    card(
      safeBtn,
      note,
      h('div', { class: 'row' }, helpBtn, smsBtn),
      live(() => myLast(state), 'p', { class: 'muted small center' })),
    card(
      h('h2', null, '현재 위치'),
      posInfo,
      map.el,
      h('div', { class: 'row' }, locateBtn, saveCheckpoint)),
    card(
      h('div', { class: 'card-title-row' },
        h('h2', null, '가족 상태'),
        h('a', { href: '#/family', class: 'small' }, '전체 보기')),
      live(() => statusSummary(state)),
      live(() => familyStatusList(state, { compact: true }))),
    live(() => (state.emergency?.active ? null
      : h('p', { class: 'center' }, h('a', { href: '#/emergency', class: 'btn btn-outline-danger' }, '🚨 비상선언하기')))));
}

function header(state) {
  const e = state.emergency;
  const status = memberStatus(state.me, e);
  return h('div', { class: 'home-header' },
    h('h1', null, `${state.me.name}님`),
    e?.active
      ? h('p', { class: `status-pill status-${status.key}` },
        status.key === 'unknown' ? `🚨 ${emergencyLabel(e.type)} — 아직 생존신고를 안 했습니다` : `내 상태: ${status.label}`)
      : h('p', { class: 'muted' }, '평상시입니다. 비상 시 아래 버튼으로 생존신고를 하세요.'));
}

function myLast(state) {
  const last = state.me.last;
  if (!last) return '아직 신고 기록이 없습니다.';
  return `마지막 신고: ${CHECKIN_LABEL[last.type] || last.type} · ${formatAgo(last.clientAt || last.at)} (${formatDateTime(last.clientAt || last.at)})`;
}
