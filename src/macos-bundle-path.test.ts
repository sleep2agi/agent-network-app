// Execute the actual workflow shell bodies with inert macOS command doubles.
// This checks paths/argv, not signing, notarization or native macOS upgrades.
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

if (process.platform === 'win32') {
  console.log('SKIP macOS workflow shell execution on Windows; covered by Linux/Docker');
  process.exit(0);
}

const steps = [
  ['desktop-tauri.yml', 'Stage artifacts'],
  ['release-macos.yml', 'Verify signed and notarized app'],
  ['release-macos.yml', 'Stage release assets'],
];
function script(file: string, name: string) {
  const source = readFileSync(new URL(`../.github/workflows/${file}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  const step = source.split(`      - name: ${name}\n`)[1]?.split('\n      - ')[0];
  const body = step?.split('        run: |\n')[1];
  assert.ok(body, `workflow step exists: ${file}/${name}`);
  return body.split('\n').filter(line => line.startsWith('          ')).map(line => line.slice(10)).join('\n');
}
function execute(body: string, display: string) {
  const cwd = mkdtempSync(join(tmpdir(), 'anet-macos-path-'));
  try {
    const bundle = 'src-tauri/target/release/bundle';
    const app = `${bundle}/macos/${display}.app`;
    mkdirSync(join(cwd, app), { recursive: true });
    mkdirSync(join(cwd, bundle, 'dmg'), { recursive: true });
    mkdirSync(join(cwd, 'bin'));
    writeFileSync(join(cwd, 'src-tauri/tauri.conf.json'), JSON.stringify({ productName: display, version: '0.2.226' }));
    writeFileSync(join(cwd, bundle, 'dmg/fixture.dmg'), 'fixture');
    const stub = (name: string, text: string) => writeFileSync(join(cwd, 'bin', name), `#!/bin/bash\nset -eu\n${text}\n`, { mode: 0o755 });
    stub('git', 'echo abcdef0');
    stub('ditto', 'test "$#" -eq 5\ntest -d "$4" || { echo "missing app input: $4" >&2; exit 41; }\nprintf "%s\\n" "$4" >> "$CALLS"\nprintf "archive fixture\\n" > "$5"');
    for (const tool of ['codesign', 'xcrun', 'spctl']) {
      stub(tool, 'app="${!#}"\ntest -d "$app"\nprintf "%s\\n" "$app" >> "$CALLS"\necho "Authority=Developer ID Application: wenxing hu (446BLT75JZ)"');
    }
    const result = spawnSync('bash', ['-euo', 'pipefail', '-c', body], {
      cwd, encoding: 'utf8', timeout: 10_000,
      env: { ...process.env, PATH: `${join(cwd, 'bin')}:${process.env.PATH}`, RUNNER_TEMP: cwd, GITHUB_OUTPUT: join(cwd, 'outputs'), CALLS: join(cwd, 'calls') },
    });
    assert.ifError(result.error);
    return {
      status: result.status, diagnostics: result.stdout + result.stderr,
      calls: result.status === 0 ? readFileSync(join(cwd, 'calls'), 'utf8').trim().split('\n') : [],
      files: result.status === 0 && body.includes('mkdir -p out') ? readdirSync(join(cwd, 'out')).sort() : [],
      app,
    };
  } finally { rmSync(cwd, { recursive: true, force: true }); }
}
let passed = 0;
for (const [file, name] of steps) {
  const body = script(file, name);
  for (const display of ['Agent Network', 'ANet']) {
    const result = execute(body, display);
    assert.equal(result.status, 0, `${file}/${name}/${display}: ${result.diagnostics}`);
    assert.deepEqual(result.calls, Array(name.startsWith('Verify') ? 4 : 1).fill(result.app));
    if (name === 'Stage artifacts') assert.deepEqual(result.files, ['AgentNetwork-tauri-arm64-mac.zip', 'fixture.dmg']);
    if (name === 'Stage release assets') assert.deepEqual(result.files, ['Agent.Network_0.2.226_aarch64.dmg', 'AgentNetwork_0.2.226_aarch64_abcdef0.app.zip', 'SHA256SUMS.txt']);
    console.log(`PASS ${file}/${name}/${display}`);
    passed++;
  }
  const mutant = body.replace('${product_name}.app', 'Agent Network.app');
  assert.notEqual(mutant, body, `mutation anchor: ${name}`);
  const red = execute(mutant, 'ANet');
  assert.notEqual(red.status, 0, `literal old-name mutation must fail: ${name}`);
  console.log(`MUTATION_RED ${file}/${name}: rc=${red.status} (missing app input)`);
  passed++;
}
console.log(`${passed}/9 checks passed`);
