// 사이트가 열려 있을 때 울리는 경보음. 소리 파일 없이 브라우저에서 직접 만든다.
// 브라우저는 사용자가 화면을 한 번 누르기 전에는 소리를 막을 수 있다. 그때는 경보 화면의 버튼이 소리를 켠다.

let ctx = null;
let osc = null;
let gain = null;
let sweep = null;
let vibrateTimer = null;

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
  if (navigator.vibrate) {
    navigator.vibrate([600, 300, 600, 300, 600]);
    vibrateTimer = setInterval(() => navigator.vibrate([600, 300, 600, 300, 600]), 3000);
  }
  return isPlaying();
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
