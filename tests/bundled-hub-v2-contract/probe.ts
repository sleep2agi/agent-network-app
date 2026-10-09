// Pure packaged contract selection gate. Not HTTP, daemon or native UI acceptance.
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { buildAnetArgs } from '/candidate/src/create-node-validate.ts';
function check(name: string, ok: boolean) {
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}`);
  if (!ok) process.exit(1);
}
const manifest = JSON.parse(readFileSync('/candidate/package.json', 'utf8'));
check('exact candidate version', manifest.version === '0.9.0-preview.120');
check('product pin agrees', JSON.parse(readFileSync('/fixture/package.json', 'utf8')).dependencies['@sleep2agi/commhub-server'] === manifest.version);
const locked = JSON.parse(readFileSync('/fixture/package-lock.json', 'utf8')).packages['node_modules/@sleep2agi/commhub-server'];
check('product lock agrees', locked.version === manifest.version && locked.integrity === 'sha512-lluvIp478F3UiFXC8v4Dy8x1uvb/UhgXPWvRi5R2ii3lB4nYEqFn4KUZBO6mH7WRoEQBaGnqKhNFWLekTxpsOw==');
check('Rust expected Hub agrees', readFileSync('/fixture/local_hub.rs', 'utf8').includes(`const EXPECTED_HUB_VERSION: &str = "${manifest.version}";`));
// All four files independently matched this main ancestor via GitHub contents:
// edc68a4ca87bbb7ca4944093e8ff113a17078624 (not a full-tarball provenance claim).
const sourceHashes = {
  'create-node-validate.ts': '810da01a47fcb1a970e2311f3c8a0cbd5914ef14db2dc70a21dfe2aa5b96b2f8',
  'db.ts': 'ebe5c5955fbe76c775aaea8d2d304e39e8677de6dff18c9b6c58ef54b65b2a94',
  'tools.ts': '647b20aa780219217d9c51920e9ab3af6bede10c5929edd6a55e123db5c6172d',
  'server.ts': '575820c3a0bb44105ea687bf3c3524523d8b1ffa48ebe7d3c08551afd0e0c696',
};
for (const [file, digest] of Object.entries(sourceHashes)) {
  check(`main-ancestor contract source ${file}`, createHash('sha256').update(readFileSync(`/candidate/src/${file}`)).digest('hex') === digest);
}
const spec = { name: 'test894', runtime: 'opencode-cli' as const, model: 'stub/stub-model' };
check('V1 baseline accepted', buildAnetArgs(spec).includes('opencode-cli'));
let refusal = '';
try { buildAnetArgs({ ...spec, flags: { opencodeGeneration: 'v2' } }); }
catch (error) { refusal = (error as { code: string }).code; }
check('V2 missing explicit opt-in refused precisely', refusal === 'opencode_v2_requires_unsafe_opt_in');
const args = buildAnetArgs({ ...spec, flags: { opencodeGeneration: 'v2', opencodeUnsafeTools: true } });
check('V2 generation emitted', args[args.indexOf('--opencode-generation') + 1] === 'v2');
check('V2 exact argv includes valueless explicit opt-in', JSON.stringify(args) === JSON.stringify([
  'node', 'create', 'test894', '--runtime', 'opencode-cli', '--model', 'stub/stub-model',
  '--opencode-generation', 'v2', '--opencode-unsafe-tools',
]));
// Necessary source contract, not sufficient proof of runtime migration/ack behavior.
for (const file of ['db.ts', 'tools.ts', 'server.ts']) {
  check(`launch proof source contract in ${file}`, readFileSync(`/candidate/src/${file}`, 'utf8').includes('launch_verified_at'));
}
console.log('PASS: candidate selection gate only; require real HTTP/daemon/native UI gates next');
