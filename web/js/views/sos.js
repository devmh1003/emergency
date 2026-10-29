// 구조 신호: 손전등, SOS 불빛(모스 부호), 호루라기 소리, 구조 신호 요령.
// 갇히거나 길을 잃었을 때 휴대폰 하나로 내 위치를 알리는 도구. 인터넷이 없어도 된다.
import { h, panel, pageHeader, alertBox } from '../dom.js';
import { t } from '../i18n.js';

// 모스 부호 SOS: · · · — — — · · ·  (점 1, 선 3, 글자 사이 3, 반복 사이 7 단위)
const UNIT = 220;
const SOS = [1, 1, 1, 3, 3, 3, 1, 1, 1];

let overlay = null;
let flashTimer = null;
let wakeLock = null;
let audioCtx = null;
let whistleTimer = null;
let whistleNodes = [];

async function keepAwake(on) {
  try {
    if (on && !wakeLock && navigator.wakeLock) wakeLock = await navigator.wakeLock.request('screen');
    if (!on && wakeLock) { await wakeLock.release(); wakeLock = null; }
  } catch { /* 지원하지 않는 휴대폰 */ }
}

function showOverlay(onClose) {
  hideOverlay();
  overlay = h('div', {
    class: 'sos-overlay',
    role: 'button',
    tabindex: '0',
    'aria-label': t('화면을 누르면 끕니다'),
    onClick: () => { hideOverlay(); onClose?.(); },
  }, h('span', { class: 'sos-overlay-hint' }, t('화면을 누르면 끕니다')));
  document.body.append(overlay);
  keepAwake(true);
  return overlay;
}

export function hideOverlay() {
  clearTimeout(flashTimer);
  flashTimer = null;
  overlay?.remove();
  overlay = null;
  keepAwake(false);
}

/** SOS 불빛: 흰 화면을 모스 부호대로 깜빡인다. 어두울 때 멀리서도 보인다. */
function startFlash(onStop) {
  const el = showOverlay(onStop);
  let i = 0;
  let on = true;
  const step = () => {
    if (!overlay) return;
    el.classList.toggle('dark', !on);
    let wait;
    if (on) wait = SOS[i] * UNIT;
    else {
      // 글자(3개씩) 사이는 3단위, 한 바퀴 뒤에는 7단위
      i++;
      if (i >= SOS.length) { i = 0; wait = 7 * UNIT; } else wait = (i % 3 === 0 ? 3 : 1) * UNIT;
    }
    on = !on;
    flashTimer = setTimeout(step, wait);
  };
  step();
}

/** 호루라기: 2,800Hz 부근의 높은 소리. 휴대폰 스피커에서 가장 멀리 가는 음역이다. 3번 길게 = 구조 요청. */
function blast(ctx, at, duration) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'square';
  osc.frequency.setValueAtTime(2800, at);
  // 진짜 호루라기처럼 살짝 떨리게
  osc.frequency.linearRampToValueAtTime(2950, at + duration / 2);
  osc.frequency.linearRampToValueAtTime(2800, at + duration);
  gain.gain.setValueAtTime(0, at);
  gain.gain.linearRampToValueAtTime(0.6, at + 0.02);
  gain.gain.setValueAtTime(0.6, at + duration - 0.03);
  gain.gain.linearRampToValueAtTime(0, at + duration);
  osc.connect(gain).connect(ctx.destination);
  osc.start(at);
  osc.stop(at + duration);
  whistleNodes.push(osc);
}

function startWhistle() {
  stopWhistle();
  audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
  audioCtx.resume();
  const round = () => {
    const now = audioCtx.currentTime + 0.05;
    for (let k = 0; k < 3; k++) blast(audioCtx, now + k * 1.6, 1.2);
    whistleTimer = setTimeout(round, 8000);
  };
  round();
  keepAwake(true);
}

