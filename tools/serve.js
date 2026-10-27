// 로컬 확인용 정적 서버: node tools/serve.js → http://localhost:5500
// EMULATOR=1 이면 config.js 대신 Firebase 에뮬레이터용 설정을 내보낸다 (실제 프로젝트 없이 화면 확인).
//   npx firebase-tools emulators:start --only auth,firestore --project demo-family
//   EMULATOR=1 node tools/serve.js
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../web/', import.meta.url));
const port = Number(process.env.PORT) || 5500;
const types = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.json': 'application/json',
};

const emulatorConfig = `self.FAMILY_CONFIG = ${JSON.stringify({
  appName: '우리 가족 비상연락 (에뮬레이터)',
  firebase: { apiKey: 'demo-key', authDomain: 'demo-family.firebaseapp.com', projectId: 'demo-family', appId: 'demo' },
  vapidKey: '',
  workerUrl: '',
  useEmulators: true,
})};`;

createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (process.env.EMULATOR && path === '/js/config.js') {
    res.writeHead(200, { 'Content-Type': types['.js'], 'Cache-Control': 'no-store' }).end(emulatorConfig);
    return;
  }
  const file = normalize(join(root, path.endsWith('/') ? `${path}index.html` : path));
  if (!file.startsWith(root)) { res.writeHead(403).end(); return; }
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': types[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' }).end(body);
  } catch {
    res.writeHead(404).end('not found');
  }
}).listen(port, () => console.log(`http://localhost:${port}`));
