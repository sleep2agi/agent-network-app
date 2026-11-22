import { strict as assert } from 'node:assert';
import { turnCapabilities as caps, type TurnCapabilityReport } from './turn-capabilities';

const v2: TurnCapabilityReport = { runtime: 'opencode-cli', opencode_generation: 'v2', opencode_mode: 'copresence' };
assert.deepEqual(caps(), { interrupt: false, steer: false });
for (const runtime of ['antigravity', 'codex-sdk', 'claude-code-cli', 'grok-build-cli']) {
  assert.deepEqual(caps({ ...v2, runtime, version: '2.5.0-preview.210' }), { interrupt: false, steer: false });
}
for (const [version, interrupt, steer] of [
  ['2.5.0-preview.206', false, false], ['2.5.0-preview.207', true, false],
  ['2.5.0-preview.209', true, false], ['2.5.0-preview.210', true, true],
  ['2.5.0-preview.21', false, false], ['2.5.0', true, true], ['', false, false],
  ['nonsense', false, false], ['2.5.0-beta.999', false, false],
] as const) assert.deepEqual(caps({ ...v2, version }), { interrupt, steer });
assert.deepEqual(caps({ ...v2, version: '2.5.0-preview.210', turn_interrupt_capable: false, turn_steer_capable: false }), { interrupt: false, steer: false });
assert.deepEqual(caps({ runtime: 'antigravity', turn_interrupt_capable: true, turn_steer_capable: false }), { interrupt: true, steer: false });
assert.deepEqual(caps({ runtime: 'antigravity', turn_interrupt_capable: false, turn_steer_capable: true }), { interrupt: false, steer: true });
assert.deepEqual(caps({ ...v2, version: '2.5.0-preview.207', turn_interrupt_capable: null, turn_steer_capable: null }), { interrupt: true, steer: false });
assert.deepEqual(caps({ ...v2, opencode_generation: 'v1', version: '2.5.0' }), { interrupt: false, steer: false });
assert.deepEqual(caps({ runtime: 'opencode', version: '2.5.0' }), { interrupt: false, steer: false });
assert.deepEqual(caps({ ...v2, runtime: 'opencode', version: '2.5.0-preview.210' }), { interrupt: true, steer: true });
assert.deepEqual(caps({ ...v2, opencode_mode: null, version: '2.5.0' }), { interrupt: false, steer: false });
assert.deepEqual(caps({ ...v2, version: '2.5.0-preview.207', build_commit: '4e2f1a78' }), { interrupt: true, steer: true });
assert.deepEqual(caps({ turn_interrupt_capable: false, config_snapshot: { turn_interrupt_capable: true, turn_steer_capable: true } }), { interrupt: false, steer: true });
assert.deepEqual(caps({ runtime: 'opencode-cli', version: '2.5.0-preview.210', config_snapshot: { flags: { opencodeGeneration: 'v2', opencodeMode: 'copresence' } } }), { interrupt: true, steer: true });
console.log('turn-capabilities: all assertions passed');
