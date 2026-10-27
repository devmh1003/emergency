// 집합장소: 진행 단계, 지금 갈 곳과 남은 시간, 거리·방향(오프라인), 1~10순위 일정, 지도, 집합장소 게시판
import { h, toast, busy, panel, pageHeader, empty, field, select, alertBox, table } from '../dom.js';
import { errorMessage } from '../firebase.js';
import { addMeetingLog, watchMeetingLogs, deleteMeetingLog } from '../store.js';
import { getBestPosition, lastKnownPosition } from '../geo.js';
import { mapView } from '../map.js';
import {
  meetingSchedule, formatOffset, formatDateTime, formatRemaining, directionLinks, hasLocation, locationUrl,
} from '../logic.js';
import { locationPanel } from './location.js';

const STATE_LABEL = { past: '지남', current: '지금', upcoming: '예정', unscheduled: '대기' };
const STATE_TAG = { past: 'tag-light', current: 'status-help', upcoming: 'tag-primary', unscheduled: 'tag-light' };

function timeText(p) {
  if (p.state === 'unscheduled') return `${formatOffset(p.offsetHours)} 도착 · ${p.waitMinutes}분 대기`;
  return `${formatDateTime(p.at)} 도착 · ${formatDateTime(p.deadline)}까지 대기`;
}

function directions(p) {
  const links = directionLinks(p, p.name);
  return links.length
    ? h('div', { class: 'row-actions' }, links.map((l) => h('a', { class: 'btn btn-sm btn-outline', href: l.href, target: '_blank', rel: 'noopener' }, `🧭 ${l.label}`)))
    : null;
}

function stepIndicator(state) {
  const { currentRank, points } = meetingSchedule(state.meetingPoints, state.emergency);
  if (!points.length) return null;
  const current = points.find((p) => p.rank === currentRank);
  return h('div', null,
    h('ol', { class: 'steps-indicator', 'aria-label': '집합 단계' }, points.map((p) => h('li', { class: p.state, title: `${p.rank}순위 ${p.name}` },
      h('span', { class: 'sr-only' }, `${p.rank}순위 ${STATE_LABEL[p.state]}`)))),
    current
      ? h('div', { class: 'steps-label' }, h('span', { class: 'step-num' }, String(current.rank)), h('strong', null, `${current.name}`),
        h('span', { class: 'muted small' }, `전체 ${points.length}단계 중 ${points.indexOf(current) + 1}단계`))
      : h('p', { class: 'muted small', style: { margin: 0 } }, state.emergency?.active ? '모든 단계가 지났습니다.' : `평상시 · 집합장소 ${points.length}곳 준비됨`));
}

function targetCard(state) {
  if (!state.emergency?.active) {
    return alertBox('info', '평상시입니다',
      h('p', null, '아래 시간은 "비상 발생 후 몇 시간"으로 표시됩니다. 비상이 선언되면 실제 날짜와 시간으로 바뀌고, 지금 갈 곳이 여기에 나타납니다.'));
  }
  const { currentRank, points } = meetingSchedule(state.meetingPoints, state.emergency);
  const p = points.find((x) => x.rank === currentRank);
  if (!p) {
    return alertBox('error', '모든 집합 시간이 지났습니다',
      h('p', null, '마지막 집합장소에서 기다리거나, 관리자 안내와 가족의 생존신고 기록을 확인하세요.'));
  }
  const now = Date.now();
  const arriving = p.at.getTime() > now;
  const until = arriving ? p.at.getTime() : p.deadline.getTime();
  return h('div', { class: 'alert alert-emergency', role: 'alert' },
    h('p', { style: { margin: 0, fontWeight: 800, letterSpacing: '0.08em', fontSize: '0.8125rem', opacity: 0.85 } }, '지금 갈 곳'),
    h('div', { class: 'target-name' }, `${p.rank}순위 · ${p.name}`),
    p.address ? h('p', null, p.address) : null,
    h('p', { style: { margin: '0.5rem 0 0' } }, arriving ? '도착 시각까지' : '대기 종료까지'),
    h('div', { class: 'countdown', 'data-until': String(until) }, formatRemaining(until - now)),
    h('p', { class: 'small', style: { opacity: 0.9 } }, timeText(p)),
    p.note ? h('p', { style: { background: 'rgb(255 255 255 / 12%)', padding: '0.5rem 0.75rem' } }, p.note) : null,
    directionLinks(p, p.name).length ? h('div', { class: 'alert-actions' }, directionLinks(p, p.name).map((l) => h('a', {
      class: 'btn btn-sm', href: l.href, target: '_blank', rel: 'noopener', style: { background: '#fff', color: '#9c3d10' },
    }, `🧭 ${l.label}`))) : null);
}

