export type PinStorage = Pick<Storage, 'getItem' | 'setItem'>;

export function pinStorageKey(windowLabel: string): string {
  return `anet_window_always_on_top_v1:${windowLabel}`;
}

export function storedPinState(storage: PinStorage, key: string): boolean {
  return storage.getItem(key) === 'true';
}

// 0.2.173(Vincent:「主窗口一直浮在最上面，体验太差」):置顶不再跨启动保留。
// 以前启动时把存下的置顶状态重新套上,点过一次图钉就永远浮在最上面且看不出来。
// 现在每次启动都主动取消置顶并清掉旧记录;本次会话里点图钉仍然有效。
export async function applyStoredPinState(
  storage: PinStorage,
  key: string,
  setAlwaysOnTop: (value: boolean) => Promise<void>,
): Promise<boolean> {
  await setAlwaysOnTop(false);
  if (storage.getItem(key) !== null) storage.setItem(key, 'false');
  return false;
}

export async function togglePinState(
  current: boolean,
  storage: PinStorage,
  key: string,
  setAlwaysOnTop: (value: boolean) => Promise<void>,
): Promise<boolean> {
  const next = !current;
  await setAlwaysOnTop(next);
  return next;
}
