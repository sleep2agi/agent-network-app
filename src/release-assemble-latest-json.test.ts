// Parallel desktop builds: the single latest.json writer. Run: bun src/release-assemble-latest-json.test.ts
import { readFileSync } from 'node:fs';
// @ts-ignore -- plain .mjs script
import { assembleManifest } from '../scripts/assemble-desktop-latest-json.mjs';

const checks: [string, boolean][] = [];
const ck = (name: string, ok: boolean) => checks.push([name, ok]);
const api = (id: number) => `https://api.github.com/repos/sleep2agi/agent-network-app/releases/assets/${id}`;
const assets = [
  { name: 'ANet_0.2.502_aarch64.app.tar.gz', url: api(1) }, { name: 'ANet_0.2.502_aarch64.app.tar.gz.sig', url: api(2) },
  { name: 'ANet_0.2.502_aarch64.dmg', url: api(3) },
  { name: 'ANet_0.2.502_x64-setup.exe', url: api(4) }, { name: 'ANet_0.2.502_x64-setup.exe.sig', url: api(5) },
  { name: 'ANet_0.2.502_x64_en-US.msi', url: api(6) }, { name: 'ANet_0.2.502_x64_en-US.msi.sig', url: api(7) },
];
const signatures = { 'ANet_0.2.502_aarch64.app.tar.gz': 'MAC\n', 'ANet_0.2.502_x64-setup.exe': 'EXE', 'ANet_0.2.502_x64_en-US.msi': 'MSI' };
const m = assembleManifest({ version: '0.2.502', notes: 'What is new', pubDate: '2026-11-10T00:00:00Z', assets, signatures });

// The same five keys tauri-action wrote for 0.2.500 (updaterJsonPreferNsis: true).
ck('five platform keys, as tauri-action wrote them', JSON.stringify(Object.keys(m.platforms).sort()) === JSON.stringify(['darwin-aarch64', 'darwin-aarch64-app', 'windows-x86_64', 'windows-x86_64-msi', 'windows-x86_64-nsis']));
ck('mac points at the .app.tar.gz asset API url', m.platforms['darwin-aarch64'].url === api(1) && m.platforms['darwin-aarch64-app'].url === api(1));
ck('windows default + nsis point at setup.exe', m.platforms['windows-x86_64'].url === api(4) && m.platforms['windows-x86_64-nsis'].url === api(4));
ck('msi points at the msi', m.platforms['windows-x86_64-msi'].url === api(6));
ck('signature is the .sig contents, trimmed', m.platforms['darwin-aarch64'].signature === 'MAC' && m.platforms['windows-x86_64-msi'].signature === 'MSI');
ck('version / notes / pub_date carried', m.version === '0.2.502' && m.notes === 'What is new' && m.pub_date === '2026-11-10T00:00:00Z');

let threw = '';
try { assembleManifest({ version: '0.2.502', notes: '', pubDate: '', assets, signatures: { ...signatures, 'ANet_0.2.502_x64_en-US.msi': '' } }); } catch (e) { threw = String(e); }
ck('a bundle without its .sig fails, never ships unsigned', threw.includes('has no .sig'));
threw = '';
try { assembleManifest({ version: '0.2.503', notes: '', pubDate: '', assets, signatures }); } catch (e) { threw = String(e); }
ck('bundles of another version are not picked up', threw.includes('no signed desktop bundles'));

// Wiring: legs run in parallel without their own manifest writes; the assembler runs before verify.
const wf = readFileSync(new URL('../.github/workflows/release-desktop-auto-update.yml', import.meta.url), 'utf8');
ck('builds run in parallel unless Linux is included', wf.includes("max-parallel: ${{ inputs.include_linux && 1 || 2 }}"));
ck('tauri-action writes latest.json only on the serial Linux path', wf.includes('uploadUpdaterJson: ${{ inputs.include_linux }}'));
const verify = wf.slice(wf.indexOf('\n  verify-draft:'), wf.indexOf('\n  attach-android-apk:'));
ck('verify-draft assembles before it verifies', verify.indexOf('run: node scripts/assemble-desktop-latest-json.mjs') > 0 && verify.indexOf('run: node scripts/assemble-desktop-latest-json.mjs') < verify.indexOf('run: node scripts/verify-desktop-release-draft.mjs'));

let failed = 0;
for (const [name, ok] of checks) { console.log(`${ok ? '✓' : '✗'} ${name}`); if (!ok) failed++; }
console.log(`${checks.length - failed}/${checks.length} passed`);
process.exit(failed ? 1 : 0);
