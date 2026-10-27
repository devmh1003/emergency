// 화면에 쓰는 t('한국어') 문장마다 영어 번역이 있는지, 자리표시({name})가 같은지 검사한다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const jsDir = fileURLToPath(new URL('../web/js/', import.meta.url));

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : full.endsWith('.js') ? [full] : [];
  });
}

async function dictionary() {
  const all = {};
  for (const f of readdirSync(join(jsDir, 'i18n'))) {
    Object.assign(all, (await import(new URL(`../web/js/i18n/${f}`, import.meta.url))).EN);
  }
  return all;
}

// t('...') 안의 작은따옴표 문자열 (\' 이스케이프 포함)
const KEY_RE = /\bt\('((?:[^'\\]|\\.)*)'/g;
const unescape = (s) => s.replace(/\\(.)/g, '$1');
const placeholders = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');

test('모든 t() 문장에 영어 번역이 있고 자리표시가 같다', async () => {
  const en = await dictionary();
  const missing = new Set();
  const mismatched = [];
  for (const file of walk(jsDir).filter((f) => !f.includes(`${sep}i18n${sep}`) && !f.endsWith(`${sep}i18n.js`))) {
    for (const m of readFileSync(file, 'utf8').matchAll(KEY_RE)) {
      const key = unescape(m[1]);
      if (!/[가-힣]/.test(key)) continue;
      if (!(key in en)) missing.add(`${file.slice(jsDir.length)}: ${key}`);
      else if (placeholders(key) !== placeholders(en[key])) mismatched.push(`${key} → ${en[key]}`);
    }
  }
  assert.deepEqual([...missing], []);
  assert.deepEqual(mismatched, []);
});
