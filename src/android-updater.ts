/**
 * 安卓端应用内更新:GitHub releases/latest → 下载 universal APK(可续传、带进度)→ 系统安装器。
 *
 * 纯逻辑在 android-update-core.ts;这里只是把它接到 expo-file-system / expo-intent-launcher 上,
 * 并维护一个给设置页和更新弹窗共用的状态(形状同 desktop-updater:snapshot + subscribe)。
 * 原生模块全部惰性 import —— 桌面/Web/iOS 的包里这个文件只会被引用,不会被执行。
 */
import { atLeast } from './update-check-state';
import {
  ANDROID_LATEST_RELEASE_API,
  ANDROID_RELEASES_PAGE,
  APK_MIME,
  UNKNOWN_SOURCES_SETTINGS_DATA,
  apkCacheFileName,
  downloadErrorReason,
  downloadPercent,
  evaluateAndroidRelease,
  type AndroidUpdateState,
  type ApkAsset,
} from './android-update-core';
export type { AndroidUpdateState } from './android-update-core';

type Release = { version: string; notes: string; apk: ApkAsset; releaseUrl: string };

let state: AndroidUpdateState = { kind: 'idle' };
let lastCheckedAt: number | undefined;
let checkInFlight: Promise<AndroidUpdateState> | undefined;
let resumable: any;
let resumableVersion: string | undefined;
/** DownloadResumable 的进度回调在创建时就定死了;续传时要换成新一轮的处理函数(停滞计时器在里面)。 */
let progressRef: ((p: { totalBytesWritten: number; totalBytesExpectedToWrite: number }) => void) | undefined;
let dismissed = false;
const listeners = new Set<() => void>();

/** 原生依赖:生产里惰性 import;ck 测试注入假的(expo 原生模块在 bun 里加载不了)。 */
type Deps = { FileSystem: any; IntentLauncher: any; openURL: (url: string) => Promise<unknown> };
let testDeps: Deps | undefined;
let stallMs = 45_000;
async function deps(): Promise<Deps> {
  if (testDeps) return testDeps;
  const FileSystem = await import('expo-file-system/legacy');
  const IntentLauncher = await import('expo-intent-launcher');
  const { Linking } = await import('react-native');
  return { FileSystem, IntentLauncher, openURL: url => Linking.openURL(url) };
}

const publish = (next: AndroidUpdateState) => {
  state = next;
  listeners.forEach(listener => listener());
  return next;
};

export const androidUpdateSnapshot = () => state;
export const androidUpdateLastCheckedAt = () => lastCheckedAt;
export const androidUpdatePromptDismissed = () => dismissed;
export const subscribeAndroidUpdates = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

const releaseOf = (s: AndroidUpdateState): Release | undefined =>
  'apk' in s ? { version: s.version, notes: s.notes, apk: s.apk, releaseUrl: s.releaseUrl } : undefined;

/** 关掉弹窗(稍后再说)。下载中关不掉 —— 那时弹窗上没有这个按钮。 */
export function dismissAndroidUpdate() {
  dismissed = true;
  listeners.forEach(listener => listener());
}

