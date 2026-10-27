// 집합장소: 지금 갈 곳, 1~10순위 일정, 지도, 집합장소 기록
import { h, toast, busy, card, pageHeader, empty, field, select } from '../dom.js';
import { errorMessage } from '../firebase.js';
import { addMeetingLog, watchMeetingLogs, deleteMeetingLog } from '../store.js';
import { getBestPosition } from '../geo.js';
import { mapView } from '../map.js';
import {
  meetingSchedule, formatOffset, formatDateTime, formatRemaining, directionLinks, hasLocation, locationUrl,
} from '../logic.js';

const STATE_LABEL = { past: '지남', current: '지금', upcoming: '다음', unscheduled: '' };

function timeText(p) {
  if (p.state === 'unscheduled') return `${formatOffset(p.offsetHours)} · ${p.waitMinutes}분 대기`;
  return `${formatDateTime(p.at)} 도착 · ${formatDateTime(p.deadline)}까지 대기`;
}

function directions(p) {
  const links = directionLinks(p, p.name);
  return links.length
    ? h('div', { class: 'row-actions' }, links.map((l) => h('a', { class: 'btn btn-sm', href: l.href, target: '_blank', rel: 'noopener' }, `🧭 ${l.label}`)))
    : null;
}

function targetCard(state) {
  if (!state.emergency?.active) return null;
  const { currentRank, points } = meetingSchedule(state.meetingPoints, state.emergency);
  const p = points.find((x) => x.rank === currentRank);
  if (!p) {
    return card(h('div', { class: 'status-big status-help' }, '모든 집합 시간이 지났습니다'),
      h('p', null, '마지막 집합장소에서 기다리거나, 관리자 안내와 생존신고 기록을 확인하세요.'));
  }
  const now = Date.now();
  const arriving = p.at.getTime() > now;
  const until = arriving ? p.at.getTime() : p.deadline.getTime();
  return card(
    h('p', { class: 'eyebrow' }, '지금 갈 곳'),
    h('div', { class: 'target-name' }, `${p.rank}순위 · ${p.name}`),
    p.address ? h('p', null, p.address) : null,
    h('p', { class: 'target-time' },
      arriving ? '도착 시각까지 ' : '대기 종료까지 ',
      h('strong', { 'data-until': String(until) }, formatRemaining(until - now))),
    h('p', { class: 'muted small' }, timeText(p)),
    p.note ? h('p', { class: 'note' }, p.note) : null,
    directions(p));
}

function scheduleList(state) {
  const { points } = meetingSchedule(state.meetingPoints, state.emergency);
  if (!points.length) {
    return empty(state.isAdmin ? '아직 집합장소가 없습니다. "집합장소 설정"에서 1순위부터 정하세요.' : '관리자가 아직 집합장소를 정하지 않았습니다.');
  }
  return h('ol', { class: 'list meet-list' }, points.map((p) => h('li', { class: `list-item meet-${p.state}` },
    h('div', { class: 'member-main' },
      h('strong', null, `${p.rank}. ${p.name}`),
      STATE_LABEL[p.state] ? h('span', { class: `chip chip-${p.state}` }, STATE_LABEL[p.state]) : null),
    p.address ? h('div', { class: 'small' }, p.address) : null,
    h('div', { class: 'muted small' }, timeText(p)),
    p.note ? h('div', { class: 'small' }, p.note) : null,
    directions(p))));
}

function pointMarkers(state) {
  const { currentRank, points } = meetingSchedule(state.meetingPoints, state.emergency);
  return points.filter(hasLocation).map((p) => ({
    lat: p.lat,
    lng: p.lng,
    label: String(p.rank),
    color: p.rank === currentRank ? 'help' : p.state === 'past' ? 'past' : 'meet',
    popup: `${p.rank}순위 ${p.name}`,
  }));
}

