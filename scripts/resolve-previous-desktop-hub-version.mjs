#!/usr/bin/env node
// Previous factory Hub version for packaged migration smoke.
//
// Source is git history (last published desktop-vMAJOR.MINOR.PATCH tag
// strictly older than package.json), not the binary under test — so this
// cannot become a tautology that always matches EXPECTED_HUB_VERSION.
// Missing / unreadable previous → throw. A silent default would keep the
// smoke green when the seed is forgotten (#207).

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const current = JSON.parse(readFileSync('package.json', 'utf8')).version;
if (!/^\d+\.\d+\.\d+$/.test(current)) {
  throw new Error(`package.json version ${current} is not major.minor.patch`);
}

function cmp(a, b) {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return pa[i] - pb[i];
  }
  return 0;
}

const raw = execFileSync('git', ['tag', '-l', 'desktop-v*'], { encoding: 'utf8' });
const stable = [];
for (const line of raw.split('\n')) {
  const tag = line.trim();
  const m = /^desktop-v(\d+\.\d+\.\d+)$/.exec(tag);
  if (m) stable.push({ tag, version: m[1] });
}
stable.sort((a, b) => cmp(a.version, b.version));
const prev = [...stable].reverse().find((item) => cmp(item.version, current) < 0);
if (!prev) {
  throw new Error(`no published desktop-vMAJOR.MINOR.PATCH tag older than ${current}`);
}

const pkg = execFileSync('git', ['show', `${prev.tag}:local-hub-sidecar/package.json`], {
  encoding: 'utf8',
});
const hub = JSON.parse(pkg).dependencies?.['@sleep2agi/commhub-server'];
if (typeof hub !== 'string' || !hub.trim()) {
  throw new Error(`${prev.tag} local-hub-sidecar/package.json has no @sleep2agi/commhub-server pin`);
}
process.stdout.write(hub.trim());
