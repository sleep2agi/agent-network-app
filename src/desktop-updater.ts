import { stopLocalHub } from './local-hub';
import { atLeast, type DesktopUpdateSource, type DesktopUpdateState } from './update-check-state';
export type { DesktopUpdateState } from './update-check-state';

/**
 * 这次更新包走哪条线路。Tauri updater 按 tauri.conf.json 的 endpoints 顺序取清单(anet.sh → ModelScope),
 * 插件的 JS `check()` 不能改 endpoints,所以桌面端**不做**强制线路,只把实际来源写出来:
 *   anet.sh 的 latest.json 平台地址指向 github.com/…/releases/download → 线路二(GitHub);
 *   ModelScope 的 latest.json 被 modelscope-mirror 改写成 modelscope.cn/…/desktop/<ver>/… → 线路一。
 * 看的是**本机平台**用到的那些地址:全是同一主机才下结论,混着或认不出 → undefined(不猜)。
 */
export function desktopUpdateSource(rawJson: unknown): DesktopUpdateSource | undefined {
  const platforms = (rawJson as { platforms?: unknown } | null | undefined)?.platforms;
  if (!platforms || typeof platforms !== 'object') return undefined;
  const hosts = new Set<DesktopUpdateSource | 'other'>();
  for (const entry of Object.values(platforms as Record<string, { url?: unknown }>)) {
    const url = typeof entry?.url === 'string' ? entry.url : '';
    let host = '';
    try { host = new URL(url).hostname.toLowerCase(); } catch { hosts.add('other'); continue; }
    if (host === 'modelscope.cn' || host.endsWith('.modelscope.cn')) hosts.add('mirror');
    else if (host === 'github.com' || host.endsWith('.github.com') || host === 'objects.githubusercontent.com') hosts.add('github');
    else hosts.add('other');
  }
  if (hosts.size !== 1) return undefined;
  const [only] = [...hosts];
  return only === 'other' ? undefined : only;
}

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


let state: DesktopUpdateState = { kind: 'idle' };
let pendingUpdate: any;
let lastCheckedAt: number | undefined;
let checkInFlight: Promise<DesktopUpdateState> | undefined;
const listeners = new Set<() => void>();

const publish = (next: DesktopUpdateState) => {
  state = next;
  listeners.forEach(listener => listener());
  return next;
};

export const desktopUpdateSnapshot = () => state;
/** 上一次检查**结束**的时间(成功或失败都算);设置页用它显示「刚刚检查 / N 分钟前检查」。 */
export const desktopUpdateLastCheckedAt = () => lastCheckedAt;
export const subscribeDesktopUpdates = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

type UpdateCheck = (options: { timeout: number }) => Promise<any>;

/**
 * `manual: true` = 用户点的:「检查中…」至少可见 700ms,结果一定落到一个看得见的状态上。
 * 启动时的自动检查不传,没有新版本时安静地结束(设置页那一行不会自己跳变提醒)。
 */
export async function checkDesktopUpdate(
  checkOverride?: UpdateCheck,
  opts: { manual?: boolean; minVisibleMs?: number; sleep?: (ms: number) => Promise<void> } = {},
): Promise<DesktopUpdateState> {
  if (!(globalThis as any).__TAURI_INTERNALS__) return publish({ kind: 'unsupported' });
  if (checkInFlight) return checkInFlight;
  checkInFlight = (async () => {
    publish({ kind: 'checking' });
    pendingUpdate = undefined;
    try {
      const check = checkOverride || (await import('@tauri-apps/plugin-updater')).check;
      const found = check({ timeout: 20_000 });
      pendingUpdate = opts.manual
        ? await atLeast(found, opts.minVisibleMs ?? 700, {
          now: () => Date.now(),
          sleep: opts.sleep ?? (ms => new Promise(resolve => setTimeout(resolve, ms))),
        })
        : await found;
      lastCheckedAt = Date.now();
      if (!pendingUpdate) return publish({ kind: 'up-to-date' });
      return publish({
        kind: 'available',
        version: pendingUpdate.version,
        notes: pendingUpdate.body || '此版本包含功能改进和问题修复。',
        currentVersion: typeof pendingUpdate.currentVersion === 'string' ? pendingUpdate.currentVersion : undefined,
        source: desktopUpdateSource(pendingUpdate.rawJson),
      });
    } catch (error: any) {
      lastCheckedAt = Date.now();
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
  const from = state.kind === 'available' ? { currentVersion: state.currentVersion, source: state.source } : {};
  let downloaded = 0;
  let total: number | undefined;
  try {
    await pendingUpdate.downloadAndInstall((event: any) => {
      if (event.event === 'Started') total = event.data.contentLength || undefined;
      if (event.event === 'Progress') downloaded += event.data.chunkLength || 0;
      publish({
        kind: 'downloading',
        version,
        ...from,
        percent: total ? Math.min(100, Math.round(downloaded * 100 / total)) : undefined,
        downloaded,
        total,
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

/** web 验收夹具用(UpdatePromptFixtureScreen):直接摆出一个状态来截图。生产代码不调用。 */
export function __showDesktopUpdateForFixture(next: DesktopUpdateState) {
  publish(next);
}
