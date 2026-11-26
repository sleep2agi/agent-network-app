#!/usr/bin/env node
/**
 * Export the Expo Web bundle into harmony/entry/src/main/resources/rawfile/web/
 * and sync versionName / versionCode from package.json into harmony/AppScope/app.json5.
 *
 * Usage:
 *   npm run build:harmony-web
 */
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const HARMONY_DIR = join(ROOT, 'harmony');
const RAWFILE_WEB = join(HARMONY_DIR, 'entry', 'src', 'main', 'resources', 'rawfile', 'web');
const TMP_EXPORT = join(ROOT, '.harmony-web-export');

const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
const version = String(pkg.version || '0.2.0');
const parts = version.split('.').map(n => Number.parseInt(n, 10) || 0);
// Matches Android versionCode convention (e.g. 0.2.621 -> 2062100 or 2621; HarmonyOS requires >= 1 and <= 2^31-1)
const versionCode = Math.max(1, parts[0] * 1_000_000 + parts[1] * 10_000 + parts[2]);

console.log(`[harmony-web] Exporting Expo Web bundle for ANet v${version} (versionCode=${versionCode})...`);
rmSync(TMP_EXPORT, { recursive: true, force: true });

const expoBin = join(ROOT, 'node_modules', '.bin', process.platform === 'win32' ? 'expo.cmd' : 'expo');
const cmd = existsSync(expoBin) ? expoBin : 'npx';
const args = existsSync(expoBin)
  ? ['export', '--platform', 'web', '--output-dir', TMP_EXPORT]
  : ['expo', 'export', '--platform', 'web', '--output-dir', TMP_EXPORT];

execFileSync(cmd, args, { cwd: ROOT, stdio: 'inherit' });

rmSync(RAWFILE_WEB, { recursive: true, force: true });
mkdirSync(dirname(RAWFILE_WEB), { recursive: true });
cpSync(TMP_EXPORT, RAWFILE_WEB, { recursive: true });
rmSync(TMP_EXPORT, { recursive: true, force: true });

// Sync versionCode & versionName into harmony/AppScope/app.json5
const appJson5Path = join(HARMONY_DIR, 'AppScope', 'app.json5');
if (existsSync(appJson5Path)) {
  const src = readFileSync(appJson5Path, 'utf8')
    .replace(/"versionCode"\s*:\s*\d+/, `"versionCode": ${versionCode}`)
    .replace(/"versionName"\s*:\s*"[^"]*"/, `"versionName": "${version}"`);
  writeFileSync(appJson5Path, src, 'utf8');
}

console.log(`[harmony-web] Done! Web assets ready at: ${RAWFILE_WEB}`);
console.log('[harmony-web] Next: open harmony/ in DevEco Studio (click Run) or run `hvigorw assembleHap --no-daemon`.');
