// Real Git checkout with Windows-style autocrlf, entirely in a disposable repo.
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
const tmp = mkdtempSync(join(tmpdir(), 'wix-checkout-'));
const path = 'src-tauri/windows/vendor/main.tauri-2.11.2.wxs';
const original = readFileSync(path);
const attributes = readFileSync('.gitattributes', 'utf8');
const git = (args, cwd = tmp) => {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
};
try {
  for (const mutated of [false, true]) {
    const source = join(tmp, mutated ? 'mutant' : 'source');
    const checkout = `${source}-checkout`;
    mkdirSync(join(source, dirname(path)), { recursive: true });
    writeFileSync(join(source, path), original);
    writeFileSync(join(source, '.gitattributes'), mutated
      ? attributes.replace('src-tauri/windows/vendor/*.wxs -text\n', '') : attributes);
    git(['init', '-q'], source);
    git(['-c', 'core.autocrlf=false', 'add', '.'], source);
    git(['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'fixture'], source);
    git(['clone', '-q', '-c', 'core.autocrlf=true', source, checkout]);
    const bytes = readFileSync(join(checkout, path));
    if (mutated) {
      assert.notDeepEqual(bytes, original, 'removing the WXS attribute must break exact-byte equality');
      assert.ok(bytes.includes(Buffer.from('\r\n')), 'mutant fails because Git converted line endings');
      console.log('MUTATION_RED: removing WXS attribute changes actual checkout bytes');
    } else {
      assert.deepEqual(bytes, original, 'autocrlf checkout must preserve upstream bytes');
      console.log('PASS Windows-style Git checkout preserves exact WiX bytes');
    }
  }
} finally { rmSync(tmp, { recursive: true, force: true }); }
