import { readFileSync } from 'node:fs';

const workflow = readFileSync(new URL('../.github/workflows/android-build.yml', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const gate = workflow.slice(workflow.indexOf('- name: Require exact merged commit'), workflow.indexOf('- uses: actions/setup-node'));
const checks: Array<[string, boolean]> = [
  ['required commit input', /commit:\n\s+description:[^\n]+\n\s+required: true\n\s+type: string/.test(workflow)],
  ['checkout pins the input with full ancestry', workflow.includes('ref: ${{ inputs.commit }}\n          fetch-depth: 0')],
  ['input is passed as data', gate.includes('REQUESTED_COMMIT: ${{ inputs.commit }}') && !gate.slice(gate.indexOf('run: |')).includes('${{')],
  ['rejects non-SHA input and mismatched checkout', gate.includes('[[ "$REQUESTED_COMMIT" =~ ^[0-9a-f]{40}$ && "$resolved" == "$REQUESTED_COMMIT" ]]')],
  ['requires membership in main before dependency install', gate.includes('git fetch origin main\n          git merge-base --is-ancestor "$resolved" origin/main') && gate.includes('set -euo pipefail')],
  ['cannot shallow away the release ancestry', !gate.includes('--depth')],
];
let passed = 0;
for (const [name, ok] of checks) {
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}`);
  if (ok) passed++;
}
console.log(`${passed}/${checks.length} passed`);
process.exit(passed === checks.length ? 0 : 1);
