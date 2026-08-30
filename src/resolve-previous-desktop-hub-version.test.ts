// Fixture-only. Do not exec scripts/resolve-previous-desktop-hub-version.mjs
// against this checkout: unit-tests.yml does not fetch tags, so a live git
// tag list is empty and the CLI throw is an environment failure, not a
// logic failure (#210 / #207).
import { readFileSync } from 'node:fs';
import {
  hubPinFromSidecarPackage,
  resolvePreviousFactoryHub,
  requireStableAppVersion,
  selectPreviousDesktopTag,
} from '../scripts/resolve-previous-desktop-hub-version.mjs';

let passed = 0;
const check = (name: string, condition: boolean) => {
  if (!condition) throw new Error(`FAIL: ${name}`);
  passed++;
  console.log(`PASS: ${name}`);
};

const throws = (name: string, fn: () => unknown, needle: string) => {
  try {
    fn();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    check(name, message.includes(needle));
    return;
  }
  throw new Error(`FAIL: ${name} (expected throw containing ${JSON.stringify(needle)})`);
};

const sidecar = (hub: string) =>
  JSON.stringify({ dependencies: { '@sleep2agi/commhub-server': hub } });

const tags = [
  'desktop-v0.2.40',
  'desktop-v0.2.41',
  'desktop-v0.2.42',
  'desktop-v0.2.43',
  'desktop-v0.2.41-rc.1',
  'desktop-v0.2.42-signed-abc',
  'v0.2.41',
  'not-a-tag',
  '',
];

check(
  'selects the greatest stable tag strictly older than current',
  selectPreviousDesktopTag('0.2.42', tags).tag === 'desktop-v0.2.41',
);

check(
  'ignores a tag equal to the app version so a later publish cannot seed itself',
  selectPreviousDesktopTag('0.2.42', tags).version === '0.2.41',
);

check(
  'ignores newer stable tags than the app under test',
  selectPreviousDesktopTag('0.2.41', tags).tag === 'desktop-v0.2.40',
);

check(
  'ignores prerelease / signed / non-desktop tags',
  selectPreviousDesktopTag('0.2.42', [
    'desktop-v0.2.41-rc.1',
    'desktop-v0.2.40',
    'desktop-v0.2.42-signed-abc',
    'v0.2.41',
  ]).tag === 'desktop-v0.2.40',
);

throws(
  'throws when no older stable tag exists (empty list)',
  () => selectPreviousDesktopTag('0.2.42', []),
  'no published desktop-vMAJOR.MINOR.PATCH tag older than 0.2.42',
);

throws(
  'throws when every stable tag is current or newer',
  () => selectPreviousDesktopTag('0.2.42', ['desktop-v0.2.42', 'desktop-v0.2.43']),
  'no published desktop-vMAJOR.MINOR.PATCH tag older than 0.2.42',
);

throws(
  'throws on a non-stable app version instead of inventing a default',
  () => requireStableAppVersion('0.2.42-preview'),
  'is not major.minor.patch',
);

throws(
  'throws when the selected tag has no sidecar package.json in the fixture map',
  () =>
    resolvePreviousFactoryHub({
      currentVersion: '0.2.42',
      tags: ['desktop-v0.2.41'],
      sidecarPackageJsonByTag: {},
    }),
  'desktop-v0.2.41 local-hub-sidecar/package.json is missing',
);

throws(
  'throws when the sidecar pin is missing',
  () => hubPinFromSidecarPackage('desktop-v0.2.41', JSON.stringify({ dependencies: {} })),
  'has no @sleep2agi/commhub-server pin',
);

throws(
  'throws when the sidecar pin is empty',
  () => hubPinFromSidecarPackage('desktop-v0.2.41', sidecar('   ')),
  'has no @sleep2agi/commhub-server pin',
);

const resolved = resolvePreviousFactoryHub({
  currentVersion: '0.2.42',
  tags,
  sidecarPackageJsonByTag: {
    'desktop-v0.2.40': sidecar('0.9.0-preview.30'),
    'desktop-v0.2.41': sidecar('0.9.0-preview.31'),
    'desktop-v0.2.42': sidecar('0.9.0-preview.44'),
    'desktop-v0.2.43': sidecar('0.9.0-preview.99'),
  },
});
check('fixture path matching the real user upgrade is .31 from v0.2.41', resolved.hub === '0.9.0-preview.31');
check('resolved tag is desktop-v0.2.41', resolved.tag === 'desktop-v0.2.41');

const script = readFileSync(new URL('../scripts/resolve-previous-desktop-hub-version.mjs', import.meta.url), 'utf8');
check(
  'CLI still reads tags from git history',
  script.includes("['tag', '-l', 'desktop-v*']") && script.includes('${tag}:local-hub-sidecar/package.json'),
);
check(
  'CLI still refuses a silent default and a tautology against EXPECTED_HUB_VERSION',
  script.includes('A silent default would keep the') &&
    script.includes('smoke green when the seed is forgotten') &&
    script.includes('cannot become a tautology that always matches EXPECTED_HUB_VERSION'),
);
const expectedMentions = [...script.matchAll(/EXPECTED_HUB_VERSION/g)];
check(
  'EXPECTED_HUB_VERSION is comment-only, never assigned or read as data',
  expectedMentions.length === 1 && script.includes('// ') && !/EXPECTED_HUB_VERSION\s*=/.test(script),
);
check('CLI does not hardcode a previous Hub version', !script.includes('0.9.0-preview.28'));

const seed = readFileSync(new URL('../scripts/seed-previous-local-hub.mjs', import.meta.url), 'utf8');
check('seed requires ANET_SMOKE_PREVIOUS_HUB_VERSION', seed.includes('ANET_SMOKE_PREVIOUS_HUB_VERSION'));
check('seed has no .28 default', !seed.includes("previousVersion = '0.9.0-preview.28'"));

console.log(`\n=== ${passed} resolver fixture checks passed ===`);
