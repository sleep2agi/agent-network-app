import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const workflow = readFileSync(new URL('../.github/workflows/modelscope-android-publish.yml', import.meta.url), 'utf8');
const block = workflow.slice(workflow.indexOf('- name: Download the APK artifact'), workflow.indexOf('- name: Verify dispatched build source'));
const code = block.split("node --input-type=module <<'NODE'\n")[1].split('\n          NODE')[0].replace(/^          /gm, '');
const artifact = { id: 123, name: 'agent-network-android-apk', expired: false, workflow_run: { id: 456 }, digest: `sha256:${'a'.repeat(64)}` };

test('execute actual workflow artifact selector: exact run, unique live artifact and digest', () => {
  const root = mkdtempSync(join(tmpdir(), 'android-artifact-test-'));
  try {
    const cases = [
      [{ total_count: 1, artifacts: [artifact] }, true],
      [{ total_count: 2, artifacts: [artifact, artifact] }, false],
      [{ total_count: 1, artifacts: [{ ...artifact, expired: true }] }, false],
      [{ total_count: 1, artifacts: [{ ...artifact, workflow_run: { id: 999 } }] }, false],
      [{ total_count: 1, artifacts: [{ ...artifact, digest: null }] }, false],
      [{ total_count: 101, artifacts: [artifact] }, false],
    ];
    for (const [listing, valid] of cases) {
      writeFileSync(join(root, 'android-artifacts.json'), JSON.stringify(listing));
      const result = spawnSync(process.execPath, ['--input-type=module', '-e', code], {
        env: { ...process.env, RUNNER_TEMP: root, RUN_ID: '456', GITHUB_ENV: join(root, 'env') }, encoding: 'utf8',
      });
      assert.equal(result.status === 0, valid, result.stderr);
    }
    assert.match(block, /actions\/artifacts\/\$artifact_id\/zip/);
    assert.match(block, /sha256sum --check/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
