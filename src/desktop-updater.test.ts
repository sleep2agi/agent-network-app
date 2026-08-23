import fs from 'node:fs';

const source = fs.readFileSync(new URL('./desktop-updater.ts', import.meta.url), 'utf8');
const prompt = fs.readFileSync(new URL('./DesktopUpdatePrompt.tsx', import.meta.url), 'utf8');
const app = fs.readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');
const settings = fs.readFileSync(new URL('./SettingsScreen.tsx', import.meta.url), 'utf8');
const config = JSON.parse(fs.readFileSync(new URL('../src-tauri/tauri.conf.json', import.meta.url), 'utf8'));
const capability = JSON.parse(fs.readFileSync(new URL('../src-tauri/capabilities/default.json', import.meta.url), 'utf8'));

const checks: Array<[string, boolean]> = [
  ['startup mounts automatic update prompt', app.includes('<DesktopUpdatePrompt />')],
  ['startup check is delayed and non-blocking', prompt.includes('setTimeout') && prompt.includes('checkDesktopUpdate')],
  ['manual settings check exists', settings.includes('checkDesktopUpdate')],
  ['download and install reports progress', source.includes('downloadAndInstall') && source.includes("kind: 'downloading'")],
  ['successful install relaunches', source.includes("plugin-process") && source.includes('await relaunch()')],
  ['non-Tauri platforms stay unsupported', source.includes("kind: 'unsupported'")],
  ['offline checks clear stale staged updates', source.includes('pendingUpdate = undefined') && source.includes('checkOverride')],
  ['signed updater artifacts are enabled', config.bundle.createUpdaterArtifacts === true],
  ['stable anet.sh updater endpoint configured', config.plugins.updater.endpoints[0] === 'https://anet.sh/desktop/update/latest.json'],
  ['updater public key configured', typeof config.plugins.updater.pubkey === 'string' && config.plugins.updater.pubkey.length > 80],
  ['frontend update permissions enabled', capability.permissions.includes('updater:default') && capability.permissions.includes('process:allow-restart')],
];
for (const [name, ok] of checks) {
  if (!ok) throw new Error(`FAIL: ${name}`);
  console.log(`PASS: ${name}`);
}
