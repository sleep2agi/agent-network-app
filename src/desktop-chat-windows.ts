import { mergeDetachedChatWindow, openChatWindow } from './desktop-chat-menu';
import { listHubProfiles, loadDetachedChatWindows, saveDetachedChatWindows } from './storage';

export async function openRememberedChatWindow(alias: string, profileId?: string, context?: string): Promise<void> {
  if (profileId) {
    const windows = await loadDetachedChatWindows(profileId);
    await saveDetachedChatWindows(profileId, mergeDetachedChatWindow(windows, { alias, context }));
  }
  await openChatWindow(alias, profileId, context);
}

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
