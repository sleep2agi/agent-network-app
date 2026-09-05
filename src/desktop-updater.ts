import { stopLocalHub } from './local-hub';

/**
 * 更新提示只展示**本次**新版本那一段(Vincent 2026-09-06 截图:发布说明是累计的,8 个版本全铺在
 * 弹窗里、没滚动、按钮被顶出窗口)。发布说明的形状由 release-desktop-auto-update.yml 固定:
 * 一行前言 + 若干段 `What's new in X.Y.Z:` + 结尾一句。这里取第一段;没有这种标题就退回整段。
 */
export function latestReleaseNotes(body: string | null | undefined): string {
  const text = (body ?? '').replace(/\r\n/g, '\n').trim();
  if (!text) return '';
  const headings = [...text.matchAll(/^What's new in [^\n]+:\s*$/gm)];
  if (headings.length === 0) return text;
  const start = headings[0].index ?? 0;
  const end = headings.length > 1 ? (headings[1].index ?? text.length) : text.length;
  let section = text.slice(start, end).trim();
  // 只有一段时,结尾的「Existing installations can update in place…」那句属于全文尾注,不是本版内容。
  section = section.replace(/\n+Existing installations[^\n]*$/i, '').trim();
  return section;
}

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
    // app#246:重启前先停掉本 app 托管的本地 Hub,否则旧版 sidecar 会以孤儿身份继续占着端口和
    // ownership lock,新版 app 起来只看到「version mismatch」。停不掉也不阻塞更新(接管逻辑兜底)。
    await stopLocalHub().catch(() => undefined);
    const { relaunch } = await import('@tauri-apps/plugin-process');
    await relaunch();
  } catch (error: any) {
    publish({ kind: 'error', message: error?.message || String(error) });
    throw error;
  }
}