async function fetchLatestRelease(fetchImpl: typeof fetch, timeoutMs: number) {
  const controller = typeof AbortController === 'function' ? new AbortController() : undefined;
  const timer = setTimeout(() => controller?.abort(), timeoutMs);
  try {
    const res = await fetchImpl(ANDROID_LATEST_RELEASE_API, {
      headers: { Accept: 'application/vnd.github+json' },
      signal: controller?.signal,
    });
    if (!res.ok) throw new Error(`GitHub ${res.status}`);
    return await res.json();
  } catch (error: any) {
    if (error?.name === 'AbortError') throw new Error('timeout');
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

/** 点「软件更新」那一行。结果一定落到一个看得见的状态上(同桌面端 #341 的约定)。 */
export async function checkAndroidUpdate(
  currentVersion: string,
  opts: { fetchImpl?: typeof fetch; minVisibleMs?: number; sleep?: (ms: number) => Promise<void> } = {},
): Promise<AndroidUpdateState> {
  // 已经在下载/已下载好:再点一次就是把弹窗叫回来,不重新检查、不打断下载。
  if (state.kind === 'downloading' || state.kind === 'ready' || state.kind === 'download-error' || state.kind === 'available') {
    dismissed = false;
    listeners.forEach(listener => listener());
    return state;
  }
  if (checkInFlight) return checkInFlight;
  checkInFlight = (async () => {
    publish({ kind: 'checking' });
    try {
      const release = await atLeast(fetchLatestRelease(opts.fetchImpl ?? fetch, 20_000), opts.minVisibleMs ?? 700, {
        now: () => Date.now(),
        sleep: opts.sleep ?? (ms => new Promise(resolve => setTimeout(resolve, ms))),
      });
      lastCheckedAt = Date.now();
      const verdict = evaluateAndroidRelease(release, currentVersion);
      if (verdict.kind === 'available') dismissed = false;
      return publish(verdict.kind === 'available'
        ? { kind: 'available', version: verdict.version, notes: verdict.notes, apk: verdict.apk, releaseUrl: verdict.releaseUrl }
        : verdict);
    } catch (error: any) {
      lastCheckedAt = Date.now();
      return publish({ kind: 'error', message: error?.message || String(error) });
    } finally {
      checkInFlight = undefined;
    }
  })();
  return checkInFlight;
}

/** 下载安装包。失败后再调一次 = 从断点续传(同一次运行内)。 */
export async function downloadAndroidUpdate(): Promise<void> {
  const rel = releaseOf(state);
  if (!rel || state.kind === 'downloading') return;
  const { FileSystem } = await deps();
  const dir = `${FileSystem.cacheDirectory}updates/`;
  const fileUri = `${dir}${apkCacheFileName(rel.version)}`;
  let stallTimer: ReturnType<typeof setTimeout> | undefined;
  let stalled = false;
  const armStall = () => {
    if (stallTimer) clearTimeout(stallTimer);
    stallTimer = setTimeout(() => {
      stalled = true;
      void resumable?.pauseAsync?.().catch(() => undefined);
    }, stallMs);
  };
  try {
    await FileSystem.makeDirectoryAsync(dir, { intermediates: true }).catch(() => undefined);
    // 上次已经完整下好(大小对得上)就直接装,不再下一遍 77MB。
    const existing = await FileSystem.getInfoAsync(fileUri).catch(() => undefined as any);
    if (existing?.exists && rel.apk.size && existing.size === rel.apk.size) {
      publish({ ...rel, kind: 'ready', fileUri, installAttempted: false });
      return;
    }
    await cleanupOldApks(FileSystem, dir, apkCacheFileName(rel.version));
    publish({ ...rel, kind: 'downloading', percent: 0 });
    const onProgress = (p: { totalBytesWritten: number; totalBytesExpectedToWrite: number }) => {
      armStall();
      const expected = p.totalBytesExpectedToWrite > 0 ? p.totalBytesExpectedToWrite : rel.apk.size;
      const percent = downloadPercent(p.totalBytesWritten, expected);
      if (state.kind === 'downloading' && state.percent !== percent) publish({ ...rel, kind: 'downloading', percent });
    };
    progressRef = onProgress;
    armStall();
    let result: { status?: number; uri?: string } | undefined;
    if (resumable && resumableVersion === rel.version) {
      result = await resumable.resumeAsync();
    } else {
      resumable = FileSystem.createDownloadResumable(rel.apk.url, fileUri, {}, (p: { totalBytesWritten: number; totalBytesExpectedToWrite: number }) => progressRef?.(p));
      resumableVersion = rel.version;
      result = await resumable.downloadAsync();
    }
    if (stalled) throw new Error('stalled');
    if (!result) throw new Error('stalled'); // pauseAsync 之后 download/resume 以 undefined 结束
    if (result.status && (result.status < 200 || result.status >= 300)) {
      resumable = undefined;
      await FileSystem.deleteAsync(fileUri, { idempotent: true }).catch(() => undefined);
      throw new Error(`HTTP ${result.status}`);
    }
    const info = await FileSystem.getInfoAsync(fileUri);
    if (!info.exists || (rel.apk.size && (info as any).size !== rel.apk.size)) {
      resumable = undefined;
      await FileSystem.deleteAsync(fileUri, { idempotent: true }).catch(() => undefined);
      throw new Error('size mismatch');
    }
    resumable = undefined;
    publish({ ...rel, kind: 'ready', fileUri, installAttempted: false });
    await installAndroidUpdate();
  } catch (error: any) {
    // 只有 pause 过(停滞)才有续传数据;其他失败下次从头下。
    if (!stalled) {
      let resumeData: string | undefined;
      try { resumeData = resumable?.savable?.()?.resumeData; } catch { /* ignore */ }
      if (!resumeData) resumable = undefined;
    }
    // 停滞时我们自己 pause 的:不管底层以 undefined 还是「Socket closed」结束,都报「太慢/中断」。
    publish({ ...rel, kind: 'download-error', message: downloadErrorReason(stalled ? 'stalled' : (error?.message || String(error))) });
  } finally {
    if (stallTimer) clearTimeout(stallTimer);
    progressRef = undefined;
  }
}

async function cleanupOldApks(FileSystem: any, dir: string, keep: string) {
  try {
    const names: string[] = await FileSystem.readDirectoryAsync(dir);
    await Promise.all(names.filter(n => n.endsWith('.apk') && n !== keep)
      .map(n => FileSystem.deleteAsync(`${dir}${n}`, { idempotent: true }).catch(() => undefined)));
  } catch { /* 目录不存在等:无所谓 */ }
}

/**
 * 交给系统安装器。安装成功时本进程会被替换掉,这里的 await 不会回来;
 * 回来了 = 用户取消 / 被「未知来源」或 MIUI 安全守护拦下 → 弹窗改成带引导的「重新安装」。
 */
export async function installAndroidUpdate(): Promise<void> {
  if (state.kind !== 'ready') return;
  const current = state;
  try {
    const { FileSystem, IntentLauncher } = await deps();
    const contentUri = await FileSystem.getContentUriAsync(current.fileUri);
    await IntentLauncher.startActivityAsync('android.intent.action.VIEW', {
      data: contentUri,
      type: APK_MIME,
      flags: 1, // Intent.FLAG_GRANT_READ_URI_PERMISSION
    });
    publish({ ...current, installAttempted: true });
  } catch (error: any) {
    publish({ ...current, installAttempted: true });
    console.warn('[android-update] install intent failed', error?.message || error);
  }
}

/** 「设置 → 安装未知应用 → Agent Network」那一页。 */
export async function openUnknownSourcesSettings(): Promise<void> {
  const { IntentLauncher } = await deps();
  try {
    await IntentLauncher.startActivityAsync('android.settings.MANAGE_UNKNOWN_APP_SOURCES', { data: UNKNOWN_SOURCES_SETTINGS_DATA });
  } catch {
    // 个别 ROM 不认带 package 的形式:退回应用详情页。
    await IntentLauncher.startActivityAsync('android.settings.APPLICATION_DETAILS_SETTINGS', { data: UNKNOWN_SOURCES_SETTINGS_DATA }).catch(() => undefined);
  }
}

/** 「在浏览器中下载」:优先直链,没有就 release 页面。 */
export async function openApkInBrowser(): Promise<void> {
  const rel = releaseOf(state);
  const { openURL } = await deps();
  await openURL(rel?.apk.url || rel?.releaseUrl || ANDROID_RELEASES_PAGE);
}

/** 测试用:把模块状态复位。 */
export function __resetAndroidUpdaterForTest(injected?: Deps, opts: { stallMs?: number } = {}) {
  testDeps = injected;
  stallMs = opts.stallMs ?? 45_000;
  state = { kind: 'idle' };
  lastCheckedAt = undefined;
  checkInFlight = undefined;
  resumable = undefined;
  resumableVersion = undefined;
  dismissed = false;
}
