import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const config = 'src-tauri/tauri.conf.json';
const original = readFileSync(config, 'utf8');
const run = () => spawnSync(process.execPath,
  ['--experimental-strip-types', 'src/app-display-name.test.ts'], { encoding: 'utf8' });
const green = run();
process.stdout.write(green.stdout);
assert.equal(green.status, 0, green.stderr);
try {
  const mutated = JSON.parse(original);
  delete mutated.bundle.windows.wix.upgradeCode;
  writeFileSync(config, JSON.stringify(mutated));
  const red = run();
  assert.equal(red.status, 1, red.stderr);
  assert.match(red.stdout, /FAIL MSI upgrade identity matches published installers/);
  console.log('MUTATION_RED: removing the explicit UpgradeCode fails its assertion');
} finally {
  writeFileSync(config, original);
}
