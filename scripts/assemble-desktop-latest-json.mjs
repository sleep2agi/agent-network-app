#!/usr/bin/env node
// Builds the draft's latest.json from the signed assets once every build leg is done.
//
// Why: the macOS and Windows legs used to run one after the other (max-parallel: 1) only
// because each tauri-action read-modified-wrote latest.json, so concurrent legs could
// overwrite each other's platform entries. That cost every release 12-22 minutes of
// Windows waiting for macOS. Now the legs run in parallel with uploadUpdaterJson off,
// and this single writer assembles the manifest exactly as tauri-action did:
//   darwin-aarch64, darwin-aarch64-app  -> *.app.tar.gz   (signature = *.app.tar.gz.sig)
//   windows-x86_64, windows-x86_64-nsis -> *-setup.exe    (updaterJsonPreferNsis: true)
//   windows-x86_64-msi                  -> *.msi
// url is the asset API url, the same form tauri-action writes; verify-desktop-release-draft
// checks it and normalize-desktop-update-manifest maps it to the public download link.
//
// If the draft already has latest.json (the serial Linux path keeps tauri-action's writer),
// this does nothing.
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { latestJsonUploadArgs } from './normalize-desktop-update-manifest.mjs';

const RULES = [
  { suffix: '.app.tar.gz', keys: ['darwin-aarch64', 'darwin-aarch64-app'] },
  { suffix: '-setup.exe', keys: ['windows-x86_64', 'windows-x86_64-nsis'] },
  { suffix: '.msi', keys: ['windows-x86_64-msi'] },
];

/**
 * @param {{version: string, notes: string, pubDate: string,
 *          assets: Array<{name: string, url: string}>, signatures: Record<string, string>}} input
 *   signatures: asset name of the bundle -> contents of its .sig file
 */
export function assembleManifest({ version, notes, pubDate, assets, signatures }) {
  if (typeof version !== 'string' || !version) throw new Error('version is required');
  const platforms = {};
  for (const rule of RULES) {
    const bundles = assets.filter(a => a.name.endsWith(rule.suffix) && a.name.includes(`_${version}_`));
    if (bundles.length === 0) continue;
    if (bundles.length !== 1) throw new Error(`ambiguous ${rule.suffix} bundles: ${bundles.map(b => b.name).join(', ')}`);
    const bundle = bundles[0];
    const signature = (signatures[bundle.name] ?? '').trim();
    if (!signature) throw new Error(`${bundle.name} has no .sig asset`);
    if (typeof bundle.url !== 'string' || !bundle.url) throw new Error(`${bundle.name} has no asset url`);
    for (const key of rule.keys) platforms[key] = { signature, url: bundle.url };
  }
  if (Object.keys(platforms).length === 0) throw new Error(`no signed desktop bundles for ${version}`);
  return { version, notes: notes ?? '', pub_date: pubDate, platforms };
}

const gh = (args, opts = {}) => execFileSync('gh', args, { encoding: 'utf8', maxBuffer: 64 << 20, ...opts });

async function main() {
  const repo = process.env.GITHUB_REPOSITORY, releaseId = process.env.RELEASE_ID;
  if (!repo || !releaseId) throw new Error('GITHUB_REPOSITORY and RELEASE_ID are required');
  const release = JSON.parse(gh(['api', `repos/${repo}/releases/${releaseId}`]));
  const version = String(release.tag_name ?? '').replace(/^desktop-v/, '');
  const assets = (release.assets ?? []).map(a => ({ name: a.name, url: a.url, id: a.id }));
  if (assets.some(a => a.name === 'latest.json')) {
    console.log(`desktop-v${version} already has latest.json (serial path); nothing to assemble`);
    return;
  }
  const signatures = {};
  for (const sig of assets.filter(a => a.name.endsWith('.sig'))) {
    signatures[sig.name.slice(0, -4)] = gh(['api', '-H', 'Accept: application/octet-stream', `repos/${repo}/releases/assets/${sig.id}`]);
  }
  const manifest = assembleManifest({ version, notes: release.body ?? '', pubDate: new Date().toISOString(), assets, signatures });
  const dir = mkdtempSync(join(tmpdir(), 'latest-json-'));
  const file = join(dir, 'latest.json');
  writeFileSync(file, JSON.stringify(manifest, null, 2));
  // Draft assets: upload by release id on uploads.github.com (a tag lookup does not see drafts).
  execFileSync('gh', latestJsonUploadArgs({ repository: repo, releaseId, file }), { stdio: ['ignore', 'ignore', 'inherit'] });
  console.log(`assembled latest.json for desktop-v${version}: ${Object.keys(manifest.platforms).join(', ')}`);
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isMain) main().catch(error => { console.error(`::error::assemble latest.json failed: ${error instanceof Error ? error.message : String(error)}`); process.exit(1); });
