// The desktop release workflow must build the Ubuntu 24.04 amd64 .deb with the
// production updater endpoints and upload it on the same draft as macOS and
// Windows. The test-only overlay in tests/linux-deb-package stays off this path.
import { readFileSync } from 'node:fs';
import { LATEST_ALIAS_SUFFIXES } from '../scripts/modelscope-mirror.mjs';
import { assertDesktopReleaseDraft, releaseAssetNames } from '../scripts/verify-desktop-release-draft.mjs';

let passed = 0;
const check = (name: string, ok: boolean) => {
  if (!ok) throw new Error(`FAIL: ${name}`);
  passed++;
  console.log(`PASS: ${name}`);
};
const throws = (fn: () => unknown, pattern: RegExp) => {
  try {
    fn();
  } catch (error: any) {
    return pattern.test(error.message);
  }
  return false;
};

const workflow = readFileSync(new URL('../.github/workflows/release-desktop-auto-update.yml', import.meta.url), 'utf8');
const config = JSON.parse(readFileSync(new URL('../src-tauri/tauri.conf.json', import.meta.url), 'utf8'));
const secrets = [...workflow.matchAll(/secrets\.([A-Z0-9_]+)/g)].map((match) => match[1]);
const secretSet = [...new Set(secrets)].sort();

check('release matrix builds the deb on Ubuntu 24.04',
  /platform: ubuntu-24\.04\n\s+args: --bundles deb/.test(workflow));
check('release build does not apply the test updater overlay or --no-sign',
  !workflow.includes('tauri.test.conf.json') && !workflow.includes('--no-sign'));
check('linux smoke runs the ELF, not the Windows exe',
  workflow.includes("binary='src-tauri/target/release/agent-network-desktop'")
  && workflow.includes('ANET_ISOLATED_KEYRING_TEST=1'));
check('deb is inside the 55 MiB ceiling', workflow.includes("-name '*.deb'"));
check('publish defaults to creating the draft and can be turned off',
  /publish:[\s\S]*default: true[\s\S]*type: boolean/.test(workflow)
  && workflow.includes('inputs.publish == true')
  && workflow.includes('inputs.publish == false')
  && workflow.includes('Build signed bundles without uploading a release'));
check('draft verification runs only when publishing',
  workflow.includes('verify-desktop-release-draft.mjs') && workflow.includes('needs: build-release'));
check('linux reuses the existing updater key and adds no secret',
  secretSet.join() === [
    'APPLE_API_ISSUER',
    'APPLE_API_KEY',
    'APPLE_API_KEY_BASE64',
    'APPLE_CERTIFICATE',
    'APPLE_CERTIFICATE_PASSWORD',
    'TAURI_SIGNING_PRIVATE_KEY',
    'TAURI_SIGNING_PRIVATE_KEY_PASSWORD',
  ].join()
  && workflow.includes('TAURI_SIGNING_PRIVATE_KEY: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY }}'));
check('production updater endpoints stay in tauri.conf.json',
  JSON.stringify(config.plugins.updater.endpoints) === JSON.stringify([
    'https://anet.sh/desktop/update/latest.json',
    'https://modelscope.cn/datasets/SmartFlowAI/agent-network-releases/resolve/master/desktop/latest/latest.json',
  ]) && config.bundle.createUpdaterArtifacts === true);
check('mirror gives the deb a stable download alias', LATEST_ALIAS_SUFFIXES.includes('amd64.deb'));

const product = 'ANet';
const version = '1.2.3';
const sha = 'ab'.repeat(32);
const asset = (name: string, id: number) => ({
  name,
  state: 'uploaded',
  digest: `sha256:${sha}`,
  apiUrl: `https://api.github.com/repos/o/r/releases/assets/${id}`,
  url: `https://github.com/o/r/releases/download/desktop-v${version}/${name}`,
});
const names = releaseAssetNames(product, version);
const release = {
  isDraft: true,
  targetCommitish: 'a'.repeat(40),
  assets: names.map((name, index) => asset(name, index + 1)),
};
const deb = release.assets[0];
const exe = release.assets.find((item) => item.name.endsWith('_x64-setup.exe'));
const mac = release.assets.find((item) => item.name.endsWith('_aarch64.app.tar.gz'));
const manifest = {
  version,
  platforms: {
    'darwin-aarch64': { url: mac.apiUrl, signature: 'SIG-MAC' },
    'windows-x86_64': { url: exe.apiUrl, signature: 'SIG-WIN' },
    'linux-x86_64': { url: deb.apiUrl, signature: 'SIG-LINUX' },
    'linux-x86_64-deb': { url: deb.url, signature: 'SIG-LINUX' },
  },
};
const ok = assertDesktopReleaseDraft({
  product, version, release, manifest, expectedCommit: 'a'.repeat(40),
});
check('draft check returns the deb checksum', ok.debSha256 === sha && ok.sigSha256 === sha);
check('missing linux platform fails closed', throws(() => assertDesktopReleaseDraft({
  product, version, release, manifest: { ...manifest, platforms: { ...manifest.platforms, 'linux-x86_64-deb': undefined } }, expectedCommit: 'a'.repeat(40),
}), /linux-x86_64-deb/));
check('linux entry pointing at another file fails closed', throws(() => assertDesktopReleaseDraft({
  product, version, release,
  manifest: { ...manifest, platforms: { ...manifest.platforms, 'linux-x86_64': { url: exe.apiUrl, signature: 'SIG-LINUX' } } },
  expectedCommit: 'a'.repeat(40),
}), /does not point at/));
check('published release is refused', throws(() => assertDesktopReleaseDraft({
  product, version, release: { ...release, isDraft: false }, manifest, expectedCommit: 'a'.repeat(40),
}), /not a draft/));
check('deb without a digest is refused', throws(() => assertDesktopReleaseDraft({
  product, version,
  release: { ...release, assets: release.assets.map((item) => item.name.endsWith('.deb') && !item.name.endsWith('.sig') ? { ...item, digest: null } : item) },
  manifest, expectedCommit: 'a'.repeat(40),
}), /sha256 digest/));

console.log(`\n${passed} passed`);
