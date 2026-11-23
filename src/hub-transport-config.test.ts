import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const { expo } = JSON.parse(readFileSync('app.json', 'utf8'));
const ats = expo.ios.infoPlist.NSAppTransportSecurity;
assert.equal(ats.NSAllowsArbitraryLoads, true);
assert.equal(ats.NSAllowsLocalNetworking, true);
const buildProperties = expo.plugins.find((p: unknown) => Array.isArray(p) && p[0] === 'expo-build-properties');
assert.equal(buildProperties?.[1]?.android?.usesCleartextTraffic, true);
console.log('iOS and Android HTTP configuration passed');
