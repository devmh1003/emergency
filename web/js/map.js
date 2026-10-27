// 지도 (Leaflet + OpenStreetMap). 본 지도 타일은 서비스 워커가 저장해 오프라인에서도 보인다.
import { h } from './dom.js';
import { hasLocation } from './logic.js';

const SEOUL = [37.5665, 126.978];

/**
 * @param {object} opts
 * @param {Array<{lat,lng,label,color,popup}>} opts.points
 * @param {(latlng:{lat,lng}) => void} [opts.onPick] 지도를 눌러 위치를 고를 때
 * @param {boolean} [opts.line] 점들을 선으로 이어 이동 경로를 보여줄지
 */
export function mapView({ points = [], height = 260, onPick, line = false } = {}) {
  const el = h('div', { class: 'map', style: { height: `${height}px` } });
  let map = null;
  let layer = null;
  let pending = points;

  const api = {
    el,
    setPoints(next) {
      pending = next;
      if (map) draw(true);
    },
    setPicked(pos) {
      pending = hasLocation(pos) ? [{ ...pos, label: '●', color: 'pick' }] : [];
      if (map) draw(false);
    },
  };

  function draw(fit) {
    layer.clearLayers();
    const valid = pending.filter(hasLocation);
    for (const p of valid) {
      const icon = window.L.divIcon({
        className: '',
        html: h('div', { class: `pin pin-${p.color || 'default'}` }, String(p.label ?? '')),
        iconSize: [30, 30],
        iconAnchor: [15, 15],
      });
      const marker = window.L.marker([p.lat, p.lng], { icon }).addTo(layer);
      if (p.popup) marker.bindPopup(h('div', { class: 'popup' }, p.popup));
      if (p.accuracy && p.accuracy < 2000 && p.showAccuracy) {
        window.L.circle([p.lat, p.lng], { radius: p.accuracy, weight: 1, fillOpacity: 0.1 }).addTo(layer);
      }
    }
    if (line && valid.length > 1) {
      window.L.polyline(valid.map((p) => [p.lat, p.lng]), { weight: 3, opacity: 0.6, dashArray: '6 6' }).addTo(layer);
    }
    if (fit && valid.length === 1) map.setView([valid[0].lat, valid[0].lng], 16);
    else if (fit && valid.length > 1) map.fitBounds(valid.map((p) => [p.lat, p.lng]), { padding: [30, 30], maxZoom: 16 });
  }

  function init(tries = 0) {
    if (!el.isConnected) {
      if (tries < 40) requestAnimationFrame(() => init(tries + 1));
      return;
    }
    if (!window.L) {
      el.classList.add('map-unavailable');
      el.textContent = '지도를 불러올 수 없습니다 (오프라인). 주소와 길찾기 링크를 이용하세요.';
      return;
    }
    map = window.L.map(el, { zoomControl: true, attributionControl: true }).setView(SEOUL, 11);
    window.L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      // CORS로 받아야 서비스 워커가 타일을 작은 용량으로 저장할 수 있다 (opaque 응답은 용량을 크게 차지한다).
      crossOrigin: true,
      attribution: '&copy; OpenStreetMap',
    }).addTo(map);
    layer = window.L.layerGroup().addTo(map);
    if (onPick) {
      map.on('click', (e) => onPick({ lat: Number(e.latlng.lat.toFixed(6)), lng: Number(e.latlng.lng.toFixed(6)) }));
    }
    draw(true);
    setTimeout(() => map.invalidateSize(), 200);
  }

  requestAnimationFrame(() => init());
  return api;
}
