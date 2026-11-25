// 실제 서비스 상태 점검: node tools/health-check.mjs  (문제가 있으면 종료 코드 1)
// 읽기만 한다. 로그인 시도(틀리면 잠김)와 알림 발송은 하지 않는다.
import { readFileSync } from 'node:fs';

const SITE = 'https://devmh1003.github.io/emergency/';
const ORIGIN = new URL(SITE).origin;
const read = (f) => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
const self = {};
new Function('self', read('web/js/config.js'))(self);
const { workerUrl, firebase } = self.FAMILY_CONFIG;

let failed = 0;
async function check(name, fn) {
  // 잠깐의 통신 장애로 경보가 울리지 않게 세 번까지 해 본다.
  let detail = '';
  for (let i = 0; i < 3; i++) {
    try {
      detail = await fn();
      console.log(`✅ ${name}${detail ? ` — ${detail}` : ''}`);
      return;
    } catch (err) {
      detail = err.message;
      if (i < 2) await new Promise((r) => setTimeout(r, 5000));
    }
  }
  failed++;
  console.log(`❌ ${name} — ${detail}`);
}
const get = (url, init = {}) => fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(15_000), ...init });
const expect = (ok, message) => { if (!ok) throw new Error(message); };

await check('사이트 첫 화면', async () => {
  const res = await get(`${SITE}?health=${Date.now()}`);
  expect(res.ok, `HTTP ${res.status}`);
  const build = /data-build="([^"]+)"/.exec(await res.text())?.[1];
  expect(build && build !== 'dev', `버전 표시가 이상함: ${build}`);
  return `버전 ${build}`;
});

await check('사이트 파일 전부 (하나라도 없으면 새 버전이 설치되지 않는다)', async () => {
  const sw = await (await get(`${SITE}sw.js?health=${Date.now()}`)).text();
  const list = /const APP_FILES = \[([\s\S]*?)\];/.exec(sw);
  expect(list, 'sw.js 를 읽지 못함');
  const files = [...list[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
  const bad = (await Promise.all(files.map(async (f) => ((await get(SITE + f)).ok ? null : f)))).filter(Boolean);
  expect(!bad.length, `없는 파일: ${bad.join(', ')}`);
  return `${files.length}개`;
});

await check('알림 서버', async () => {
  const res = await get(`${workerUrl}/`);
  const data = await res.json();
  expect(res.ok && data.ok, `HTTP ${res.status}`);
  if (!data.now) return '응답함 (시각 안내 없음: 예전 버전)';
  const diff = Math.abs(data.now - Date.now());
  expect(diff < 5 * 60e3, `시각 차이 ${Math.round(diff / 1000)}초`);
  return '응답함';
});

await check('알림 서버 설정과 로그인 검사 (토큰 없으면 거부)', async () => {
  const res = await get(`${workerUrl}/notify`, { method: 'POST', headers: { Origin: ORIGIN, 'Content-Type': 'application/json' }, body: '{}' });
  expect(res.status === 401, `HTTP ${res.status} (401 이어야 함. 500 이면 비밀 변수 확인)`);
  expect(res.headers.get('access-control-allow-origin') === ORIGIN, '사이트 주소가 허용되지 않음');
});

await check('알림 서버가 다른 사이트를 거부', async () => {
  const res = await get(`${workerUrl}/notify`, { method: 'POST', headers: { Origin: 'https://example.com' }, body: '{}' });
  expect(res.status === 403, `HTTP ${res.status}`);
});

await check('데이터베이스 (Firestore)', async () => {
  const res = await get(`https://firestore.googleapis.com/v1/projects/${firebase.projectId}/databases/(default)/documents/public/gates?key=${firebase.apiKey}`, { headers: { Referer: SITE } });
  expect(res.ok, `HTTP ${res.status} (429 면 하루 무료 한도 초과)`);
});

await check('가족 정보가 밖에서 보이지 않음', async () => {
  const res = await get(`https://firestore.googleapis.com/v1/projects/${firebase.projectId}/databases/(default)/documents/members?key=${firebase.apiKey}`, { headers: { Referer: SITE } });
  expect(res.status === 403, `HTTP ${res.status} (403 이어야 함. 바로 보안 규칙 확인)`);
});

console.log(failed ? `\n${failed}개 문제. docs/recovery.md 를 보세요.` : '\n모두 정상');
process.exitCode = failed ? 1 : 0;
