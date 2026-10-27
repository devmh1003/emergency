// 서비스 워커가 앱 파일을 빠짐없이 저장하는지 검사한다. 빠지면 오프라인에서 그 화면이 깨진다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const webDir = fileURLToPath(new URL('../web/', import.meta.url));
const sw = readFileSync(join(webDir, 'sw.js'), 'utf8');
const listed = new Set([...sw.match(/const APP_FILES = \[([\s\S]*?)\];/)[1].matchAll(/'([^']+)'/g)].map((m) => m[1]));

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [relative(webDir, full).split('\\').join('/')];
  });
}

test('web 폴더의 모든 파일이 서비스 워커 저장 목록에 있다', () => {
  const missing = walk(webDir).filter((f) => f !== 'sw.js' && !listed.has(f));
  assert.deepEqual(missing, []);
});

test('저장 목록에 없는 파일이 들어 있지 않다', () => {
  const files = new Set(walk(webDir));
  const extra = [...listed].filter((f) => f !== './' && !files.has(f));
  assert.deepEqual(extra, []);
});
