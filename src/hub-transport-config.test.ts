import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const { expo } = JSON.parse(readFileSync('app.json', 'utf8'));
const buildProperties = expo.plugins.find((p: unknown) => Array.isArray(p) && p[0] === 'expo-build-properties');
assert.equal(buildProperties?.[1]?.android?.usesCleartextTraffic, true);
console.log('Android HTTP configuration passed; iOS is checked after prebuild and IPA export');
