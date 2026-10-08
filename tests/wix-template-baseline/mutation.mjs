// Mutate only the container copy; verify an assertion failure, not a crash.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
const path = 'src-tauri/windows/vendor/main.tauri-2.11.2.wxs';
const original = readFileSync(path);
try {
  writeFileSync(path, Buffer.concat([original, Buffer.from('\n<!-- drift -->\n')]));
  const red = spawnSync(process.execPath, ['src/wix-template-baseline.test.ts'], { encoding: 'utf8' });
  assert.equal(red.status, 1, red.stderr);
  assert.match(red.stdout, /FAIL WiX template bytes match upstream SHA256/);
  console.log('MUTATION_RED: template drift fails the byte-equality assertion (rc=1)');
} finally { writeFileSync(path, original); }
