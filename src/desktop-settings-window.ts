import { SETTINGS_CATEGORIES, rememberSettingsCategory, type SettingsCategoryKey } from './settings-model';

export const SETTINGS_WINDOW_LABEL = 'settings';
export const SETTINGS_SESSION_EVENT = 'anet-session-changed';
export const SETTINGS_CATEGORY_EVENT = 'anet-settings-category';

const CATEGORY_KEYS = new Set(SETTINGS_CATEGORIES.map(category => category.key));

export function settingsCategoryFromQuery(value: string | null): SettingsCategoryKey | null {
  const category = value?.trim();
  return category && CATEGORY_KEYS.has(category as SettingsCategoryKey) ? category as SettingsCategoryKey : null;
}

export function settingsWindowUrl(category?: string | null): string {
  const query = new URLSearchParams({ settings: '1' });
  const known = settingsCategoryFromQuery(category ?? null);
  if (known) query.set('category', known);
  return `/?${query.toString()}`;
}

export function requestedSettingsWindow(search = typeof location === 'undefined' ? '' : location.search): boolean {
  return new URLSearchParams(search).get('settings') === '1';
}

export function requestedSettingsCategory(search = typeof location === 'undefined' ? '' : location.search): SettingsCategoryKey | null {
  if (!requestedSettingsWindow(search)) return null;
  return settingsCategoryFromQuery(new URLSearchParams(search).get('category'));
}

const tauri = () => !!(globalThis as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;

/** Mac / Windows：设置单独开一个窗口。没有桌面壳时返回 false，调用方留在主窗口。 */
export async function openSettingsWindow(category?: string | null): Promise<boolean> {
  if (!tauri()) return false;
  const known = settingsCategoryFromQuery(category ?? null);
  if (known) rememberSettingsCategory(known);
  const { WebviewWindow } = await import('@tauri-apps/api/webviewWindow');
  const existing = await WebviewWindow.getByLabel(SETTINGS_WINDOW_LABEL);
  if (existing) {
    await existing.show();
    await existing.setFocus();
    if (known) {
      const { emit } = await import('@tauri-apps/api/event');
      await emit(SETTINGS_CATEGORY_EVENT, { category: known });
    }
    return true;
  }
  new WebviewWindow(SETTINGS_WINDOW_LABEL, {
    url: settingsWindowUrl(known),
    title: '设置 · Agent Network',
    width: 960,
    height: 720,
    minWidth: 720,
    minHeight: 520,
    focus: true,
    titleBarStyle: 'overlay',
    hiddenTitle: true,
    dragDropEnabled: false,
  });
  return true;
}

export async function closeSettingsWindow(): Promise<void> {
  if (!tauri()) return;
  const { getCurrentWebviewWindow } = await import('@tauri-apps/api/webviewWindow');
  await getCurrentWebviewWindow().close();
}

/** 设置窗口改了账号之后，让主窗口从磁盘重新读会话。 */
export async function notifySessionChanged(): Promise<void> {
  if (!tauri()) return;
  const { emit } = await import('@tauri-apps/api/event');
  await emit(SETTINGS_SESSION_EVENT);
}
