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

export async function openChatWindow(alias: string, profileId?: string, context?: string): Promise<void> {
  if (!(globalThis as any).__TAURI_INTERNALS__) return;
  const { WebviewWindow } = await import('@tauri-apps/api/webviewWindow');
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
  });
}
