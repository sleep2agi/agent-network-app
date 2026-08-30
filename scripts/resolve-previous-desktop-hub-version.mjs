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
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const STABLE_VERSION = /^\d+\.\d+\.\d+$/;
const STABLE_DESKTOP_TAG = /^desktop-v(\d+\.\d+\.\d+)$/;
const HUB_DEP = '@sleep2agi/commhub-server';

export function requireStableAppVersion(version) {
  const current = String(version ?? '').trim();
  if (!STABLE_VERSION.test(current)) {
    throw new Error(`package.json version ${version} is not major.minor.patch`);
  }
  return current;
}

export function compareStableVersions(a, b) {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return pa[i] - pb[i];
  }
  return 0;
}

export function parseStableDesktopTags(tagList) {
  const lines = Array.isArray(tagList) ? tagList : String(tagList ?? '').split('\n');
  const stable = [];
  for (const line of lines) {
    const tag = String(line).trim();
    const match = STABLE_DESKTOP_TAG.exec(tag);
    if (match) stable.push({ tag, version: match[1] });
  }
  return stable;
}

export function selectPreviousDesktopTag(currentVersion, tagList) {
  const current = requireStableAppVersion(currentVersion);
  const stable = parseStableDesktopTags(tagList);
  stable.sort((left, right) => compareStableVersions(left.version, right.version));
  const previous = [...stable].reverse().find((item) => compareStableVersions(item.version, current) < 0);
  if (!previous) {
    throw new Error(`no published desktop-vMAJOR.MINOR.PATCH tag older than ${current}`);
  }
  return previous;
}

export function hubPinFromSidecarPackage(tag, packageJsonText) {
  let pkg;
  try {
    pkg = JSON.parse(packageJsonText);
  } catch {
    throw new Error(`${tag} local-hub-sidecar/package.json is not JSON`);
  }
  const hub = pkg?.dependencies?.[HUB_DEP];
  if (typeof hub !== 'string' || !hub.trim()) {
    throw new Error(`${tag} local-hub-sidecar/package.json has no @sleep2agi/commhub-server pin`);
  }
  return hub.trim();
}

export function resolvePreviousFactoryHub({ currentVersion, tags, sidecarPackageJsonByTag }) {
  const previous = selectPreviousDesktopTag(currentVersion, tags);
  const text = sidecarPackageJsonByTag?.[previous.tag];
  if (typeof text !== 'string') {
    throw new Error(`${previous.tag} local-hub-sidecar/package.json is missing`);
  }
  return {
    tag: previous.tag,
    version: previous.version,
    hub: hubPinFromSidecarPackage(previous.tag, text),
  };
}

function gitTagList() {
  return execFileSync('git', ['tag', '-l', 'desktop-v*'], { encoding: 'utf8' });
}

function gitShowSidecar(tag) {
  return execFileSync('git', ['show', `${tag}:local-hub-sidecar/package.json`], {
    encoding: 'utf8',
  });
}

function main() {
  const current = JSON.parse(readFileSync('package.json', 'utf8')).version;
  const previous = selectPreviousDesktopTag(current, gitTagList());
  process.stdout.write(hubPinFromSidecarPackage(previous.tag, gitShowSidecar(previous.tag)));
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isMain) {
  main();
}
