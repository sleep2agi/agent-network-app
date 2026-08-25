export type PinStorage = Pick<Storage, 'getItem' | 'setItem'>;

export function pinStorageKey(windowLabel: string): string {
  return `anet_window_always_on_top_v1:${windowLabel}`;
}

export function storedPinState(storage: PinStorage, key: string): boolean {
  return storage.getItem(key) === 'true';
}

export async function applyStoredPinState(
  storage: PinStorage,
  key: string,
  setAlwaysOnTop: (value: boolean) => Promise<void>,
): Promise<boolean> {
  const pinned = storedPinState(storage, key);
  await setAlwaysOnTop(pinned);
  return pinned;
}

export async function togglePinState(
  current: boolean,
  storage: PinStorage,
  key: string,
  setAlwaysOnTop: (value: boolean) => Promise<void>,
): Promise<boolean> {
  const next = !current;
  await setAlwaysOnTop(next);
  storage.setItem(key, String(next));
  return next;
}
