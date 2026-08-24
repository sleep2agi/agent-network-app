import { readFileSync } from 'node:fs';
import { canonicalJson, verifyDesktopUpdateManifest } from '../scripts/verify-desktop-update-manifest.mjs';

let passed = 0;
let total = 0;
const check = (name: string, condition: boolean) => {
  total++;
  if (!condition) throw new Error(`FAIL: ${name}`);
  passed++;
};

const endpoint = 'https://updates.example/latest.json';
const repo = 'sleep2agi/agent-network-app';
const manifest = {
  version: '0.2.33-1',
  notes: 'Signed update',
  platforms: {
    'windows-x86_64': { url: 'https://asset/win', signature: 'sig-win' },
    'darwin-aarch64': { signature: 'sig-mac', url: 'https://asset/mac' },
  },
};

const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8' },
});

const mock = (releaseManifest: unknown = manifest, releaseOverrides: Record<string, unknown> = {}) =>
  async (url: string | URL | Request) => {
    const href = String(url);
    if (href === endpoint) return response(manifest);
    if (href.includes('/releases/tags/desktop-v0.2.33-1')) {
      return response({ draft: false, assets: [{ name: 'latest.json', browser_download_url: 'https://asset/latest.json' }], ...releaseOverrides });
    }
    if (href === 'https://asset/latest.json') return response(releaseManifest);
    return response({ error: 'unexpected url' }, 404);
  };

check('canonical comparison ignores object key and whitespace formatting',
  canonicalJson({ z: 1, nested: { b: 2, a: 1 } }) === canonicalJson({ nested: { a: 1, b: 2 }, z: 1 }));

const ok = await verifyDesktopUpdateManifest({ fetchImpl: mock() as typeof fetch, endpoint, repository: repo });
check('matching manifests pass with the deployed version tag', ok.tag === 'desktop-v0.2.33-1');

let drift = '';
try {
  await verifyDesktopUpdateManifest({ fetchImpl: mock({ ...manifest, notes: 'different' }) as typeof fetch, endpoint, repository: repo });
} catch (error) { drift = String(error); }
check('a semantic field drift fails closed', drift.includes('deployed manifest differs'));

let draft = '';
try {
  await verifyDesktopUpdateManifest({ fetchImpl: mock(manifest, { draft: true }) as typeof fetch, endpoint, repository: repo });
} catch (error) { draft = String(error); }
check('a draft release is rejected', draft.includes('still a draft'));

let missing = '';
try {
  await verifyDesktopUpdateManifest({ fetchImpl: mock(manifest, { assets: [] }) as typeof fetch, endpoint, repository: repo });
} catch (error) { missing = String(error); }
check('a missing latest.json asset is rejected', missing.includes('latest.json asset missing'));

const workflow = readFileSync('.github/workflows/desktop-update-manifest-drift.yml', 'utf8').replace(/\r\n?/g, '\n');
check('guard can be dispatched immediately after deployment', /workflow_dispatch:/.test(workflow));
check('guard also runs on a fixed schedule', /schedule:[\s\S]*cron:/.test(workflow));
check('guard has read-only repository permissions', /permissions:\s*\n\s*contents: read/.test(workflow));
check('workflow runs the same verifier tested here', workflow.includes('node scripts/verify-desktop-update-manifest.mjs'));

console.log(`desktop update manifest drift: ${passed}/${total} checks passed`);
