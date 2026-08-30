import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const run = (extraEnv: NodeJS.ProcessEnv = {}) =>
  execFileSync('node', ['scripts/resolve-previous-desktop-hub-version.mjs'], {
    encoding: 'utf8',
    env: { ...process.env, ...extraEnv },
  }).trim();

const current = JSON.parse(readFileSync('package.json', 'utf8')).version;
const resolved = run();
if (current === '0.2.42' && resolved !== '0.9.0-preview.31') {
  throw new Error(`expected previous factory Hub 0.9.0-preview.31 for app ${current}, got ${resolved}`);
}
if (!/^0\.\d+\.\d+-preview\.\d+$/.test(resolved)) {
  throw new Error(`resolver returned a non-preview Hub pin: ${resolved}`);
}
console.log(`PASS: resolver against this repo -> ${resolved} (app ${current})`);

const seed = readFileSync('scripts/seed-previous-local-hub.mjs', 'utf8');
if (seed.includes("previousVersion = '0.9.0-preview.28'")) {
  throw new Error('seed still hardcodes 0.9.0-preview.28');
}
if (!seed.includes('ANET_SMOKE_PREVIOUS_HUB_VERSION')) {
  throw new Error('seed does not require ANET_SMOKE_PREVIOUS_HUB_VERSION');
}
console.log('PASS: seed requires ANET_SMOKE_PREVIOUS_HUB_VERSION and has no .28 default');
