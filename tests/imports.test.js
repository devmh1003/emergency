// 브라우저에서는 없는 이름을 import하면 앱 전체가 열리지 않는다. 로컬 모듈끼리 import/export가 맞는지 검사한다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const jsDir = fileURLToPath(new URL('../web/js/', import.meta.url));

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : full.endsWith('.js') ? [full] : [];
  });
}

function exportsOf(src) {
  const names = new Set();
  for (const m of src.matchAll(/export\s+(?:async\s+)?(?:function|const|let|class)\s+([A-Za-z_$][\w$]*)/g)) names.add(m[1]);
  for (const m of src.matchAll(/export\s*\{([^}]*)\}/g)) {
    for (const part of m[1].split(',')) {
      const name = part.trim().split(/\s+as\s+/).pop();
      if (name) names.add(name);
    }
  }
  return names;
}

test('로컬 모듈의 import 이름이 모두 실제로 export되어 있다', () => {
  const files = walk(jsDir);
  const problems = [];
  for (const file of files) {
    const src = readFileSync(file, 'utf8');
    for (const m of src.matchAll(/import\s*\{([^}]*)\}\s*from\s*'(\.[^']+)'/g)) {
      const target = resolve(dirname(file), m[2]);
      let targetSrc;
      try {
        targetSrc = readFileSync(target, 'utf8');
      } catch {
        problems.push(`${relative(jsDir, file)}: 없는 파일 ${m[2]}`);
        continue;
      }
      const exported = exportsOf(targetSrc);
      for (const part of m[1].split(',')) {
        const name = part.trim().split(/\s+as\s+/)[0];
        if (name && !exported.has(name)) problems.push(`${relative(jsDir, file)}: ${m[2]} 에 ${name} 없음`);
      }
    }
  }
  assert.deepEqual(problems, []);
});

test('사이트 스크립트에 문법 오류가 없다 (하나라도 있으면 화면이 통째로 안 뜬다)', () => {
  const swPath = fileURLToPath(new URL('../web/sw.js', import.meta.url));
  for (const file of [...walk(jsDir), swPath]) {
    try {
      execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
    } catch (err) {
      assert.fail(`${relative(jsDir, file)}: ${String(err.stderr).split('\n').slice(0, 5).join('\n')}`);
    }
  }
});
