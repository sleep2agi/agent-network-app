import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import {
  diffAgainstRemote,
  latestAliasName,
  mirrorBaseUrl,
  planMirror,
  rewriteManifestForMirror,
  selectNewestDesktopRelease,
  sha256sums,
} from '../scripts/modelscope-mirror.mjs';

let passed = 0;
const check = (name: string, condition: boolean) => {
  if (!condition) throw new Error(`FAIL: ${name}`);
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

const sha = (seed: string) => createHash('sha256').update(seed).digest('hex');
const base = mirrorBaseUrl('Org/releases');
const asset = (id: number, name: string, extra: Record<string, unknown> = {}) => ({
  id,
  name,
  state: 'uploaded',
  size: name.length * 1000,
  digest: `sha256:${sha(name)}`,
  url: `https://api.github.com/repos/o/r/releases/assets/${id}`,
  browser_download_url: `https://github.com/o/r/releases/download/desktop-v1.2.3/${name}`,
  ...extra,
});
const release = {
  tag_name: 'desktop-v1.2.3',
  draft: false,
  assets: [
    asset(1, 'Agent.Network_1.2.3_aarch64.app.tar.gz'),
    asset(2, 'Agent.Network_1.2.3_aarch64.app.tar.gz.sig'),
    asset(3, 'Agent.Network_1.2.3_aarch64.dmg'),
    asset(4, 'Agent.Network_1.2.3_x64-setup.exe'),
    asset(5, 'Agent.Network_1.2.3_x64-setup.exe.sig'),
    asset(6, 'Agent.Network_1.2.3_x64_en-US.msi'),
    asset(7, 'Agent.Network_1.2.3_x64_en-US.msi.sig'),
    asset(8, 'Agent.Network_1.2.3_android-universal.apk'),
    asset(9, 'latest.json'),
  ],
};
// tauri-action writes asset API URLs; fallback.json uses browser URLs. Mix both.
const manifest = {
  version: '1.2.3',
  notes: 'n',
  pub_date: '2026-01-01T00:00:00Z',
  platforms: {
    'darwin-aarch64': { url: release.assets[0].url, signature: 'SIG-MAC' },
    'windows-x86_64': { url: release.assets[3].browser_download_url, signature: 'SIG-WIN' },
    'windows-x86_64-msi': { url: release.assets[5].url, signature: 'SIG-MSI' },
  },
};

// --- updater manifest rewrite ---------------------------------------------------------
const rewritten = rewriteManifestForMirror(manifest, release, { version: '1.2.3', baseUrl: base });
check('mac platform points at the mirrored versioned file',
  rewritten.platforms['darwin-aarch64'].url === `${base}/desktop/1.2.3/Agent.Network_1.2.3_aarch64.app.tar.gz`);
check('browser-URL form is mapped too',
  rewritten.platforms['windows-x86_64'].url === `${base}/desktop/1.2.3/Agent.Network_1.2.3_x64-setup.exe`);
check('signatures are carried over byte for byte',
  Object.entries(manifest.platforms).every(([k, v]) => rewritten.platforms[k].signature === v.signature));
check('only url changes (version/notes/pub_date kept)',
  rewritten.version === manifest.version && rewritten.notes === manifest.notes && rewritten.pub_date === manifest.pub_date);
check('no platform URL is left pointing at GitHub',
  Object.values(rewritten.platforms).every((p: any) => !p.url.includes('github')));
check('input manifest is not mutated', manifest.platforms['darwin-aarch64'].url.startsWith('https://api.github.com/'));
check('unmapped URL fails closed', throws(() => rewriteManifestForMirror(
  { ...manifest, platforms: { x: { url: 'https://elsewhere/x', signature: 's' } } }, release, { version: '1.2.3', baseUrl: base }), /maps to 0/));
check('version mismatch fails closed',
  throws(() => rewriteManifestForMirror({ ...manifest, version: '1.2.2' }, release, { version: '1.2.3', baseUrl: base }), /does not match/));
check('missing signature fails closed', throws(() => rewriteManifestForMirror(
  { ...manifest, platforms: { x: { url: release.assets[0].url, signature: '' } } }, release, { version: '1.2.3', baseUrl: base }), /signature/));

// --- SHA256SUMS -------------------------------------------------------------------------
check('SHA256SUMS is sha256sum format, sorted, basenames only',
  sha256sums([['b.dmg', 'bb'], ['a.exe', 'aa']]) === 'aa  a.exe\nbb  b.dmg\n');

// --- latest aliases ---------------------------------------------------------------------
check('installer alias drops the version', latestAliasName('Agent.Network_1.2.3_aarch64.dmg', '1.2.3') === 'Agent.Network_aarch64.dmg');
check('updater bundles get no alias', latestAliasName('Agent.Network_1.2.3_aarch64.app.tar.gz', '1.2.3') === null);
check('another version\'s file gets no alias', latestAliasName('Agent.Network_1.2.2_aarch64.dmg', '1.2.3') === null);

// --- plan -------------------------------------------------------------------------------
const planNewest = planMirror({ release, manifest, isNewest: true, baseUrl: base });
const planOld = planMirror({ release, manifest, isNewest: false, baseUrl: base });
check('every release asset is planned under desktop/<ver>/',
  release.assets.every((a) => planNewest.get(`desktop/1.2.3/${a.name}`)?.sha256 === sha(a.name)));
check('SHA256SUMS lists every asset', planNewest.get('desktop/1.2.3/SHA256SUMS').source.bytes.toString().trim().split('\n').length === release.assets.length);
check('newest release writes desktop/latest/ (4 installers + latest.json + VERSION + SHA256SUMS)',
  [...planNewest.keys()].filter((p) => p.startsWith('desktop/latest/')).length === 7);
check('latest VERSION names the release', planNewest.get('desktop/latest/VERSION').source.bytes.toString() === '1.2.3\n');
check('re-syncing an older release never touches desktop/latest/',
  [...planOld.keys()].every((p) => !p.startsWith('desktop/latest/')));
check('latest alias has the same bytes (sha) as the versioned installer',
  planNewest.get('desktop/latest/Agent.Network_x64-setup.exe').sha256 === planNewest.get('desktop/1.2.3/Agent.Network_1.2.3_x64-setup.exe').sha256);
check('draft is refused', throws(() => planMirror({ release: { ...release, draft: true }, manifest, isNewest: false, baseUrl: base }), /draft/));
check('asset still uploading is refused', throws(() => planMirror({
  release: { ...release, assets: [...release.assets.slice(0, 8), asset(10, 'x', { state: 'starter' })] }, manifest, isNewest: false, baseUrl: base }), /uploading/));
check('asset without a GitHub digest is refused', throws(() => planMirror({
  release: { ...release, assets: [asset(11, 'y', { digest: null })] }, manifest, isNewest: false, baseUrl: base }), /digest/));

// --- idempotence --------------------------------------------------------------------------
const inSync = Object.fromEntries([...planNewest].map(([p, e]) => [p, e.sha256]));
check('in-sync mirror: nothing to upload', diffAgainstRemote(planNewest, inSync).length === 0);
check('one changed file: exactly that file is re-uploaded',
  JSON.stringify(diffAgainstRemote(planNewest, { ...inSync, 'desktop/1.2.3/SHA256SUMS': 'stale' })) === '["desktop/1.2.3/SHA256SUMS"]');
check('missing remote file is uploaded', diffAgainstRemote(planNewest, {}).length === planNewest.size);

// --- newest selection (must match the anet.sh endpoint) ------------------------------------
const rel = (tag: string, extra: Record<string, unknown> = {}) => ({ tag_name: tag, draft: false, assets: [{ name: 'latest.json' }], ...extra });
check('newest = highest semver, not list order',
  selectNewestDesktopRelease([rel('desktop-v0.2.9'), rel('desktop-v0.2.10'), rel('mobile-v9.9.9')])?.tag_name === 'desktop-v0.2.10');
check('drafts and releases without latest.json are ignored',
  selectNewestDesktopRelease([rel('desktop-v0.3.0', { draft: true }), rel('desktop-v0.2.99', { assets: [] }), rel('desktop-v0.2.98')])?.tag_name === 'desktop-v0.2.98');

// --- workflow wiring --------------------------------------------------------------------------
const workflow = readFileSync(new URL('../.github/workflows/modelscope-mirror.yml', import.meta.url), 'utf8');
check('workflow runs on release published, schedule and manual dispatch with a tag input',
  /release:\s*\n\s*types: \[published\]/.test(workflow) && workflow.includes('schedule:') && /workflow_dispatch:[\s\S]*tag:/.test(workflow));
check('every `uses:` is pinned to a full commit SHA', [...workflow.matchAll(/uses:\s*(\S+)/g)].every((m) => /@[0-9a-f]{40}$/.test(m[1])));
check('ModelScope SDK version is pinned', /modelscope==\d+\.\d+\.\d+/.test(workflow));
check('token comes from the secret via env only', workflow.includes('MODELSCOPE_API_TOKEN: ${{ secrets.MODELSCOPE_API_TOKEN }}')
  && !/echo[^\n]*MODELSCOPE_API_TOKEN/.test(workflow));

console.log(`\n${passed} passed`);
