const THEME_KEY = 'theme_mode_v1';

const storage = (): Storage | null => {
  if (!(globalThis as any).__TAURI_INTERNALS__ || typeof localStorage === 'undefined') return null;
  return localStorage;
};

export function saveDesktopThemeMode(mode: string): boolean {
  const desktop = storage();
  if (!desktop) return false;
  desktop.setItem(THEME_KEY, mode);
  return true;
}

// undefined means this is not a Tauri desktop window; null is a valid
// desktop result meaning that no preference has been saved yet.
export function loadDesktopThemeMode(): string | null | undefined {
  const desktop = storage();
  return desktop ? desktop.getItem(THEME_KEY) : undefined;
}

export function onDesktopThemeStorageChange(listener: (mode: string) => void): () => void {
  if (!storage() || typeof addEventListener === 'undefined') return () => {};
  const handleStorage = (event: StorageEvent) => {
    if (event.key === THEME_KEY && event.newValue) listener(event.newValue);
  };
  addEventListener('storage', handleStorage);
  return () => removeEventListener('storage', handleStorage);
}

// 字体大小 / 界面密度 (src/ui-scale.ts) — same per-device store and the same sync read as the theme,
// so a desktop window paints its first frame at the saved scale.
const UI_SCALE_KEY = 'ui_scale_v1';

export function saveDesktopUiScale(raw: string): boolean {
  const desktop = storage();
  if (!desktop) return false;
  desktop.setItem(UI_SCALE_KEY, raw);
  return true;
}

/** undefined = not a Tauri desktop window; null = nothing saved yet. */
export function loadDesktopUiScale(): string | null | undefined {
  const desktop = storage();
  return desktop ? desktop.getItem(UI_SCALE_KEY) : undefined;
}

/** Another window (detached chat, workspace) changed it. `null` = reset to defaults. */
export function onDesktopUiScaleStorageChange(listener: (raw: string | null) => void): () => void {
  if (!storage() || typeof addEventListener === 'undefined') return () => {};
  const handleStorage = (event: StorageEvent) => {
    if (event.key === UI_SCALE_KEY) listener(event.newValue);
  };
  addEventListener('storage', handleStorage);
  return () => removeEventListener('storage', handleStorage);
}
