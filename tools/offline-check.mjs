// 오프라인 실제 점검: 진짜 브라우저(Chrome)에서 인터넷을 끊고 앱이 어떻게 동작하는지 확인한다.
// 준비 (터미널 3개):
//   1) npx -y firebase-tools@13.29.1 emulators:start --only auth,firestore --project demo-family
//   2) EMULATOR=1 node tools/serve.js
//   3) PLAYWRIGHT_DIR=<playwright 가 설치된 폴더> node tools/offline-check.mjs
//      (playwright 는 이 저장소에 넣지 않는다: 다른 폴더에서 `npm i playwright` 한 뒤 그 폴더를 PLAYWRIGHT_DIR 로 준다.
//       설치된 Chrome 을 쓰므로 브라우저를 따로 받지 않는다.)
// 순서: 처음 설정 → 홈 → 서비스 워커 저장 완료 대기 → 인터넷 끊기 → 새로고침 → 각 화면 확인 → 생존신고·비상선언 →
//       인터넷 복구 → 에뮬레이터에 전송됐는지 확인. 실패하면 종료 코드 1.
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// 서비스 워커를 거쳐 나가는 요청(Firestore 포함)도 route() 로 막을 수 있게 한다 ("와이파이는 되는데 인터넷이 안 될 때" 점검용).
process.env.PW_EXPERIMENTAL_SERVICE_WORKER_NETWORK_EVENTS = '1';
const pwDir = process.env.PLAYWRIGHT_DIR || process.cwd();
const { chromium } = createRequire(join(pwDir, 'package.json'))('playwright');

