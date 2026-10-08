// Manual Docker-only mutation; the underlying unit is covered by npm test CI.
import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
assert.ok(existsSync('/.dockerenv'), 'run inside the isolated Docker fixture');
const path = 'src-tauri/windows/vendor/installer.tauri-2.11.2.nsi';
const original = readFileSync(path, 'utf8');
const anchor = '!define INSTALLIDENTITY "Agent Network"';
assert.ok(original.includes(anchor), 'mutation anchor exists');
try {
  writeFileSync(path, original.replace(anchor, '!define INSTALLIDENTITY "{{product_name}}"'));
  const r = spawnSync(process.execPath, ['--experimental-strip-types', 'src/nsis-install-identity.test.ts'], { encoding: 'utf8' });
  assert.equal(r.status, 1, r.stderr);
  assert.match(r.stdout, /FAIL ANet: uninstall key keeps original identity/);
  assert.match(r.stdout, /FAIL ANet: custom directory lookup keeps original identity/);
  console.log('MUTATION_RED: display-derived identity; assertion failures, child rc=1');
} finally {
  writeFileSync(path, original);
}