function scheduleTable(state) {
  const { points } = meetingSchedule(state.meetingPoints, state.emergency);
  if (!points.length) {
    return empty(state.isAdmin ? '아직 집합장소가 없습니다. "집합장소 설정"에서 1순위부터 정하세요.' : '관리자가 아직 집합장소를 정하지 않았습니다.');
  }
  return table(['순위', '장소', '시간', '상태', '길찾기'], points.map((p) => [
    h('strong', { class: 'num' }, `${p.rank}순위`),
    h('div', null, h('strong', null, p.name), p.address ? h('div', { class: 'small muted' }, p.address) : null, p.note ? h('div', { class: 'small' }, p.note) : null),
    h('span', { class: 'small' }, timeText(p)),
    h('span', { class: `tag ${STATE_TAG[p.state]}` }, STATE_LABEL[p.state]),
    directions(p) || h('span', { class: 'muted small' }, '위치 미지정'),
  ]));
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
  const map = mapView({ points: pointMarkers(state), height: 300 });
  let sig = '';
  onChange(() => {
    const pts = pointMarkers(state);
    const next = JSON.stringify(pts);
    if (next !== sig) { sig = next; map.setPoints(pts); }
  });

  return h('div', { class: 'page' },
    pageHeader('집합장소', { lead: '1순위 장소에 정해진 시간까지 모이고, 다 모이지 못하면 다음 순위로 이동합니다.' },
      state.isAdmin ? h('a', { class: 'btn btn-outline', href: '#/admin/meet' }, '집합장소 설정') : null),
    h('div', { class: 'card' }, live(() => stepIndicator(state))),
    live(() => targetCard(state)),
    panel('내 위치에서 집합장소까지', null, locationPanel(state, { onChange })),
    panel('1~10순위 일정', null, live(() => scheduleTable(state))),
    panel('지도', null, map.el, h('p', { class: 'muted small' }, '한 번 본 지도는 휴대폰에 저장돼 오프라인에서도 보입니다. 미리 각 집합장소 주변을 한 번씩 확대해 보세요.')),
    logSection(state));
}

// ---------- 집합장소 게시판 ----------

function logSection(state) {
  const { currentRank } = meetingSchedule(state.meetingPoints, state.emergency);
  const ranks = state.meetingPoints.map((p) => ({ value: String(p.rank), label: `${p.rank}순위 ${p.name}` }));
  const message = h('textarea', { rows: 2, maxlength: 300, placeholder: '예: 14시 도착. 15시까지 기다리다 2순위로 이동합니다.' });
  const rankSel = select('rank', ranks.length ? ranks : [{ value: '1', label: '1순위' }], String(currentRank || ranks[0]?.value || '1'));
  const withLoc = h('input', { type: 'checkbox', checked: true });

  const submit = h('button', {
    class: 'btn',
    onClick: (e) => busy(e.currentTarget, async () => {
      const text = message.value.trim();
      if (!text) { toast('내용을 적어 주세요.', 'error'); return; }
      let pos = null;
      if (withLoc.checked) {
        try { pos = await getBestPosition(); } catch (err) {
          pos = lastKnownPosition();
          toast(pos ? '마지막으로 잡힌 위치를 같이 남깁니다.' : `위치 없이 저장합니다: ${err.message}`, 'warn');
        }
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
      h('div', { class: 'item-main' },
        h('span', null, h('span', { class: 'tag kind-meet', style: { marginRight: '0.5rem' } }, `${l.rank}순위`), h('strong', null, l.name)),
        h('span', { class: 'muted small nowrap' }, formatDateTime(l.clientAt))),
      h('p', { style: { margin: '0.375rem 0 0' } }, l.message),
      h('div', { class: 'row-actions' },
        hasLocation(l) ? h('a', { class: 'btn btn-sm btn-outline', href: locationUrl(l), target: '_blank', rel: 'noopener' }, '🗺 위치') : null,
        state.isAdmin || l.uid === state.me.id ? h('button', {
          class: 'btn btn-sm btn-outline-secondary',
          onClick: async () => {
            if (!confirm('이 기록을 지울까요?')) return;
            try { await deleteMeetingLog(l.id); } catch (err) { toast(errorMessage(err), 'error'); }
          },
        }, '삭제') : null))))
      : empty('아직 남긴 기록이 없습니다.'));
  }, (err) => list.replaceChildren(h('p', { class: 'text-danger' }, errorMessage(err))));
  window.addEventListener('hashchange', unsub, { once: true });

  return panel('집합장소 게시판', null,
    h('p', { class: 'muted small' }, '도착했거나 다른 곳으로 이동할 때 남기세요. 모이기 위한 공지판이라 가족 모두가 봅니다.'),
    h('div', { class: 'field-row' }, field('장소', rankSel), h('div')),
    field('내용', message),
    h('label', { class: 'check' }, withLoc, h('span', null, '현재 위치 같이 남기기')),
    submit,
    h('h3', null, '최근 기록'),
    list);
}
