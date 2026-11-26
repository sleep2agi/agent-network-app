#!/usr/bin/env node
/**
 * Package a signed HarmonyOS .hap using the exact GitHub Release & www.anet.sh
 * naming contract: `Agent.Network_<version>_harmony.hap` (plus `.sha256`), and
 * optionally upload it to the matching `desktop-v<version>` GitHub Release.
 *
 * Usage:
 *   npm run package:harmony-hap
 *   node scripts/package-harmony-hap.mjs --input path/to/signed.hap
 *   node scripts/package-harmony-hap.mjs --input path/to/signed.hap --upload [--tag desktop-v0.2.623]
 */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_SIGNED_HAP = join(ROOT, 'harmony', 'entry', 'build', 'default', 'outputs', 'default', 'entry-default-signed.hap');
const DIST_DIR = join(ROOT, 'harmony', 'dist');

function argValue(flag) {
  const idx = process.argv.indexOf(flag);
  return idx >= 0 && idx + 1 < process.argv.length ? process.argv[idx + 1] : null;
}

const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
const version = String(argValue('--version') || pkg.version || '').trim();
if (!/^\d+\.\d+\.\d+/.test(version)) {
  console.error(`[harmony-hap] Invalid version: "${version}"`);
  process.exit(1);
}

const inputPath = resolve(argValue('--input') || DEFAULT_SIGNED_HAP);
const allowUnsigned = process.argv.includes('--allow-unsigned');
if (!existsSync(inputPath)) {
  console.error(`[harmony-hap] Signed HAP not found: ${inputPath}`);
  console.error('[harmony-hap] Build & sign in DevEco Studio / hvigorw first, or pass --input <signed.hap>.');
  process.exit(1);
}
if (!allowUnsigned && /unsigned\.hap$/i.test(inputPath)) {
  console.error(`[harmony-hap] Refusing unsigned HAP (${inputPath}). Sign with Huawei release/enterprise cert first (or pass --allow-unsigned for local testing).`);
  process.exit(1);
}

const assetName = `Agent.Network_${version}_harmony.hap`;
const outPath = join(DIST_DIR, assetName);
const shaPath = `${outPath}.sha256`;

mkdirSync(DIST_DIR, { recursive: true });
copyFileSync(inputPath, outPath);
const bytes = readFileSync(outPath);
const sha256 = createHash('sha256').update(bytes).digest('hex');
writeFileSync(shaPath, `${sha256}  ${assetName}\n`, 'utf8');

console.log(`[harmony-hap] Packaged: ${outPath}`);
console.log(`[harmony-hap] Size:     ${statSync(outPath).size} bytes`);
console.log(`[harmony-hap] SHA256:   ${sha256}`);

if (process.argv.includes('--upload')) {
  const tag = argValue('--tag') || `desktop-v${version}`;
  const repo = argValue('--repo') || 'sleep2agi/agent-network-app';
  console.log(`[harmony-hap] Uploading ${assetName} to ${repo} release ${tag}...`);
  execFileSync('gh', ['release', 'upload', tag, outPath, '--clobber', '--repo', repo], {
    cwd: ROOT,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  console.log(`[harmony-hap] Uploaded! Trigger modelscope-mirror.yml for tag=${tag} to sync the China mirror and SHA256SUMS.`);
}