const SITE = process.env.SITE || 'http://localhost:5500/';
const FIRESTORE = 'http://127.0.0.1:8080/v1/projects/demo-family/databases/(default)/documents';
const results = [];
const ok = (name, pass, detail = '') => {
  results.push({ name, pass, detail });
  console.log(`${pass ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`);
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitToast(page, includes, ms = 12_000) {
  const deadline = Date.now() + ms;
  let last = '';
  while (Date.now() < deadline) {
    last = await page.evaluate(() => document.getElementById('toast')?.textContent || '');
    if (last.includes(includes)) return last;
    await sleep(200);
  }
  throw new Error(`토스트 "${includes}" 가 ${ms}ms 안에 안 나타남 (마지막: "${last}")`);
}

async function confirmDialog(page) {
  await page.locator('.modal .modal-actions button').last().click();
}

async function emulatorDoc(path) {
  const res = await fetch(`${FIRESTORE}/${path}`, { headers: { Authorization: 'Bearer owner' } });
  if (res.status === 404) return null;
  return res.json();
}

// 서비스 워커가 저장해야 하는 앱 파일 수 (sw.js 의 APP_FILES)
const swSource = readFileSync(new URL('../web/sw.js', import.meta.url), 'utf8');
const APP_FILE_COUNT = [...swSource.match(/const APP_FILES = \[([\s\S]*?)\];/)[1].matchAll(/'([^']+)'/g)].length;

// 에뮬레이터를 비워 매번 처음 설정부터 시작한다
for (const url of [
  'http://127.0.0.1:8080/emulator/v1/projects/demo-family/databases/(default)/documents',
  'http://127.0.0.1:9099/emulator/v1/projects/demo-family/accounts',
]) {
  const res = await fetch(url, { method: 'DELETE' }).catch(() => null);
  if (!res?.ok) { console.error(`에뮬레이터에 연결할 수 없습니다: ${url}`); process.exit(2); }
}

const browser = await chromium.launch({ channel: process.env.CHANNEL || 'chrome', headless: process.env.HEADED !== '1' });
const context = await browser.newContext({
  geolocation: { latitude: 37.5665, longitude: 126.978 },
  permissions: ['geolocation'],
  locale: 'ko-KR',
  viewport: { width: 420, height: 860 },
});
const page = await context.newPage();
const errors = [];
page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
page.on('console', (msg) => {
  if (msg.type() === 'error' && !msg.text().startsWith('Failed to load resource')) errors.push(`console: ${msg.text().slice(0, 200)}`);
});
// 오프라인에서 서비스 워커가 내주지 못한 주소 (어떤 파일이 저장되지 않았는지 보여 준다)
const failedUrls = new Map();
page.on('requestfailed', (req) => {
  const u = req.url().replace(/\?.*$/, '');
  failedUrls.set(u, (failedUrls.get(u) || 0) + 1);
});

try {
  // 1. 처음 설정 → 첫 관리자로 로그인
  await page.goto(SITE);
  await page.waitForSelector('input[name=name]', { timeout: 30_000 });
  await page.fill('input[name=name]', '점검관리자');
  await page.fill('input[name=phone]', '010-1234-5678');
  await page.fill('input[name=family]', 'family-123456');
  await page.fill('input[name=admin]', 'admin-12345678');
  await page.fill('input[name=backup]', 'backup-12345678');
  await page.check('input[name=noted]');
  await page.click('form button[type=submit]');
  await page.waitForSelector('text=나 무사해요', { timeout: 60_000 });
  ok('처음 설정 후 홈 화면', true);

  // 2. 서비스 워커가 앱 파일을 모두 저장할 때까지 기다린다
  const saved = await page.evaluate(async (want) => {
    await navigator.serviceWorker.ready;
    const deadline = Date.now() + 60_000;
    while (Date.now() < deadline) {
      const keys = await caches.keys();
      const app = keys.find((k) => k.startsWith('family-app-'));
      if (app && navigator.serviceWorker.controller) {
        const n = (await (await caches.open(app)).keys()).length;
        const libs = keys.includes('family-libs-v1') ? (await (await caches.open('family-libs-v1')).keys()).length : 0;
        if (n >= want && libs >= 4) return { app: n, libs };
      }
      await new Promise((r) => setTimeout(r, 500));
    }
    return null;
  }, APP_FILE_COUNT);
  ok('서비스 워커가 앱 파일·라이브러리를 저장', Boolean(saved), saved ? `앱 파일 ${saved.app}개, 라이브러리 ${saved.libs}개` : '60초 안에 저장되지 않음');
  if (!saved) throw new Error('서비스 워커 저장 실패');
  // 글꼴 등 처음 쓸 때 저장되는 파일이 들어갈 시간
  await sleep(2000);

  // 3. 인터넷 끊고 새로고침
  await context.setOffline(true);
  await page.reload();
  await page.waitForSelector('text=나 무사해요', { timeout: 30_000 }).then(() => ok('오프라인에서 새로고침해도 홈이 열림', true))
    .catch((e) => ok('오프라인에서 새로고침해도 홈이 열림', false, e.message));
  const banner = await page.evaluate(() => document.querySelector('.offline-banner')?.textContent || '');
  ok('오프라인 안내 띠가 보임', banner.includes('오프라인'), banner.slice(0, 60));

  // 4. 각 화면이 깨지지 않고 열리는지
  const pages = ['#/meet', '#/protocols', '#/contacts', '#/sos', '#/location', '#/supplies', '#/records', '#/family', '#/settings', '#/guide', '#/emergency', '#/admin', '#/'];
  for (const hash of pages) {
    const before = errors.length;
    await page.evaluate((h) => { location.hash = h; }, hash);
    await sleep(900);
    const text = await page.evaluate(() => document.getElementById('view')?.innerText || '');
    const spinner = await page.evaluate(() => Boolean(document.querySelector('#view .spinner')));
    const toast = await page.evaluate(() => document.getElementById('toast')?.className.includes('show') ? document.getElementById('toast').textContent : '');
    const broken = spinner || text.trim().length < 20 || toast.includes('문제가 생겼습니다');
    ok(`오프라인 화면 ${hash}`, !broken && errors.length === before, broken ? `spinner=${spinner} 글자수=${text.trim().length} ${toast}` : (errors.length > before ? errors.slice(before).join(' | ') : `${text.trim().length}자`));
  }

  // 5. 생존신고 (오프라인) → "저장됨" 안내
  await page.evaluate(() => { location.hash = '#/'; });
  await page.waitForSelector('text=나 무사해요');
  await page.click('button:has-text("나 무사해요")');
  await waitToast(page, '저장됨', 15_000).then((m) => ok('오프라인 생존신고: 보관 안내', true, m))
    .catch((e) => ok('오프라인 생존신고: 보관 안내', false, e.message));

  // 앞 단계의 토스트가 남아 다음 판정에 섞이지 않게 지운다
  const clearToast = () => page.evaluate(() => { const b = document.getElementById('toast'); if (b) { b.textContent = ''; b.classList.remove('show'); } });

  // 6. 비상선언 (오프라인) → 멈추지 않고 보관 안내
  await clearToast();
  await page.evaluate(() => { location.hash = '#/emergency'; });
  await page.waitForSelector('form button[type=submit]', { timeout: 10_000 });
  await page.click('form button[type=submit]');
  await page.waitForSelector('.modal', { timeout: 5_000 });
  await confirmDialog(page);
  await waitToast(page, '보관했습니다', 15_000).then((m) => ok('오프라인 비상선언: 보관 안내', true, m))
    .catch((e) => ok('오프라인 비상선언: 보관 안내', false, e.message));
  const stuck = await page.evaluate(() => [...document.querySelectorAll('button[disabled]')].map((b) => b.textContent.trim()).filter((s) => s.includes('비상')));
  ok('비상선언 버튼이 멈춰 있지 않음', stuck.length === 0, stuck.join(', '));
  const declaredLocally = await page.evaluate(() => (document.getElementById('banner')?.innerText || '').includes('비상'));
  ok('선언이 이 휴대폰 화면에 바로 반영됨', declaredLocally);

  // 7. 집합장소 게시판 글 (오프라인)
  await clearToast();
  await page.evaluate(() => { location.hash = '#/meet'; });
  await sleep(800);
  const logInput = page.locator('#view textarea').first();
  if (await logInput.count()) {
    await logInput.fill('오프라인 점검 메시지');
    await page.locator('#view button:has-text("기록 남기기")').first().click();
    await waitToast(page, '연결되면', 12_000).then((m) => ok('오프라인 게시판 글: 보관 안내', true, m))
      .catch((e) => ok('오프라인 게시판 글: 보관 안내', false, e.message));
  } else {
    ok('오프라인 게시판 글: 입력칸 찾기', false, '게시판 입력칸이 없음');
  }

  // 7b. 비상 물품 추가 (오프라인)
  await clearToast();
  await page.evaluate(() => { location.hash = '#/supplies'; });
  await sleep(800);
  await page.locator('#view button:has-text("+ 물품 추가")').first().click();
  const supplyName = page.locator('#view input[name=name]').first();
  if (await supplyName.count()) {
    await supplyName.fill('점검용 물');
    await page.locator('#view form button[type=submit]').first().click();
    await waitToast(page, '연결되면', 12_000).then((m) => ok('오프라인 물품 추가: 보관 안내', true, m))
      .catch((e) => ok('오프라인 물품 추가: 보관 안내', false, e.message));
    const listed = await page.evaluate(() => (document.getElementById('view')?.innerText || '').includes('점검용 물'));
    ok('추가한 물품이 목록에 바로 보임', listed);
  } else {
    ok('오프라인 물품 추가: 입력칸 찾기', false, '물품 입력칸이 없음');
  }

  // 8. 인터넷 복구 → 보관된 쓰기가 서버로 가는지
  await context.setOffline(false);
  const deadline = Date.now() + 30_000;
  let emergency = null;
  while (Date.now() < deadline) {
    emergency = await emulatorDoc('emergency/current');
    if (emergency?.fields?.active?.booleanValue) break;
    await sleep(1000);
  }
  ok('복구 후 비상선언이 서버에 저장됨', Boolean(emergency?.fields?.active?.booleanValue), emergency ? `level=${emergency.fields.level?.stringValue}` : '문서 없음');
  const checkins = await emulatorDoc('checkins');
  const n = checkins?.documents?.length || 0;
  ok('복구 후 생존신고가 서버에 저장됨', n >= 1, `${n}건`);
  const logs = await emulatorDoc('meetingLogs');
  ok('복구 후 게시판 글이 서버에 저장됨', (logs?.documents?.length || 0) >= 1);
  const supplies = await emulatorDoc('supplies');
  ok('복구 후 물품이 서버에 저장됨', (supplies?.documents?.length || 0) >= 1);
  // 복구되면 띠가 사라져야 한다
  await sleep(3000);
  const bannerAfter = await page.evaluate(() => document.querySelector('.offline-banner')?.textContent || '');
  ok('복구 후 오프라인 띠가 사라짐', !bannerAfter, bannerAfter.slice(0, 60));

  // 9. 와이파이는 되는데 인터넷이 안 될 때: 브라우저는 "온라인"이라고 하지만 서버에는 닿지 않는다 → "서버에 연결되지 않습니다" 띠.
  //    (서비스 워커를 거치는 요청은 route() 로 막히지 않아, 인터넷을 끊고 브라우저의 온라인 판정만 되돌려 흉내 낸다.)
  await context.setOffline(true);
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'onLine', { get: () => true, configurable: true });
    window.dispatchEvent(new Event('online'));
  });
  const unreachableDeadline = Date.now() + 40_000;
  let unreachableBanner = '';
  while (Date.now() < unreachableDeadline) {
    unreachableBanner = await page.evaluate(() => document.querySelector('.offline-banner')?.textContent || '');
    if (unreachableBanner.includes('서버에 연결되지 않습니다')) break;
    await sleep(1000);
  }
  ok('서버에 닿지 않을 때 "서버에 연결되지 않습니다" 띠', unreachableBanner.includes('서버에 연결되지 않습니다'), unreachableBanner.slice(0, 60));
  await context.setOffline(false);
  const backDeadline = Date.now() + 40_000;
  let back = unreachableBanner;
  while (Date.now() < backDeadline) {
    back = await page.evaluate(() => document.querySelector('.offline-banner')?.textContent || '');
    if (!back) break;
    await sleep(1000);
  }
  ok('서버가 다시 닿으면 띠가 사라짐', !back, back.slice(0, 60));
} catch (err) {
  ok('점검 진행', false, err.message.split('\n')[0]);
  // 어디서 멈췄는지 보이게 화면 글과 토스트를 남긴다
  const dump = await page.evaluate(() => ({
    view: (document.getElementById('view')?.innerText || '').slice(0, 600),
    toast: document.getElementById('toast')?.textContent || '',
    url: location.href,
  })).catch(() => null);
  if (dump) console.log('화면:', JSON.stringify(dump, null, 1));
} finally {
  if (errors.length) console.log('콘솔 오류:\n  ' + errors.join('\n  '));
  if (failedUrls.size) console.log('받지 못한 주소 (오프라인 포함):\n  ' + [...failedUrls].map(([u, n]) => `${n}× ${u}`).join('\n  '));
  await browser.close();
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} 통과`);
process.exit(failed.length ? 1 : 0);
