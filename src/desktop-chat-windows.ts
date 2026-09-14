import { mergeDetachedChatWindow, openChatWindow } from './desktop-chat-menu';
import { listHubProfiles, loadDetachedChatWindows, saveDetachedChatWindows } from './storage';

export async function openRememberedChatWindow(alias: string, profileId?: string, context?: string): Promise<void> {
  if (profileId) {
    const windows = await loadDetachedChatWindows(profileId);
    await saveDetachedChatWindows(profileId, mergeDetachedChatWindow(windows, { alias, context }));
  }
  await openChatWindow(alias, profileId, context);
}

/** 启动时曾自动回放所有拆出去的聊天窗口;2026-09-14 起不再在启动时调用(Vincent:重启不需要全部重开)。保留给将来的手动「恢复窗口」入口。 */
export async function restoreDetachedChatWindows(): Promise<void> {
  if (!(globalThis as any).__TAURI_INTERNALS__) return;
  const registry = await listHubProfiles();
  await Promise.all(registry.profiles.map(async profile => {
    const windows = await loadDetachedChatWindows(profile.profileId);
    for (const window of windows) {
      await openChatWindow(
        window.alias,
        profile.profileId,
        window.context || profile.displayName || profile.username || profile.serverUrl,
      );
    }
  }));
}
