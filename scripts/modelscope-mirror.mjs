#!/usr/bin/env node
// China download mirror of published `desktop-v*` releases on ModelScope.
//
// Driven by .github/workflows/modelscope-mirror.yml in three steps:
//
//   1. scripts/modelscope-mirror-upload.py list      -> remote.json   (path -> sha256 on ModelScope)
//   2. node scripts/modelscope-mirror.mjs prepare    -> upload tree + expected.json   (this file)
//   3. scripts/modelscope-mirror-upload.py upload    -> one commit, then anonymous verification
//
// Layout in the dataset (see docs/desktop-release-sop.md section 10):
//
//   desktop/<ver>/<every GitHub asset>   byte-identical to the release asset
//   desktop/<ver>/SHA256SUMS             `sha256sum` format over those assets, basenames only
//   desktop/latest/latest.json           Tauri updater manifest whose platform URLs point at
//                                        desktop/<ver>/ on ModelScope (signatures unchanged)
//   desktop/latest/VERSION               "<ver>\n"
//   desktop/latest/Agent.Network_<suffix>  version-less copies of the four installers, so a
//                                        download page can link a URL that never changes
//   desktop/latest/SHA256SUMS            over the files in desktop/latest/
//
// desktop/latest/ is only written when the tag being mirrored is the newest published
// desktop release (same selection as the anet.sh dynamic endpoint), so re-syncing an old
// release never rolls the pointer back.
//
// Idempotence: every file's expected sha256 is known before anything is downloaded
// (GitHub reports a sha256 `digest` for each release asset; generated files are computed
// in memory). Only files whose sha differs from what ModelScope already holds are
// downloaded and staged. A run against an in-sync release downloads nothing and commits
// nothing.

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createReadStream, existsSync, linkSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const DEFAULT_REPOSITORY = 'sleep2agi/agent-network-app';
export const DEFAULT_MIRROR_REPO = 'SmartFlowAI/agent-network-releases';
export const mirrorBaseUrl = (mirrorRepo = DEFAULT_MIRROR_REPO) =>
  `https://modelscope.cn/datasets/${mirrorRepo}/resolve/master`;

// Installers that get a version-less alias under desktop/latest/. Updater bundles
// (.app.tar.gz, .sig) are reached through latest.json and keep versioned paths only.
export const LATEST_ALIAS_SUFFIXES = ['aarch64.dmg', 'x64-setup.exe', 'x64_en-US.msi', 'android-universal.apk'];
export const APK_SUFFIX = 'android-universal.apk';

