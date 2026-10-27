// 앱 아이콘(PNG) 생성기. 외부 라이브러리 없이 web/icons/icon-192.png, icon-512.png 를 만든다.
// 모양은 web/icons/icon.svg 와 같다: 빨간 바탕, 흰 집, 집 안의 빨간 십자.
// 실행: node tools/make-icons.js
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const RED = [185, 28, 28];
const WHITE = [255, 255, 255];

// 512 기준 좌표에서 (x, y)의 색
function colorAt(x, y) {
  const inRoof = y >= 96 && y <= 240 && Math.abs(x - 256) <= ((y - 96) / 144) * 160;
  const inBody = x >= 136 && x <= 376 && y >= 230 && y <= 416;
  const inCross = (x >= 236 && x <= 276 && y >= 266 && y <= 390) || (x >= 196 && x <= 316 && y >= 308 && y <= 348);
  if ((inRoof || inBody) && !inCross) return WHITE;
  return RED;
}

function crc32(buf) {
  let c = ~0;
  for (const b of buf) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function png(size) {
  const ss = 4; // 가장자리를 부드럽게: 픽셀당 4x4 표본
  const raw = Buffer.alloc((size * 3 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 3 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const acc = [0, 0, 0];
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const c = colorAt(((x + (sx + 0.5) / ss) * 512) / size, ((y + (sy + 0.5) / ss) * 512) / size);
          acc[0] += c[0]; acc[1] += c[1]; acc[2] += c[2];
        }
      }
      const o = y * (size * 3 + 1) + 1 + x * 3;
      for (let i = 0; i < 3; i++) raw[o + i] = Math.round(acc[i] / (ss * ss));
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // 비트 깊이
  ihdr[9] = 2; // RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

for (const size of [192, 512]) {
  writeFileSync(new URL(`../web/icons/icon-${size}.png`, import.meta.url), png(size));
}
console.log('icons written');
