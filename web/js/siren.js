// 사이트가 열려 있을 때 울리는 경보음. 소리 파일 없이 브라우저에서 직접 만든다.
// 브라우저는 사용자가 화면을 한 번 누르기 전에는 소리를 막을 수 있다. 그때는 경보 화면의 버튼이 소리를 켠다.
// 경보음은 1급 비상에만 쓴다 (2급은 알림만). 민방위 경보의 파상음처럼 소리가 오르내리기를 반복한다.

let ctx = null;
let osc = null;
let gain = null;
let sweep = null;
let vibrateTimer = null;

/** 1급 경보음(파상음)을 낸다. */
export function startSiren() {
  stopSiren();
  try {
    ctx = ctx || new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') ctx.resume();
    osc = ctx.createOscillator();
    gain = ctx.createGain();
    osc.type = 'sawtooth';
    gain.gain.value = 0.25;
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    let up = true;
    const tick = () => {
      if (!osc) return;
      const now = ctx.currentTime;
      osc.frequency.cancelScheduledValues(now);
      osc.frequency.setValueAtTime(up ? 600 : 1200, now);
      osc.frequency.linearRampToValueAtTime(up ? 1200 : 600, now + 1.2);
      up = !up;
    };
    tick();
    sweep = setInterval(tick, 1200);
  } catch (err) {
    console.warn('경보음을 낼 수 없습니다', err);
  }
  if (navigator.vibrate && navigator.userActivation?.hasBeenActive !== false) {
    const pattern = [600, 300, 600, 300, 600];
    navigator.vibrate(pattern);
    vibrateTimer = setInterval(() => navigator.vibrate(pattern), 3000);
  }
  // resume()이 끝나기 전이면 아직 'suspended'로 보인다. 사용자가 이미 화면을 누른 적이 있으면 곧 소리가 난다.
  return isPlaying() || Boolean(navigator.userActivation?.hasBeenActive);
}

export function isPlaying() {
  return Boolean(osc && ctx && ctx.state === 'running');
}

export function stopSiren() {
  clearInterval(sweep);
  clearInterval(vibrateTimer);
  sweep = null;
  vibrateTimer = null;
  if (osc) {
    try { osc.stop(); } catch { /* 이미 멈춤 */ }
    osc.disconnect();
  }
  osc = null;
  if (navigator.vibrate) navigator.vibrate(0);
}
