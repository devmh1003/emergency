"""경보음 파일을 만든다: python tools/make-sounds.py

web/sounds/siren.wav    1급 경보음. 예전부터 쓰던 사이렌 그대로: 톱니파가 1.2초 동안 600 → 1200Hz 로 올라가고
                        1.2초 동안 내려오기를 반복한다. 끝과 처음이 이어지도록(반복 재생해도 끊기지 않게) 만든다.
web/sounds/silence.wav  경보 대기 모드에서 앱이 잠들지 않게 반복 재생하는 무음.

소리는 이 스크립트가 직접 합성한다 (녹음 파일을 쓰지 않는다).
"""
import wave
from pathlib import Path

import numpy as np

RATE = 22050
OUT = Path(__file__).resolve().parent.parent / 'web' / 'sounds'

LOW, HIGH = 600.0, 1200.0  # Hz
HALF = 1.2                 # 초 (올라가는 데 1.2초, 내려오는 데 1.2초)
PERIODS = 5                # 파일 하나에 5번 (12초), 재생할 때 계속 반복한다
HARMONICS = 8              # 톱니파를 배음으로 만든다 (1200Hz × 8 < 11025Hz, 찌그러짐 없이)
GAIN = 0.25                # 예전 경보음과 같은 크기


def write(path, samples, rate):
    data = (np.clip(samples, -1, 1) * 32767).astype('<i2')
    with wave.open(str(path), 'wb') as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(data.tobytes())


def siren():
    n = int(HALF * RATE)
    up = np.linspace(LOW, HIGH, n, endpoint=False)
    down = np.linspace(HIGH, LOW, n, endpoint=False)
    freq = np.tile(np.concatenate([up, down]), PERIODS)
    # 반복 재생 이음새에서 위상이 맞도록 전체 주기 수를 정수로 맞춘다.
    cycles = freq.sum() / RATE
    freq *= round(cycles) / cycles
    phase = 2 * np.pi * np.cumsum(freq) / RATE
    saw = sum(np.sin(k * phase) / k for k in range(1, HARMONICS + 1)) * (2 / np.pi)
    return saw / np.abs(saw).max() * GAIN * 3  # 톱니파 꼭짓값 기준으로 예전 소리와 비슷한 크기


OUT.mkdir(parents=True, exist_ok=True)
write(OUT / 'siren.wav', siren(), RATE)
write(OUT / 'silence.wav', np.zeros(16000), 16000)
for f in sorted(OUT.iterdir()):
    print(f.name, f.stat().st_size)
