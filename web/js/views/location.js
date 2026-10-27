// 현재 위치 패널: GPS 좌표, 정확도, 집합장소까지 거리·방향(지도 없이도), 실시간 추적, 체크포인트 저장.
// GPS는 인터넷 없이도 동작하므로, 오프라인에서도 좌표와 거리·방향은 항상 보여준다.
import { h, busy, toast } from '../dom.js';
import { t } from '../i18n.js';
import { getBestPosition, watchPosition, lastKnownPosition } from '../geo.js';
import { mapView } from '../map.js';
import {
  hasLocation, locationUrl, formatDms, formatAgo, meetingSchedule, routeHint,
} from '../logic.js';

/**
 * @param {object} state 앱 상태
 * @param {object} opts
 * @param {(pos) => Promise<void>} [opts.onCheckpoint] 체크포인트 저장
 * @param {(fn) => void} opts.onChange 상태 변화 구독
 * @param {(pos) => void} [opts.onPosition] 위치를 새로 잡을 때마다
 */
export function locationPanel(state, { onCheckpoint, onChange, onPosition } = {}) {
  let pos = null;
  let stopWatch = null;

  const status = h('p', { class: 'muted small' }, t('버튼을 누르면 GPS로 현재 위치를 확인합니다. 인터넷이 없어도 됩니다.'));
  const coords = h('div');
  const routes = h('div');
  const map = mapView({ height: 220 });
  map.el.hidden = true;

  function renderRoutes() {
    const { points, currentRank } = meetingSchedule(state.meetingPoints, state.emergency);
    const withLoc = points.filter(hasLocation);
    if (!pos || !withLoc.length) {
      routes.replaceChildren();
      return;
    }
    routes.replaceChildren(
      h('h3', null, t('집합장소까지 (지도 없이도 보이는 안내)')),
      h('ul', { class: 'list' }, withLoc.map((p) => {
        const r = routeHint(pos, p);
        const current = p.rank === currentRank;
        return h('li', { class: `list-item${current ? ' meet-current' : ''}` },
          h('div', { class: 'item-main' },
            h('span', null,
              h('strong', null, t('{rank}순위 {name}', { rank: p.rank, name: p.name })),
              current ? h('span', { class: 'tag status-help', style: { marginLeft: '0.5rem' } }, t('지금 갈 곳')) : null),
            h('span', { class: 'nowrap', 'aria-hidden': 'true', style: { fontSize: '1.5rem', fontWeight: 800 } }, r.arrow)),
          h('div', { class: 'small' }, h('strong', null, r.text), ` · ${r.walk}`));
      })),
      h('p', { class: 'muted small' }, t('방향은 북쪽 기준입니다. 휴대폰 나침반 앱으로 북쪽을 확인하세요. 직선 거리라 실제 길은 더 멀 수 있습니다.')));
  }

  function show(next, source) {
    pos = next;
    onPosition?.(pos);
    const age = Date.now() - (pos.at || Date.now());
    coords.replaceChildren(
      h('div', { class: 'info-row' }, h('span', null, t('위도·경도')), h('span', { class: 'mono' }, `${pos.lat.toFixed(5)}, ${pos.lng.toFixed(5)}`)),
      h('div', { class: 'info-row' }, h('span', null, t('도·분 표기')), h('span', { class: 'mono' }, formatDms(pos.lat, pos.lng))),
      h('div', { class: 'info-row' }, h('span', null, t('정확도')), h('span', null, `${t('약 {m}m', { m: pos.accuracy })}${pos.accuracy > 100 ? ` ${t('(실외에서 더 정확해집니다)')}` : ''}`)),
      h('div', { class: 'info-row' }, h('span', null, t('확인 시각')), h('span', null, source === 'last' ? t('{ago} (마지막으로 잡힌 위치)', { ago: formatAgo(pos.at) }) : age > 60_000 ? formatAgo(pos.at) : t('방금'))),
      h('p', { class: 'small', style: { marginTop: '0.5rem' } },
        navigator.onLine ? h('a', { href: locationUrl(pos), target: '_blank', rel: 'noopener' }, t('지도 앱에서 열기')) : t('오프라인: 좌표를 종이에 적거나 문자로 보내 두세요.')));
    map.el.hidden = false;
    map.setPoints([{ ...pos, label: t('나'), color: 'me', showAccuracy: true }]);
    if (onCheckpoint) saveBtn.hidden = false;
    renderRoutes();
  }

  const locateBtn = h('button', {
    class: 'btn',
    onClick: (e) => busy(e.currentTarget, async () => {
      status.textContent = navigator.onLine ? t('위치 확인 중…') : t('오프라인: 위성 신호로 위치를 찾는 중… (최대 1분)');
      try {
        show(await getBestPosition(), 'gps');
        status.textContent = t('GPS 위치를 확인했습니다.');
      } catch (err) {
        const last = lastKnownPosition();
        if (last) {
          show(last, 'last');
          status.textContent = t('{error} 마지막으로 잡힌 위치를 대신 보여줍니다.', { error: err.message });
        } else {
          status.textContent = err.message;
        }
      }
    }),
  }, t('📍 현재 위치 확인'));

  const trackBtn = h('button', {
    class: 'btn btn-outline',
    'aria-pressed': 'false',
    onClick: () => {
      if (stopWatch) {
        stopWatch();
        stopWatch = null;
        trackBtn.textContent = t('🧭 실시간 추적');
        trackBtn.setAttribute('aria-pressed', 'false');
        status.textContent = t('실시간 추적을 멈췄습니다.');
        return;
      }
      status.textContent = t('실시간 추적 중… 걸으면서 거리와 방향이 바뀝니다. 배터리를 많이 씁니다.');
      trackBtn.textContent = t('⏹ 추적 멈추기');
      trackBtn.setAttribute('aria-pressed', 'true');
      stopWatch = watchPosition((p) => show(p, 'gps'), (err) => { status.textContent = err.message; });
    },
  }, t('🧭 실시간 추적'));

  const saveBtn = h('button', {
    class: 'btn btn-outline', hidden: true,
    onClick: (e) => busy(e.currentTarget, async () => {
      if (!pos) return;
      try {
        await onCheckpoint(pos);
      } catch (err) {
        toast(err.message, 'error');
      }
    }),
  }, t('📌 이 위치를 체크포인트로 저장'));

  // 화면을 떠나면 추적을 멈춘다 (배터리 절약)
  window.addEventListener('hashchange', () => { if (stopWatch) stopWatch(); stopWatch = null; }, { once: true });
  // 집합장소가 바뀌면 거리 안내도 갱신
  onChange?.(renderRoutes);

  return h('div', null,
    status,
    h('div', { class: 'row' }, locateBtn, trackBtn),
    coords,
    map.el,
    saveBtn,
    routes);
}