export function stopWhistle() {
  clearTimeout(whistleTimer);
  whistleTimer = null;
  for (const n of whistleNodes) { try { n.stop(); } catch { /* 이미 끝남 */ } }
  whistleNodes = [];
}

export function stopAllSignals() {
  hideOverlay();
  stopWhistle();
}

export function sosView() {
  const whistleBtn = h('button', { class: 'btn btn-secondary btn-lg btn-block', type: 'button' }, t('📣 호루라기 소리 (3번씩 반복)'));
  let whistling = false;
  whistleBtn.addEventListener('click', () => {
    whistling = !whistling;
    if (whistling) {
      startWhistle();
      whistleBtn.textContent = t('⏹ 호루라기 멈추기');
    } else {
      stopWhistle();
      keepAwake(false);
      whistleBtn.textContent = t('📣 호루라기 소리 (3번씩 반복)');
    }
  });
  window.addEventListener('hashchange', stopAllSignals, { once: true });

  return h('div', { class: 'page' },
    pageHeader(t('🆘 구조 신호'), { lead: t('갇히거나 길을 잃었을 때 휴대폰으로 내 위치를 알립니다. 인터넷이 없어도 됩니다. 배터리를 아끼려면 필요할 때만 켜세요.') }),
    alertBox('info', null, h('p', null, t('먼저 "도움 요청"을 눌러 가족에게 위치를 보내고, 119에 문자로 위치·층·상황을 보내세요. 그다음 이 신호로 구조대의 눈과 귀를 끕니다.'))),

    panel(t('🔦 손전등'), null,
      h('p', { class: 'small muted' }, t('화면 전체를 흰색으로 켭니다. 휴대폰 밝기를 최대로 올리세요. 화면이 꺼지지 않게 유지합니다.')),
      h('button', { class: 'btn btn-lg btn-block', type: 'button', onClick: () => showOverlay() }, t('🔦 손전등 켜기'))),

    panel(t('💡 SOS 불빛'), null,
      h('p', { class: 'small muted' }, t('화면을 모스 부호 SOS(짧게 3번, 길게 3번, 짧게 3번)로 깜빡입니다. 밤에 창문·옥상에서 멀리까지 보입니다.')),
      h('button', { class: 'btn btn-lg btn-block', type: 'button', onClick: () => startFlash() }, t('💡 SOS 불빛 켜기'))),

    panel(t('📣 호루라기'), null,
      h('p', { class: 'small muted' }, t('높은 호루라기 소리를 3번씩 8초마다 냅니다. 목소리보다 멀리 가고 체력을 아낍니다. 휴대폰 음량을 최대로 올리세요.')),
      whistleBtn),

    panel(t('📖 구조 신호 요령'), null,
      h('ul', { class: 'list list-compact' }, [
        t('무엇이든 3번 반복하면 "구조 요청"입니다: 호루라기 3번, 두드리기 3번, 불빛 3번.'),
        t('갇혔을 때는 소리 지르기보다 파이프·벽·금속을 돌로 두드리세요. 소리는 체력과 먼지를 씁니다.'),
        t('낮에는 거울·휴대폰 화면·CD로 햇빛을 반사해 헬기·구조대 쪽으로 비춥니다.'),
        t('넓은 땅에는 돌·옷으로 큰 글자 SOS 또는 X를 만듭니다. 글자 하나가 3m 이상이어야 공중에서 보입니다.'),
        t('밝은 색 천을 높은 곳에 매달거나 흔듭니다. 주황·노랑이 가장 잘 보입니다.'),
        t('휴대폰은 비행기 모드로 두고 1시간마다 10초만 켜서 신호를 확인하세요. 신호가 잡히면 통화보다 문자가 먼저 갑니다.'),
        t('한곳에 머무세요. 움직이는 사람보다 멈춰 있는 사람이 찾기 쉽습니다.'),
      ].map((text) => h('li', { class: 'list-item small' }, text)))));
}