const TAG_RE = /^desktop-v(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/;

export const parseDesktopTag = (tag) => {
  const match = TAG_RE.exec(tag ?? '');
  if (!match) return null;
  return { text: tag.slice('desktop-v'.length), core: match.slice(1, 4).map(Number), pre: match[4]?.split('.') ?? null };
};

const compareIdentifiers = (left, right) => {
  const numericLeft = /^\d+$/.test(left);
  const numericRight = /^\d+$/.test(right);
  if (numericLeft && numericRight) return Number(left) - Number(right);
  if (numericLeft !== numericRight) return numericLeft ? -1 : 1;
  return left.localeCompare(right);
};

// Same ordering as docs-site/api/desktop-update-latest.mjs in sleep2agi/agent-network,
// so "newest" here is the release the anet.sh endpoint serves.
export const compareDesktopVersions = (left, right) => {
  for (let index = 0; index < 3; index += 1) {
    if (left.core[index] !== right.core[index]) return left.core[index] - right.core[index];
  }
  if (left.pre === null || right.pre === null) {
    if (left.pre === right.pre) return 0;
    return left.pre === null ? 1 : -1;
  }
  const length = Math.max(left.pre.length, right.pre.length);
  for (let index = 0; index < length; index += 1) {
    if (left.pre[index] === undefined) return -1;
    if (right.pre[index] === undefined) return 1;
    const compared = compareIdentifiers(left.pre[index], right.pre[index]);
    if (compared !== 0) return compared;
  }
  return 0;
};

export const selectNewestDesktopRelease = (releases) => releases
  .filter((release) => !release.draft)
  .map((release) => ({ release, version: parseDesktopTag(release.tag_name) }))
  .filter((candidate) => candidate.version && candidate.release.assets?.some((asset) => asset.name === 'latest.json'))
  .sort((left, right) => compareDesktopVersions(right.version, left.version))[0]?.release ?? null;

export const latestAliasName = (assetName, version) => {
  for (const suffix of LATEST_ALIAS_SUFFIXES) {
    if (assetName === `Agent.Network_${version}_${suffix}`) return `Agent.Network_${suffix}`;
  }
  return null;
};

export const assetSha256 = (asset) => {
  const match = /^sha256:([0-9a-f]{64})$/.exec(asset?.digest ?? '');
  return match ? match[1] : null;
};

export const sha256Hex = (bytes) => createHash('sha256').update(bytes).digest('hex');

// `sha256sum -c` compatible: "<hex>  <name>\n", sorted by name, basenames only.
export const sha256sums = (entries) => [...entries]
  .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
  .map(([name, hex]) => `${hex}  ${name}\n`)
  .join('');

/**
 * Rewrite a tauri-action latest.json so each platform downloads from the mirror.
 * Only `url` changes; `signature` and every other field are kept verbatim. The updater
 * verifies the signature over the downloaded bytes, and the mirrored bytes are identical,
 * so the original signatures stay valid.
 *
 * tauri-action writes GitHub asset *API* URLs; the anet.sh endpoint and fallback.json use
 * browser_download_url. Both forms are accepted. Anything that does not map to exactly one
 * asset of this release fails closed.
 */
export const rewriteManifestForMirror = (manifest, release, { version, baseUrl }) => {
  if (manifest?.version !== version) {
    throw new Error(`latest.json version ${JSON.stringify(manifest?.version)} does not match ${release.tag_name}`);
  }
  if (!manifest.platforms || typeof manifest.platforms !== 'object' || Array.isArray(manifest.platforms)) {
    throw new Error('latest.json: platforms must be an object');
  }
  const platforms = Object.fromEntries(Object.entries(manifest.platforms).map(([platform, entry]) => {
    if (!entry || typeof entry.url !== 'string' || typeof entry.signature !== 'string' || !entry.signature) {
      throw new Error(`latest.json: ${platform} lacks url or signature`);
    }
    const matches = release.assets.filter((asset) => asset.url === entry.url || asset.browser_download_url === entry.url);
    if (matches.length !== 1) {
      throw new Error(`latest.json: ${platform} url maps to ${matches.length} release assets (need exactly 1)`);
    }
    return [platform, { ...entry, url: `${baseUrl}/desktop/${version}/${encodeURIComponent(matches[0].name)}` }];
  }));
  if (Object.keys(platforms).length === 0) throw new Error('latest.json: no platforms');
  return { ...manifest, platforms };
};

/**
 * Everything the mirror should hold for one release, as { path -> { sha256, source } }.
 * `source` is { asset } for a release asset (to be downloaded) or { bytes } for a
 * generated file. Pure: no network, no disk.
 */
export const planMirror = ({ release, manifest, isNewest, baseUrl }) => {
  const version = parseDesktopTag(release.tag_name)?.text;
  if (!version) throw new Error(`not a desktop release tag: ${release.tag_name}`);
  if (release.draft) throw new Error(`${release.tag_name} is a draft; only published releases are mirrored`);
  const plan = new Map();
  const assetSums = [];
  for (const asset of release.assets) {
    if (asset.state !== 'uploaded') throw new Error(`${asset.name} is still uploading (state=${asset.state})`);
    if (asset.name.includes('/') || asset.name === 'SHA256SUMS') throw new Error(`unexpected asset name ${asset.name}`);
    const sha256 = assetSha256(asset);
    if (!sha256) throw new Error(`${asset.name} has no sha256 digest from GitHub`);
    plan.set(`desktop/${version}/${asset.name}`, { sha256, size: asset.size, source: { asset } });
    assetSums.push([asset.name, sha256]);
  }
  const addGenerated = (path, text) => {
    const bytes = Buffer.from(text, 'utf8');
    plan.set(path, { sha256: sha256Hex(bytes), size: bytes.length, source: { bytes } });
  };
  addGenerated(`desktop/${version}/SHA256SUMS`, sha256sums(assetSums));

  if (isNewest) {
    const latestSums = [];
    for (const asset of release.assets) {
      const alias = latestAliasName(asset.name, version);
      if (!alias) continue;
      const sha256 = assetSha256(asset);
      plan.set(`desktop/latest/${alias}`, { sha256, size: asset.size, source: { asset } });
      latestSums.push([alias, sha256]);
    }
    const rewritten = `${JSON.stringify(rewriteManifestForMirror(manifest, release, { version, baseUrl }), null, 2)}\n`;
    addGenerated('desktop/latest/latest.json', rewritten);
    addGenerated('desktop/latest/VERSION', `${version}\n`);
    latestSums.push(['latest.json', plan.get('desktop/latest/latest.json').sha256]);
    latestSums.push(['VERSION', plan.get('desktop/latest/VERSION').sha256]);
    addGenerated('desktop/latest/SHA256SUMS', sha256sums(latestSums));
  }
  return plan;
};

/** Paths whose remote sha256 differs from the plan (missing counts as different). */
export const diffAgainstRemote = (plan, remote) =>
  [...plan.keys()].filter((path) => remote[path] !== plan.get(path).sha256).sort();

// ---------------------------------------------------------------------------
// CLI (network + disk). Everything above is pure and covered by
// src/modelscope-mirror.test.ts.
// ---------------------------------------------------------------------------

const sleepMs = (ms) => new Promise((done) => setTimeout(done, ms));

async function withRetries(label, fn, { attempts = 4, delayMs = 5_000 } = {}) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      console.warn(`::warning::${label} failed (attempt ${attempt}/${attempts}): ${error.message}`);
      if (attempt < attempts) await sleepMs(delayMs * attempt);
    }
  }
  throw new Error(`${label}: giving up after ${attempts} attempts: ${lastError?.message}`);
}

