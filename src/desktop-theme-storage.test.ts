import { strict as assert } from 'node:assert';

const values = new Map<string, string>();
(globalThis as any).__TAURI_INTERNALS__ = {};
(globalThis as any).localStorage = {
  getItem: (key: string) => values.get(key) ?? null,
  setItem: (key: string, value: string) => values.set(key, value),
};

const { loadDesktopThemeMode, saveDesktopThemeMode } = await import('./desktop-theme-storage');

assert.equal(loadDesktopThemeMode(), null);
assert.equal(saveDesktopThemeMode('light'), true);
assert.equal(loadDesktopThemeMode(), 'light');
assert.equal(values.get('theme_mode_v1'), 'light');

console.log('desktop theme storage: 3 checks passed');
