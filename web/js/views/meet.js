// 집합장소: 진행 단계, 지금 갈 곳과 남은 시간, 거리·방향(오프라인), 1~10순위 일정, 지도, 집합장소 게시판
import { h, toast, busy, panel, pageHeader, empty, field, select, alertBox, table, ask } from '../dom.js';
import { errorMessage } from '../firebase.js';
import { t } from '../i18n.js';
import { addMeetingLog, watchMeetingLogs, deleteMeetingLog } from '../store.js';
import { mapView } from '../map.js';
import {
  meetingSchedule, emergencyLevel, formatOffset, formatDateTime, formatRemaining, directionLinks, hasLocation, locationUrl,
} from '../logic.js';
import { locationPanel } from './location.js';

const STATE_LABEL = { past: t('지남'), current: t('지금'), upcoming: t('예정'), unscheduled: t('대기') };
const STATE_TAG = { past: 'tag-light', current: 'status-help', upcoming: 'tag-primary', unscheduled: 'tag-light' };

function timeText(p) {
  if (p.state === 'unscheduled') return t('{offset} 도착 · {min}분 대기', { offset: formatOffset(p.offsetHours), min: p.waitMinutes });
  return t('{at} 도착 · {deadline}까지 대기', { at: formatDateTime(p.at), deadline: formatDateTime(p.deadline) });
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
    h('ol', { class: 'steps-indicator', 'aria-label': t('집합 단계') }, points.map((p) => h('li', { class: p.state, title: t('{rank}순위 {name}', { rank: p.rank, name: p.name }) },
      h('span', { class: 'sr-only' }, t('{rank}순위 {state}', { rank: p.rank, state: STATE_LABEL[p.state] }))))),
    current
      ? h('div', { class: 'steps-label' }, h('span', { class: 'step-num' }, String(current.rank)), h('strong', null, `${current.name}`),
        h('span', { class: 'muted small' }, t('전체 {total}단계 중 {step}단계', { total: points.length, step: points.indexOf(current) + 1 })))
      : h('p', { class: 'muted small', style: { margin: 0 } }, stepIdleText(state, points)));
}

function stepIdleText(state, points) {
  const level = emergencyLevel(state.emergency);
  if (level === 'real') return t('모든 단계가 지났습니다.');
  if (level === 'alert') return t('2급 비상 중 · 1급 비상이 되면 시간이 시작됩니다 · 집합장소 {n}곳', { n: points.length });
  return t('평상시 · 집합장소 {n}곳 준비됨', { n: points.length });
}

function targetCard(state) {
  if (emergencyLevel(state.emergency) === 'alert') {
    return alertBox('warning', t('2급 비상 발령 중입니다'),
      h('p', null, t('집합 시간은 아직 시작하지 않았습니다. 1급 비상이 선언되면 그때부터 아래 시간이 실제 날짜와 시간으로 바뀝니다. 지금은 각 장소와 가는 길을 미리 확인하세요.')));
  }
  if (!state.emergency?.active) {
    return alertBox('info', t('평상시입니다'),
      h('p', null, t('아래 시간은 "1급 비상 발생 후 몇 시간"으로 표시됩니다. 1급 비상이 선언되면 실제 날짜와 시간으로 바뀌고, 지금 갈 곳이 여기에 나타납니다. (2급 단계에서는 시간이 시작되지 않습니다.)')));
  }
  const { currentRank, points } = meetingSchedule(state.meetingPoints, state.emergency);
  const p = points.find((x) => x.rank === currentRank);
  if (!p) {
    return alertBox('error', t('모든 집합 시간이 지났습니다'),
      h('p', null, t('마지막 집합장소에서 기다리거나, 관리자 안내와 가족의 생존신고 기록을 확인하세요.')));
  }
  const now = Date.now();
  const arriving = p.at.getTime() > now;
  const until = arriving ? p.at.getTime() : p.deadline.getTime();
  return h('div', { class: 'alert alert-emergency', role: 'alert' },
    h('p', { style: { margin: 0, fontWeight: 800, letterSpacing: '0.08em', fontSize: '0.8125rem', opacity: 0.85 } }, t('지금 갈 곳')),
    h('div', { class: 'target-name' }, t('{rank}순위 · {name}', { rank: p.rank, name: p.name })),
    p.address ? h('p', null, p.address) : null,
    h('p', { style: { margin: '0.5rem 0 0' } }, arriving ? t('도착 시각까지') : t('대기 종료까지')),
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
    return empty(state.isAdmin ? t('아직 집합장소가 없습니다. "집합장소 설정"에서 1순위부터 정하세요.') : t('관리자가 아직 집합장소를 정하지 않았습니다.'));
  }
  return table([t('순위'), t('장소'), t('시간'), t('상태'), t('길찾기')], points.map((p) => [
    h('strong', { class: 'num' }, t('{rank}순위', { rank: p.rank })),
    h('div', null, h('strong', null, p.name), p.address ? h('div', { class: 'small muted' }, p.address) : null, p.note ? h('div', { class: 'small' }, p.note) : null),
    h('span', { class: 'small' }, timeText(p)),
    h('span', { class: `tag ${STATE_TAG[p.state]}` }, STATE_LABEL[p.state]),
    directions(p) || h('span', { class: 'muted small' }, t('위치 미지정')),
  ]));
}

