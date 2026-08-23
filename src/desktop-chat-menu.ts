const PIN_KEY = 'anet_chat_pin_v1';

export function loadPinnedChats(): string[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    const parsed = JSON.parse(localStorage.getItem(PIN_KEY) ?? '[]');
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    return [];
  }
}

export function savePinnedChats(aliases: string[]): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(PIN_KEY, JSON.stringify([...new Set(aliases)]));
}

export function chatWindowLabel(alias: string): string {
  let hash = 5381;
  for (const ch of alias) hash = ((hash << 5) + hash) ^ ch.charCodeAt(0);
  return `chat-${(hash >>> 0).toString(16)}`;
}

export function chatWindowUrl(alias: string): string {
  return `/?chat=${encodeURIComponent(alias)}`;
}

export function requestedChatAlias(search = typeof location === 'undefined' ? '' : location.search): string | null {
  const alias = new URLSearchParams(search).get('chat')?.trim();
  return alias || null;
}

export async function openChatWindow(alias: string): Promise<void> {
  if (!(globalThis as any).__TAURI_INTERNALS__) return;
  const { WebviewWindow } = await import('@tauri-apps/api/webviewWindow');
  const label = chatWindowLabel(alias);
  const existing = await WebviewWindow.getByLabel(label);
  if (existing) {
    await existing.show();
    await existing.setFocus();
    return;
  }
  new WebviewWindow(label, {
    url: chatWindowUrl(alias),
    title: `${alias} · Agent Network`,
    width: 760,
    height: 720,
    minWidth: 480,
    minHeight: 520,
    focus: true,
  });
}
