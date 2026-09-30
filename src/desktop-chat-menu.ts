import { POPOUT_TRAFFIC_LIGHT_X, POPOUT_TRAFFIC_LIGHT_Y, chatPopoutDecorations, tauriShellPlatform } from './window-shell';

const PIN_KEY = 'anet_chat_pin_v1';
const pinKey = (profileId?: string) => profileId ? `${PIN_KEY}:${profileId}` : PIN_KEY;

export function loadPinnedChats(profileId?: string): string[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    const parsed = JSON.parse(localStorage.getItem(pinKey(profileId)) ?? '[]');
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    return [];
  }
}

export function savePinnedChats(aliases: string[], profileId?: string): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(pinKey(profileId), JSON.stringify([...new Set(aliases)]));
}

export function chatWindowLabel(alias: string, profileId = ''): string {
  let hash = 5381;
  for (const ch of `${profileId}\0${alias}`) hash = ((hash << 5) + hash) ^ ch.charCodeAt(0);
  return `chat-${(hash >>> 0).toString(16)}`;
}

export function chatWindowUrl(alias: string, profileId?: string): string {
  const query = new URLSearchParams({ chat: alias });
  if (profileId) query.set('profile', profileId);
  return `/?${query.toString()}`;
}

export function requestedChatAlias(search = typeof location === 'undefined' ? '' : location.search): string | null {
  const alias = new URLSearchParams(search).get('chat')?.trim();
  return alias || null;
}

export function requestedChatProfileId(search = typeof location === 'undefined' ? '' : location.search): string | null {
  const profileId = new URLSearchParams(search).get('profile')?.trim();
  return profileId || null;
}

export interface DetachedChatWindowRecord {
  alias: string;
  context?: string;
}

export function mergeDetachedChatWindow(windows: DetachedChatWindowRecord[], next: DetachedChatWindowRecord): DetachedChatWindowRecord[] {
  return [...windows.filter(window => window.alias !== next.alias), next];
}

export async function openChatWindow(alias: string, profileId?: string, context?: string): Promise<void> {
  if (!(globalThis as any).__TAURI_INTERNALS__) return;
  const { WebviewWindow } = await import('@tauri-apps/api/webviewWindow');
  const { LogicalPosition } = await import('@tauri-apps/api/dpi');
  const label = chatWindowLabel(alias, profileId);
  const existing = await WebviewWindow.getByLabel(label);
  if (existing) {
    await existing.show();
    await existing.setFocus();
    return;
  }
  new WebviewWindow(label, {
    url: chatWindowUrl(alias, profileId),
    title: `${alias}${context ? ` · ${context}` : ''} · Agent Network`,
    width: 760,
    height: 720,
    minWidth: 480,
    minHeight: 520,
    focus: true,
    // 页头就是标题栏(window-shell.ts「分离聊天窗」):Windows 关原生标题栏,– □ × 由
    // PopoutWindowControls 画;macOS 保留 decorations 给红黄绿灯,Overlay 标题栏 + 灯挪进页头。
    decorations: chatPopoutDecorations(tauriShellPlatform()),
    // Windows 无边框窗口的阴影;开着时边缘缩放走阴影区(Tauri undecorated_resizing),关掉就没有外缩放边。
    shadow: true,
    resizable: true,
    titleBarStyle: 'overlay',
    hiddenTitle: true,
    trafficLightPosition: new LogicalPosition(POPOUT_TRAFFIC_LIGHT_X, POPOUT_TRAFFIC_LIGHT_Y),
    // 让网页收到系统拖进来的文件(聊天区拖放加附件);开着的话 Tauri 自己截走 drop 事件。
    dragDropEnabled: false,
  });
}

// ── 应用多开:每个账号一个完整工作区窗口(Vincent 2026-09-07)──────────────────
// URL 形状 `/?workspace=<profileId>`;标签按 profileId 哈希,同一账号只开一个窗口、再点就聚焦。
// 这种窗口启动时用 loadHubProfile(借用)而不是 switchHubProfile(切换),主窗口的当前账号不动。

export function workspaceWindowLabel(profileId: string): string {
  let hash = 5381;
  for (const ch of `workspace\0${profileId}`) hash = ((hash << 5) + hash) ^ ch.charCodeAt(0);
  return `workspace-${(hash >>> 0).toString(16)}`;
}

export function workspaceWindowUrl(profileId: string): string {
  return `/?${new URLSearchParams({ workspace: profileId }).toString()}`;
}

export function requestedWorkspaceProfileId(search = typeof location === 'undefined' ? '' : location.search): string | null {
  const profileId = new URLSearchParams(search).get('workspace')?.trim();
  return profileId || null;
}

/** 窗口标题:「账号 · Hub 主机 · Agent Network」,让两个窗口在 Dock / 任务栏里一眼分得开。 */
export function workspaceWindowTitle(profile: { displayName?: string; username?: string; serverUrl: string }): string {
  const who = profile.displayName?.trim() || profile.username?.trim() || 'Hub 账号';
  let host = profile.serverUrl;
  try { host = new URL(profile.serverUrl).host || profile.serverUrl; } catch { /* keep raw */ }
  return `${who} · ${host} · Agent Network`;
}

export async function openWorkspaceWindow(profile: { profileId: string; displayName?: string; username?: string; serverUrl: string }): Promise<void> {
  if (!(globalThis as any).__TAURI_INTERNALS__) return;
  const { WebviewWindow } = await import('@tauri-apps/api/webviewWindow');
  const label = workspaceWindowLabel(profile.profileId);
  const existing = await WebviewWindow.getByLabel(label);
  if (existing) {
    await existing.show();
    await existing.setFocus();
    return;
  }
  new WebviewWindow(label, {
    url: workspaceWindowUrl(profile.profileId),
    title: workspaceWindowTitle(profile),
    width: 1200,
    height: 800,
    minWidth: 420,
    minHeight: 600,
    focus: true,
    // 原生标题栏(– □ × 是系统的),页面里不画 WinTitleBar —— 见 window-shell.ts windowDrawsOwnTitleBar
    decorations: true,
    titleBarStyle: 'overlay',
    hiddenTitle: true,
    // 让网页收到系统拖进来的文件(聊天区拖放加附件);开着的话 Tauri 自己截走 drop 事件。
    dragDropEnabled: false,
  });
}