function githubApi(repository, path) {
  return withRetries(`GET ${path}`, async () => {
    const output = execFileSync('gh', ['api', '--paginate', '--slurp', `repos/${repository}/${path}`], {
      encoding: 'utf8', maxBuffer: 256 * 1024 * 1024,
    });
    const pages = JSON.parse(output);
    return pages.length === 1 && !Array.isArray(pages[0]) ? pages[0] : pages.flat();
  });
}

const fileSha256 = (path) => new Promise((done, fail) => {
  const hash = createHash('sha256');
  createReadStream(path).on('error', fail).on('data', (chunk) => hash.update(chunk)).on('end', () => done(hash.digest('hex')));
});

function parseArgs(argv) {
  const args = { command: argv[0] };
  for (let index = 1; index < argv.length; index += 2) {
    const key = argv[index];
    if (!key?.startsWith('--') || argv[index + 1] === undefined) throw new Error(`bad argument near ${key}`);
    args[key.slice(2)] = argv[index + 1];
  }
  return args;
}

async function prepare(args) {
  const repository = args.repository || DEFAULT_REPOSITORY;
  const baseUrl = mirrorBaseUrl(args['mirror-repo'] || DEFAULT_MIRROR_REPO);
  const out = resolve(args.out ?? '');
  const remote = JSON.parse(readFileSync(args.remote, 'utf8'));
  const waitApkMinutes = Number(args['wait-apk-minutes'] || 0);
  if (!args.out) throw new Error('--out is required');

  const releases = await githubApi(repository, 'releases?per_page=100');
  const newest = selectNewestDesktopRelease(releases);
  const tag = args.tag || newest?.tag_name;
  if (!tag) throw new Error('no published desktop-v* release with latest.json found');
  if (!parseDesktopTag(tag)) throw new Error(`not a desktop release tag: ${tag}`);

  // The Android APK is attached to the release *after* it is published, by hand, and takes
  // a few minutes to upload. On the `release: published` trigger we wait for it; if it never
  // shows up we mirror what is there and the scheduled reconcile picks the APK up later.
  let release;
  const deadline = Date.now() + waitApkMinutes * 60_000;
  for (;;) {
    release = await githubApi(repository, `releases/tags/${encodeURIComponent(tag)}`);
    const uploading = release.assets.filter((asset) => asset.state !== 'uploaded').map((asset) => asset.name);
    const hasApk = release.assets.some((asset) => asset.name.endsWith(`_${APK_SUFFIX}`) && asset.state === 'uploaded');
    if (uploading.length === 0 && (hasApk || Date.now() >= deadline)) {
      if (!hasApk) console.log(`::warning::${tag} has no Android APK yet; mirroring without it (the scheduled run will add it once attached)`);
      break;
    }
    if (Date.now() >= deadline) {
      // An asset mid-upload has no final bytes yet. Mirror the finished ones; the next
      // scheduled run adds the rest (SHA256SUMS is regenerated then, too).
      console.log(`::warning::${tag}: skipping asset(s) still uploading: ${uploading.join(', ')}`);
      release = { ...release, assets: release.assets.filter((asset) => asset.state === 'uploaded') };
      break;
    }
    console.log(`waiting for ${hasApk ? 'uploads to finish' : 'the Android APK'} on ${tag} (${uploading.join(', ') || 'no APK yet'})`);
    await sleepMs(30_000);
  }
  if (release.draft) throw new Error(`${tag} is a draft`);

  const version = parseDesktopTag(tag).text;
  const isNewest = newest?.tag_name === tag;
  const manifestAsset = release.assets.find((asset) => asset.name === 'latest.json');
  if (!manifestAsset) throw new Error(`${tag} has no latest.json`);

  rmSync(out, { recursive: true, force: true });
  const downloads = join(out, 'downloads');
  mkdirSync(downloads, { recursive: true });
  const download = async (asset) => {
    const target = join(downloads, asset.name);
    if (existsSync(target)) return target;
    await withRetries(`gh release download ${asset.name}`, async () => {
      execFileSync('gh', ['release', 'download', tag, '--repo', repository, '--dir', downloads, '--pattern', asset.name, '--clobber'], { stdio: 'inherit' });
      const actual = await fileSha256(target);
      if (actual !== assetSha256(asset)) {
        rmSync(target, { force: true });
        throw new Error(`${asset.name}: downloaded sha256 ${actual} != GitHub digest ${assetSha256(asset)}`);
      }
    });
    return target;
  };

  const manifest = JSON.parse(readFileSync(await download(manifestAsset), 'utf8'));
  const plan = planMirror({ release, manifest, isNewest, baseUrl });
  const changed = diffAgainstRemote(plan, remote);

  const tree = join(out, 'tree');
  mkdirSync(tree, { recursive: true });
  for (const path of changed) {
    const entry = plan.get(path);
    const target = join(tree, path);
    mkdirSync(dirname(target), { recursive: true });
    if (entry.source.bytes) writeFileSync(target, entry.source.bytes);
    else linkSync(await download(entry.source.asset), target);
    const size = statSync(target).size;
    if (size !== entry.size) throw new Error(`${path}: staged ${size} bytes, expected ${entry.size}`);
  }

  const expected = Object.fromEntries([...plan].map(([path, entry]) => [path, entry.sha256]));
  writeFileSync(join(out, 'expected.json'), `${JSON.stringify(expected, null, 2)}\n`);
  writeFileSync(join(out, 'summary.json'), `${JSON.stringify({ tag, version, isNewest, newest: newest?.tag_name ?? null, planned: plan.size, changed, sizes: Object.fromEntries([...plan].map(([path, entry]) => [path, entry.size])) }, null, 2)}\n`);
  console.log(`${tag}: ${plan.size} planned file(s), ${changed.length} to upload${isNewest ? ' (newest release: desktop/latest/ included)' : ` (newest is ${newest?.tag_name}; desktop/latest/ untouched)`}`);
  for (const path of changed) console.log(`  + ${path}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = parseArgs(process.argv.slice(2));
  if (args.command !== 'prepare') {
    console.error('usage: modelscope-mirror.mjs prepare --remote remote.json --out DIR [--tag desktop-vX.Y.Z] [--wait-apk-minutes N]');
    process.exit(2);
  }
  prepare(args).catch((error) => {
    console.error(`::error::${error.message}`);
    process.exit(1);
  });
}
