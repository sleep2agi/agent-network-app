import { strict as assert } from 'node:assert';
import { mock } from 'bun:test';
import { canOpenDaemonSettingsWindow, daemonSettingsWindowLabel, daemonSettingsWindowUrl, openDaemonSettingsWindow, readDaemonSettingsWindow } from './daemon-settings-window';

const scope = { profileId: 'profile-a', networkId: 'net-a', alias: 'Daemon 甲' };
assert.deepEqual(readDaemonSettingsWindow(daemonSettingsWindowUrl(scope).slice(1)), scope);
assert.equal(readDaemonSettingsWindow('?daemonSettings=a&profile=p'), null);
assert.equal(readDaemonSettingsWindow('?daemonSettings=a&network=n'), null);
const label = daemonSettingsWindowLabel(scope);
assert.match(label, /^daemon-settings-[0-9a-f]+$/);
for (const other of [{ ...scope, alias: 'Daemon 乙' }, { ...scope, networkId: 'net-b' }, { ...scope, profileId: 'profile-b' }]) {
  assert.notEqual(daemonSettingsWindowLabel(other), label);
}
assert.equal(await openDaemonSettingsWindow(scope), false, 'plain web/mobile never creates a desktop window');
const g = globalThis as any;
g.__TAURI_INTERNALS__ = { metadata: { currentWindow: { label: 'main' } } };
assert.equal(canOpenDaemonSettingsWindow(), true);
let existing = false, fail = false, created = 0;
const focus: string[] = [];
let options: any;
mock.module('@tauri-apps/api/webviewWindow', () => ({ WebviewWindow: class {
  static async getByLabel(value: string) {
    assert.equal(value, label);
    return existing ? { unminimize: async () => { focus.push('restore'); }, show: async () => { focus.push('show'); }, setFocus: async () => { focus.push('focus'); } } : null;
  }
  constructor(value: string, opts: any) { assert.equal(value, label); created++; options = opts; }
  async once(event: string, fn: () => void) { if (event === (fail ? 'tauri://error' : 'tauri://created')) fn(); return () => {}; }
} }));
assert.equal(await openDaemonSettingsWindow(scope), true);
assert.equal(options.url, daemonSettingsWindowUrl(scope));
assert.equal(options.decorations, true);
assert.equal(options.dragDropEnabled, false);
assert.equal(new URL(options.url, 'http://fixture').searchParams.size, 3, 'URL only contains the three routing identifiers');
existing = true;
assert.equal(await openDaemonSettingsWindow(scope), true);
assert.equal(created, 1);
assert.deepEqual(focus, ['restore', 'show', 'focus']);
existing = false; fail = true;
assert.equal(await openDaemonSettingsWindow(scope), false, 'creation failure leaves original page available');
g.__TAURI_INTERNALS__.metadata.currentWindow.label = label;
assert.equal(canOpenDaemonSettingsWindow(), false, 'no recursive pop-out button in the settings window');
delete g.__TAURI_INTERNALS__;
console.log('daemon-settings-window: route, scope, create, focus, error and mobile fallback PASS');
