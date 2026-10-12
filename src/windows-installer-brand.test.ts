import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { generate, layouts } from '../scripts/generate-windows-installer-brand.mjs';

const root = new URL('../', import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root));
const config = JSON.parse(read('src-tauri/tauri.conf.json').toString());
const nsis = config.bundle.windows.nsis;
assert.equal(nsis.installerIcon, 'icons/icon.ico');
assert.equal(nsis.uninstallerIcon, nsis.installerIcon);
assert(config.bundle.icon.includes(nsis.installerIcon), 'use the same CI-generated application icon');
assert.equal(nsis.headerImage, 'windows/brand/header.bmp');
assert.equal(nsis.uninstallerHeaderImage, nsis.headerImage);
assert.equal(nsis.sidebarImage, 'windows/brand/sidebar.bmp');
console.log('PASS installer/uninstaller/page brand configuration');

for (const [name, layout] of Object.entries(layouts)) {
  const committed = read(`src-tauri/windows/brand/${name}.bmp`);
  assert.deepEqual(committed, generate(read('assets/icon.png'), layout), `${name}: reproducible from the current brand`);
  assert.equal(committed.toString('ascii', 0, 2), 'BM');
  assert.equal(committed.readUInt32LE(2), committed.length);
  assert.equal(committed.readInt32LE(18), layout.width);
  assert.equal(committed.readInt32LE(22), layout.height);
  assert.equal(committed.readUInt16LE(28), 24);
  assert.equal(committed.readUInt32LE(30), 0);
  assert(new Set(committed.subarray(54)).size > 32, `${name}: not a blank bitmap`);
  console.log(`PASS ${name} real brand pixels / RGB24 / dimensions / deterministic bytes`);
}
console.log('3/3 installer branding groups passed');
