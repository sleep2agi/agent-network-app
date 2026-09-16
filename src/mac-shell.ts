// 纯逻辑,不 import react-native:判断「Tauri 桌面壳 + macOS」,给标题栏空带用(测试直接引这里)。
export const MAC_TITLE_STRIP_HEIGHT = 28;

export const isMacTauriShell = (platformOS: string = 'web'): boolean => {
  if (platformOS !== 'web') return false;
  const g = globalThis as { __TAURI_INTERNALS__?: unknown; navigator?: { platform?: string; userAgent?: string } };
  if (!g.__TAURI_INTERNALS__) return false;
  const hint = `${g.navigator?.platform ?? ''} ${g.navigator?.userAgent ?? ''}`;
  return /Mac/i.test(hint);
};