function pointMarkers(state) {
  const { currentRank, points } = meetingSchedule(state.meetingPoints, state.emergency);
  return points.filter(hasLocation).map((p) => ({
    lat: p.lat,
    lng: p.lng,
    label: String(p.rank),
    color: p.rank === currentRank ? 'help' : p.state === 'past' ? 'past' : 'meet',
    popup: t('{rank}순위 {name}', { rank: p.rank, name: p.name }),
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
    pageHeader(t('집합장소'), { lead: t('1순위 장소에 정해진 시간까지 모이고, 다 모이지 못하면 다음 순위로 이동합니다.') },
      state.isAdmin ? h('a', { class: 'btn btn-outline', href: '#/admin/meet' }, t('집합장소 설정')) : null),
    live(() => {
      const steps = stepIndicator(state);
      return steps ? h('div', { class: 'card' }, steps) : null;
    }),
    live(() => targetCard(state)),
    panel(t('내 위치에서 집합장소까지'), null, locationPanel(state, { onChange })),
    panel(t('1~10순위 일정'), null, live(() => scheduleTable(state))),
    panel(t('지도'), null, map.el, h('p', { class: 'muted small' }, t('한 번 본 지도는 휴대폰에 저장돼 오프라인에서도 보입니다. 미리 각 집합장소 주변을 한 번씩 확대해 보세요.'))),
    logSection(state));
}

// ---------- 집합장소 게시판 ----------

function logSection(state) {
  const { currentRank } = meetingSchedule(state.meetingPoints, state.emergency);
  const ranks = state.meetingPoints.map((p) => ({ value: String(p.rank), label: t('{rank}순위 {name}', { rank: p.rank, name: p.name }) }));
  const message = h('textarea', { rows: 2, maxlength: 300, placeholder: t('예: 14시 도착. 15시까지 기다리다 2순위로 이동합니다.') });
  const rankSel = select('rank', ranks.length ? ranks : [{ value: '1', label: t('1순위') }], String(currentRank || ranks[0]?.value || '1'));

  const submit = h('button', {
    class: 'btn',
    onClick: (e) => busy(e.currentTarget, async () => {
      const text = message.value.trim();
      if (!text) { toast(t('내용을 적어 주세요.'), 'error'); return; }
      try {
        const r = await addMeetingLog(state.me, rankSel.value, text);
        message.value = '';
        toast(r === 'queued' ? t('저장됨 — 연결되면 자동 전송됩니다.') : t('기록을 남겼습니다.'), r === 'queued' ? 'warn' : 'info');
      } catch (err) {
        toast(errorMessage(err), 'error');
      }
    }),
  }, t('기록 남기기'));

  const list = h('div', null, h('p', { class: 'muted' }, t('불러오는 중…')));
  const unsub = watchMeetingLogs((logs) => {
    list.replaceChildren(logs.length ? h('ul', { class: 'list' }, logs.map((l) => h('li', { class: 'list-item' },
      h('div', { class: 'item-main' },
        h('span', null, h('span', { class: 'tag kind-meet', style: { marginRight: '0.5rem' } }, t('{rank}순위', { rank: l.rank })), h('strong', null, l.name)),
        h('span', { class: 'muted small nowrap' }, formatDateTime(l.clientAt))),
      h('p', { style: { margin: '0.375rem 0 0' } }, l.message),
      h('div', { class: 'row-actions' },
        hasLocation(l) ? h('a', { class: 'btn btn-sm btn-outline', href: locationUrl(l), target: '_blank', rel: 'noopener' }, t('🗺 위치')) : null,
        state.isAdmin || l.uid === state.me.id ? h('button', {
          class: 'btn btn-sm btn-outline-secondary',
          onClick: async () => {
            if (!(await ask(t('이 기록을 지울까요?')))) return;
            try { await deleteMeetingLog(l.id); } catch (err) { toast(errorMessage(err), 'error'); }
          },
        }, t('삭제')) : null))))
      : empty(t('아직 남긴 기록이 없습니다.')));
  }, (err) => list.replaceChildren(h('p', { class: 'text-danger' }, errorMessage(err))));
  window.addEventListener('hashchange', unsub, { once: true });

  return panel(t('집합장소 게시판'), null,
    h('p', { class: 'muted small' }, t('도착했거나 다른 곳으로 이동할 때 남기세요. 모이기 위한 공지판이라 가족 모두가 봅니다.')),
    h('div', { class: 'field-row' }, field(t('장소'), rankSel), h('div')),
    field(t('내용'), message),
    submit,
    h('h3', null, t('최근 기록')),
    list);
}
