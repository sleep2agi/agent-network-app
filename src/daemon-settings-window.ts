import { currentWindowLabel, isTauriShell } from './window-shell';
import { settingsWindowTheme } from './desktop-settings-window';

export type DaemonWindowScope = { profileId: string; networkId: string; alias: string };

export function daemonSettingsWindowLabel(scope: DaemonWindowScope): string {
  let hash = 5381;
  for (const ch of JSON.stringify([scope.profileId, scope.networkId, scope.alias])) hash = ((hash << 5) + hash) ^ ch.charCodeAt(0);
  return `daemon-settings-${(hash >>> 0).toString(16)}`;
}

export function daemonSettingsWindowUrl(scope: DaemonWindowScope): string {
  // Only routing identifiers. Credentials are loaded from the existing profile store in the new window.
  return `/?${new URLSearchParams({ daemonSettings: scope.alias, profile: scope.profileId, network: scope.networkId })}`;
}

export function readDaemonSettingsWindow(search = typeof location === 'undefined' ? '' : location.search): DaemonWindowScope | null {
  const query = new URLSearchParams(search);
  const alias = query.get('daemonSettings')?.trim();
  const profileId = query.get('profile')?.trim();
  const networkId = query.get('network')?.trim();
  return alias && profileId && networkId ? { alias, profileId, networkId } : null;
}

export function canOpenDaemonSettingsWindow(): boolean {
  return isTauriShell() && !currentWindowLabel()?.startsWith('daemon-settings-');
}

/** False keeps the original in-app management page usable, including Android/web. */
export async function openDaemonSettingsWindow(scope: DaemonWindowScope): Promise<boolean> {
  if (!isTauriShell()) return false;
  try {
    const { WebviewWindow } = await import('@tauri-apps/api/webviewWindow');
    const label = daemonSettingsWindowLabel(scope);
    const existing = await WebviewWindow.getByLabel(label);
    if (existing) {
      await existing.unminimize();
      await existing.show();
      await existing.setFocus();
      return true;
    }
    const win = new WebviewWindow(label, {
      url: daemonSettingsWindowUrl(scope),
      title: `${scope.alias} · Daemon · ANet`,
      width: 1120, height: 800, minWidth: 720, minHeight: 520,
      focus: true, resizable: true, decorations: true,
      titleBarStyle: 'overlay', hiddenTitle: true,
      theme: settingsWindowTheme(),
      dragDropEnabled: false,
    });
    return await new Promise<boolean>(resolve => {
      let settled = false;
      const done = (ok: boolean) => { if (!settled) { settled = true; clearTimeout(timer); resolve(ok); } };
      const timer = setTimeout(() => done(false), 6000);
      void win.once('tauri://created', () => done(true)).catch(() => done(false));
      void win.once('tauri://error', () => done(false)).catch(() => done(false));
    });
  } catch { return false; }
}