export function meetView({ state, live, onChange }) {
  const map = mapView({ points: pointMarkers(state), height: 260 });
  let sig = '';
  onChange(() => {
    const pts = pointMarkers(state);
    const next = JSON.stringify(pts);
    if (next !== sig) { sig = next; map.setPoints(pts); }
  });

  return h('div', { class: 'page' },
    pageHeader('집합장소', state.isAdmin ? h('a', { class: 'btn btn-sm', href: '#/admin/meet' }, '설정') : null),
    live(() => targetCard(state)),
    card(h('h2', null, '1~10순위'),
      live(() => (state.emergency?.active ? null
        : h('p', { class: 'muted small' }, '평상시에는 "비상 발생 후 몇 시간"으로 보입니다. 비상이 선언되면 실제 날짜와 시간으로 바뀝니다.'))),
      live(() => scheduleList(state))),
    card(h('h2', null, '지도'), map.el),
    logSection(state));
}

// ---------- 집합장소 기록 ----------

function logSection(state) {
  const { currentRank } = meetingSchedule(state.meetingPoints, state.emergency);
  const ranks = state.meetingPoints.map((p) => ({ value: String(p.rank), label: `${p.rank}순위 ${p.name}` }));
  const message = h('textarea', { rows: 2, maxlength: 300, placeholder: '예: 14시 도착. 15시까지 기다리다 2순위로 이동합니다.' });
  const rankSel = select('rank', ranks.length ? ranks : [{ value: '1', label: '1순위' }], String(currentRank || ranks[0]?.value || '1'));
  const withLoc = h('input', { type: 'checkbox', checked: true });

  const submit = h('button', {
    class: 'btn btn-primary',
    onClick: (e) => busy(e.currentTarget, async () => {
      const text = message.value.trim();
      if (!text) { toast('내용을 적어 주세요.', 'error'); return; }
      let pos = null;
      if (withLoc.checked) {
        try { pos = await getBestPosition(); } catch (err) { toast(`위치 없이 저장합니다: ${err.message}`, 'warn'); }
      }
      try {
        const r = await addMeetingLog(state.me, rankSel.value, text, pos);
        message.value = '';
        toast(r === 'queued' ? '저장됨 — 연결되면 자동 전송됩니다.' : '기록을 남겼습니다.', r === 'queued' ? 'warn' : 'info');
      } catch (err) {
        toast(errorMessage(err), 'error');
      }
    }),
  }, '기록 남기기');

  const list = h('div', null, h('p', { class: 'muted' }, '불러오는 중…'));
  const unsub = watchMeetingLogs((logs) => {
    list.replaceChildren(logs.length ? h('ul', { class: 'list' }, logs.map((l) => h('li', { class: 'list-item' },
      h('div', { class: 'member-main' },
        h('strong', null, `[${l.rank}순위] ${l.name}`),
        h('span', { class: 'muted small' }, formatDateTime(l.clientAt))),
      h('div', null, l.message),
      h('div', { class: 'row-actions' },
        hasLocation(l) ? h('a', { class: 'btn btn-sm', href: locationUrl(l), target: '_blank', rel: 'noopener' }, '🗺️ 위치') : null,
        state.isAdmin || l.uid === state.me.id ? h('button', {
          class: 'btn btn-sm btn-ghost',
          onClick: async () => {
            if (!confirm('이 기록을 지울까요?')) return;
            try { await deleteMeetingLog(l.id); } catch (err) { toast(errorMessage(err), 'error'); }
          },
        }, '삭제') : null))))
      : empty('아직 남긴 기록이 없습니다.'));
  }, (err) => list.replaceChildren(h('p', { class: 'text-danger' }, errorMessage(err))));
  window.addEventListener('hashchange', unsub, { once: true });

  return card(
    h('h2', null, '집합장소 기록'),
    h('p', { class: 'muted small' }, '도착했거나 다른 곳으로 이동할 때 남기세요. 가족 모두가 봅니다.'),
    field('장소', rankSel),
    field('내용', message),
    h('label', { class: 'check' }, withLoc, ' 현재 위치 같이 남기기'),
    submit,
    list);
}
