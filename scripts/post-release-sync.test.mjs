import { test } from 'node:test';
import assert from 'node:assert/strict';
import { identity, assertPointers } from './post-release-sync.mjs';
const tag = 'desktop-v0.2.613';
const release = () => ({ tag_name: tag, draft: false, prerelease: false, target_commitish: 'a'.repeat(40), assets: [{ name: 'Agent.Network_0.2.613_android-universal.apk', state: 'uploaded', digest: `sha256:${'b'.repeat(64)}` }] });
test('canonical published identity is bound to SHA and APK digest', () => {
  assert.deepEqual(identity(release(), tag), { version: '0.2.613', sha: 'a'.repeat(40), digest: 'b'.repeat(64) });
});
test('reject unpublished, unbound, wrong-version and ambiguous APK sources', () => {
  for (const change of [{ draft: true }, { prerelease: true }, { target_commitish: 'main' }, { tag_name: 'desktop-v0.2.612' }, { assets: [] }, { assets: [...release().assets, ...release().assets] }, { assets: [{ ...release().assets[0], digest: null }] }])
    assert.throws(() => identity({ ...release(), ...change }, tag));
});
test('all four exact pointers required; fallback lag cannot be green', () => {
  assert.doesNotThrow(() => assertPointers('0.2.613', Array(4).fill('0.2.613')));
  for (let i = 0; i < 4; i++) {
    const pointers = Array(4).fill('0.2.613'); pointers[i] = '0.2.612';
    assert.throws(() => assertPointers('0.2.613', pointers));
  }
  assert.throws(() => assertPointers('0.2.613', []));
});
