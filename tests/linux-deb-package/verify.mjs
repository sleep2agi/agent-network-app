// Package inspection, NOT GUI / native IPC / installation acceptance.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const sha = process.env.TEST_DEB_SOURCE_COMMIT;
assert.match(sha || '', /^[a-f0-9]{40}$/, 'exact source SHA required');
console.log(`TEST ONLY linux-deb source=${sha}; not approved for distribution`);
const config = JSON.parse(readFileSync('src-tauri/tauri.conf.json', 'utf8'));
const overlay = JSON.parse(readFileSync('tests/linux-deb-package/tauri.test.conf.json', 'utf8'));
assert.equal(overlay.bundle.createUpdaterArtifacts, false);
assert.deepEqual(overlay.plugins.updater.endpoints, []);
assert.ok(statSync('dist/index.html').size > 0, 'real frontend export required');
const bundleDir = 'src-tauri/target/release/bundle/deb';
const packages = readdirSync(bundleDir).filter(n => n.endsWith('.deb'));
assert.equal(packages.length, 1, 'exactly one deb must exist');
const deb = join(bundleDir, packages[0]);
const field = name => execFileSync('dpkg-deb', ['--field', deb, name], { encoding: 'utf8' }).trim();
assert.equal(field('Architecture'), process.env.TEST_DEB_EXPECT_ARCH || 'amd64', 'deb architecture matches expected');
assert.equal(field('Version'), config.version, 'deb version matches source');
const dependencies = field('Depends');
assert.match(dependencies, /libwebkit2gtk-4\.1-0/, 'WebKit runtime dependency declared');
assert.match(dependencies, /libgtk-3-0/, 'GTK runtime dependency declared');
console.log(`PASS metadata package=${field('Package')} version=${field('Version')} architecture=${field('Architecture')} depends=${dependencies}`);

const root = mkdtempSync(join(tmpdir(), 'anet-test-deb-'));
function files(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? files(path) : [path];
  });
}
try {
  execFileSync('dpkg-deb', ['--extract', deb, root]);
  const entries = files(root);
  const main = join(root, 'usr/bin/agent-network-desktop');
  const sidecar = join(root, 'usr/bin/commhub');
  for (const binary of [main, sidecar]) {
    assert.ok(statSync(binary).mode & 0o111, `${binary} executable`);
    assert.equal(readFileSync(binary).subarray(0, 4).toString('hex'), '7f454c46', `${binary} real ELF`);
  }
  const manifests = entries.filter(p => p.endsWith('/commhub-manifest.json'));
  assert.equal(manifests.length, 1, 'exactly one sidecar manifest packaged');
  const manifest = JSON.parse(readFileSync(manifests[0], 'utf8'));
  assert.equal(manifest.target, 'x86_64-unknown-linux-gnu');
  const pin = JSON.parse(readFileSync('local-hub-sidecar/package.json', 'utf8')).dependencies['@sleep2agi/commhub-server'];
  assert.equal(manifest.commhubVersion, pin, 'sidecar version matches locked source');
  assert.equal(createHash('sha256').update(readFileSync(sidecar)).digest('hex'), manifest.preBundleSha256, 'packaged unsigned sidecar matches manifest');
  const desktops = entries.filter(p => p.endsWith('.desktop'));
  assert.equal(desktops.length, 1, 'one desktop launcher packaged');
  assert.match(readFileSync(desktops[0], 'utf8'), /^Exec=agent-network-desktop(?:\s|$)/m);
  assert.ok(entries.some(p => /\/icons\/.*\.png$/.test(p)), 'desktop icon packaged');
  const linkage = execFileSync('ldd', [main], { encoding: 'utf8' });
  assert.ok(!linkage.includes('not found'), 'native libraries resolve in build environment');
  console.log(`PASS ELF main/sidecar, sidecar SHA/version, desktop entry/icon, build-environment linkage`);
  console.log(`PASS deb sha256=${createHash('sha256').update(readFileSync(deb)).digest('hex')} bytes=${statSync(deb).size}`);
  console.log('RESULT: PASS (package inspection only; installation, GUI, IPC and release remain unverified)');
} finally {
  rmSync(root, { recursive: true, force: true });
}
