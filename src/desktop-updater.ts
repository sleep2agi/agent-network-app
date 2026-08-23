export type DesktopUpdateState =
  | { kind: 'idle' | 'unsupported' | 'checking' | 'up-to-date' }
  | { kind: 'available'; version: string; notes: string }
  | { kind: 'downloading'; version: string; percent?: number }
  | { kind: 'error'; message: string };

let state: DesktopUpdateState = { kind: 'idle' };
let pendingUpdate: any;
let checkInFlight: Promise<DesktopUpdateState> | undefined;
const listeners = new Set<() => void>();

const publish = (next: DesktopUpdateState) => {
  state = next;
  listeners.forEach(listener => listener());
  return next;
};

export const desktopUpdateSnapshot = () => state;
export const subscribeDesktopUpdates = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

type UpdateCheck = (options: { timeout: number }) => Promise<any>;

export async function checkDesktopUpdate(checkOverride?: UpdateCheck): Promise<DesktopUpdateState> {
  if (!(globalThis as any).__TAURI_INTERNALS__) return publish({ kind: 'unsupported' });
  if (checkInFlight) return checkInFlight;
  checkInFlight = (async () => {
    publish({ kind: 'checking' });
    pendingUpdate = undefined;
    try {
      const check = checkOverride || (await import('@tauri-apps/plugin-updater')).check;
      pendingUpdate = await check({ timeout: 20_000 });
      if (!pendingUpdate) return publish({ kind: 'up-to-date' });
      return publish({
        kind: 'available',
        version: pendingUpdate.version,
        notes: pendingUpdate.body || '此版本包含功能改进和问题修复。',
      });
    } catch (error: any) {
      return publish({ kind: 'error', message: error?.message || String(error) });
    } finally {
      checkInFlight = undefined;
    }
  })();
  return checkInFlight;
}

export async function installDesktopUpdate(): Promise<void> {
  if (!pendingUpdate) throw new Error('没有待安装的更新');
  const version = pendingUpdate.version as string;
  let downloaded = 0;
  let total: number | undefined;
  try {
    await pendingUpdate.downloadAndInstall((event: any) => {
      if (event.event === 'Started') total = event.data.contentLength || undefined;
      if (event.event === 'Progress') downloaded += event.data.chunkLength || 0;
      publish({
        kind: 'downloading',
        version,
        percent: total ? Math.min(100, Math.round(downloaded * 100 / total)) : undefined,
      });
    });
    const { relaunch } = await import('@tauri-apps/plugin-process');
    await relaunch();
  } catch (error: any) {
    publish({ kind: 'error', message: error?.message || String(error) });
    throw error;
  }
}
