import { readFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';

const workflow = readFileSync(new URL('../.github/workflows/modelscope-android-publish.yml', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
let passed = 0;
let total = 0;
const ck = (name: string, ok: boolean) => {
  total++;
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}`);
  if (ok) passed++;
};
const source = workflow.slice(workflow.indexOf('- name: Check the source run'), workflow.indexOf('- uses: actions/checkout'));
ck('required exact commit input', /commit:\n\s+description:[^\n]+\n\s+required: true\n\s+type: string/.test(workflow));
ck('source run is verified before checkout', source.includes('if [ "$sha" != "$REQUESTED_COMMIT" ]; then') && source.includes('exit 1; fi'));
ck('checkout uses requested SHA and full history', workflow.includes('ref: ${{ inputs.commit }}\n          fetch-depth: 0'));
const gate = workflow.slice(workflow.indexOf('- name: Require exact merged commit'), workflow.indexOf('- name: Download the APK artifact'));
ck('gate precedes artifact download and upload', gate.includes('REQUESTED_COMMIT: ${{ inputs.commit }}'));
const script = gate.split('run: |\n')[1]?.split('\n').map(line => line.replace(/^          /, '')).join('\n');
if (!script) throw new Error('missing executable gate');
// Publication runs on Ubuntu. Windows unit CI checks the workflow contract;
// execute its POSIX shell acceptance on Linux/Docker, not a Windows WSL setup.
if (process.platform === 'win32') {
  console.log(`${passed}/${total} passed (shell behavior is Linux/Docker-only)`);
  process.exit(passed === total ? 0 : 1);
}

// Execute the workflow's actual shell gate against disposable repositories.
const root = mkdtempSync(join(tmpdir(), 'android-publish-source-'));
const origin = join(root, 'origin');
const checkout = join(root, 'checkout');
const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
git(root, 'init', '-q', '-b', 'main', origin);
git(origin, 'config', 'user.name', 'Fixture');
git(origin, 'config', 'user.email', 'fixture@example.invalid');
git(origin, 'commit', '-q', '--allow-empty', '-m', 'release');
const release = git(origin, 'rev-parse', 'HEAD');
git(root, 'clone', '-q', `file://${origin}`, checkout);
const run = (requested: string, command = script) => spawnSync('bash', ['-c', command], {
  cwd: checkout, env: { ...process.env, REQUESTED_COMMIT: requested }, encoding: 'utf8', timeout: 10_000,
}).status === 0;
ck('accept current main', run(release));
ck('reject short SHA', !run(release.slice(0, 8)));
git(origin, 'commit', '-q', '--allow-empty', '-m', 'later-main');
const newer = git(origin, 'rev-parse', 'HEAD');
ck('accept exact release ancestor after main advances', run(release));
ck('reject mismatched checkout', !run(newer));
git(checkout, 'config', 'user.name', 'Fixture');
git(checkout, 'config', 'user.email', 'fixture@example.invalid');
git(checkout, 'commit', '-q', '--allow-empty', '-m', 'unmerged');
const unmerged = git(checkout, 'rev-parse', 'HEAD');
ck('reject unmerged commit', !run(unmerged));
const mutant = script.replace('git merge-base --is-ancestor "$resolved" origin/main', ':');
ck('ancestry-removal mutant admits unmerged commit (previous assertion catches it)', mutant !== script && run(unmerged, mutant));
console.log(`${passed}/${total} passed`);
process.exit(passed === total ? 0 : 1);
