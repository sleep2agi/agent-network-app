import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
const path = 'src-tauri/windows/vendor/main.tauri-2.11.2.wxs';
const original = readFileSync(path, 'utf8');
try {
  const mutated = original.replace(/(<RegistrySearch Id="PrevInstallDir[^\n]+)\$\(var.InstallIdentity\)/g, '$1{{product_name}}');
  assert.notEqual(mutated, original);
  writeFileSync(path, mutated);
  const red = spawnSync(process.execPath, ['src/wix-install-identity.test.ts'], { encoding: 'utf8' });
  assert.equal(red.status, 1, red.stderr);
  assert.match(red.stderr, /must search the legacy install key/);
  console.log('MUTATION_RED: display-name registry search is rejected (rc=1)');
} finally { writeFileSync(path, original); }
