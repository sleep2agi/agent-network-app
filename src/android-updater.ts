/**
 * 安卓端应用内更新:国内镜像(ModelScope)优先、GitHub 兜底 → 下载 universal APK(可续传、带进度)
 * → sha256 校验 → 系统安装器。
 *
 * 检查顺序(0.2.100 真机「检查更新失败：GitHub 限流」之后改的):
 *   1. 镜像 desktop/latest/VERSION(10 s)。不比当前新 → 已是最新,**不再问 GitHub**。
 *   2. 更新 → 镜像 desktop/<ver>/SHA256SUMS(必需)+ latest.json(本版说明,可缺)+ HEAD APK(大小,可缺)。
 *   3. 只有两种情况才打 GitHub REST(未登录每 IP 每小时 60 次):镜像本身失败(网络/超时/非 2xx/格式不对),
 *      或镜像已推进到新版本但那一版的安卓包还没同步(SHA256SUMS 里没有 APK)。
 *   镜像比 GitHub 慢几分钟(镜像是发版后手动 dispatch 的)时,这几分钟里会报「已是最新」,下一次检查就能看到;
 *   为了这几分钟让每次检查都去打 GitHub,正是 0.2.100 用光配额的原因,所以不这么做。
 * 下载:镜像带版本号的路径优先,硬失败(HTTP 错误/网络错误/校验不符)换 GitHub 资产直链;停滞则保留断点、下次续传同一来源。
 *
 * 纯逻辑在 android-update-core.ts;这里只是把它接到 expo-file-system / expo-intent-launcher 上,
 * 并维护一个给设置页和更新弹窗共用的状态(形状同 desktop-updater:snapshot + subscribe)。
 * 原生模块全部惰性 import —— 桌面/Web/iOS 的包里这个文件只会被引用,不会被执行。
 */
import { atLeast } from './update-check-state';
import {
  ANDROID_LATEST_RELEASE_API,
  APK_MIME,
  DEFAULT_RELEASE_NOTES,
  MIRROR_LATEST_APK_URL,
  MIRROR_VERSION_URL,
  UNKNOWN_SOURCES_SETTINGS_DATA,
  apkCacheFileName,
  downloadErrorReason,
  downloadPercent,
  evaluateAndroidRelease,
  evaluateMirror,
  githubRateLimit,
  mirrorApkUrl,
  mirrorManifestUrl,
  mirrorSumsUrl,
  notesFromMirrorManifest,
  parseMirrorVersion,
  parseSha256Sums,
  type AndroidReleaseVerdict,
  type AndroidUpdateState,
  type ApkAsset,
} from './android-update-core';
import { sha256Chunked } from './sha256';
export type { AndroidUpdateState } from './android-update-core';

type Release = { version: string; notes: string; apk: ApkAsset; releaseUrl: string };

let state: AndroidUpdateState = { kind: 'idle' };
let lastCheckedAt: number | undefined;
let checkInFlight: Promise<AndroidUpdateState> | undefined;
let resumable: any;
let resumableVersion: string | undefined;
let resumableUrl: string | undefined;
/** 本版本下一次从第几个来源开始下(0 = 镜像,1 = GitHub)。停滞续传时保持不变;全部失败后回到 0。 */
let sourceIndex = 0;
let sourceVersion: string | undefined;
/** DownloadResumable 的进度回调在创建时就定死了;续传时要换成新一轮的处理函数(停滞计时器在里面)。 */
let progressRef: ((p: { totalBytesWritten: number; totalBytesExpectedToWrite: number }) => void) | undefined;
let dismissed = false;
const listeners = new Set<() => void>();

/** 原生依赖:生产里惰性 import;ck 测试注入假的(expo 原生模块在 bun 里加载不了)。 */
type Deps = {
  FileSystem: any;
  IntentLauncher: any;
  openURL: (url: string) => Promise<unknown>;
  /** 文件 → 小写 hex sha256。 */
  hashFile: (fileUri: string, size: number | undefined) => Promise<string>;
};
let testDeps: Deps | undefined;
let stallMs = 45_000;
async function deps(): Promise<Deps> {
  if (testDeps) return testDeps;
  const FileSystem = await import('expo-file-system/legacy');
  const IntentLauncher = await import('expo-intent-launcher');
  const { Linking } = await import('react-native');
  return { FileSystem, IntentLauncher, openURL: url => Linking.openURL(url), hashFile: (uri, size) => hashApkFile(FileSystem, uri, size) };
}

/**
 * 算 APK 的 sha256。首选原生(expo-crypto → java.security.MessageDigest,77 MB 不到一秒);
 * 原生那条路不可用(模块没链进来、内存不够)才退回纯 JS 分块 —— 实测 Hermes 解释器约 2 MB/s,
 * 77 MB 要半分钟以上,所以只当兜底。两条都失败就抛:算不出来 ≠ 校验通过。
 */
async function hashApkFile(FileSystem: any, fileUri: string, size: number | undefined): Promise<string> {
  try {
    const [{ File }, Crypto] = await Promise.all([import('expo-file-system'), import('expo-crypto')]);
    const bytes = await new File(fileUri).bytes();
    const digest = await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, bytes);
    return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
  } catch (error: any) {
    console.warn('[android-update] native sha256 unavailable, hashing in JS', error?.message || error);
  }
  const total = size ?? (await FileSystem.getInfoAsync(fileUri))?.size;
  if (!total) throw new Error('cannot verify: unknown file size');
  const CHUNK = 3 * 256 * 1024; // 3 的倍数:base64 分段互不跨界
  const { base64ToBytes } = await import('./sha256');
  return sha256Chunked(total, CHUNK, async (position, length) =>
    base64ToBytes(await FileSystem.readAsStringAsync(fileUri, { encoding: 'base64', position, length })));
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

class CheckError extends Error {
  constructor(message: string, readonly rateLimitResetAt?: number) { super(message); }
}

async function fetchWithTimeout(fetchImpl: typeof fetch, url: string, init: RequestInit, timeoutMs: number) {
  const controller = typeof AbortController === 'function' ? new AbortController() : undefined;
  const timer = setTimeout(() => controller?.abort(), timeoutMs);
  try {
    return await fetchImpl(url, { ...init, signal: controller?.signal });
  } catch (error: any) {
    if (error?.name === 'AbortError') throw new Error('timeout');
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

/** 镜像上的小文本文件;非 2xx 抛。body 也在超时里(一个吐一半就卡住的连接不能把检查挂住)。 */
async function mirrorText(fetchImpl: typeof fetch, url: string, timeoutMs: number): Promise<string> {
  return withTimeout((async () => {
    const res = await fetchWithTimeout(fetchImpl, url, { headers: { 'Cache-Control': 'no-cache' } }, timeoutMs);
    if (!res.ok) throw new Error(`mirror ${res.status}`);
    return await res.text();
  })(), timeoutMs);
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([p, new Promise<T>((_, reject) => { timer = setTimeout(() => reject(new Error('timeout')), ms); })])
    .finally(() => { if (timer) clearTimeout(timer); });
}

const DEFAULT_TIMEOUTS = { mirror: 10_000, extras: 8_000, github: 15_000 };
let timeouts = { ...DEFAULT_TIMEOUTS };

type MirrorResult = ReturnType<typeof evaluateMirror>;

async function checkMirror(fetchImpl: typeof fetch, currentVersion: string): Promise<MirrorResult> {
  const raw = await mirrorText(fetchImpl, MIRROR_VERSION_URL, timeouts.mirror);
  const version = parseMirrorVersion(raw);
  if (!version) throw new Error('mirror VERSION unparseable');
  const first = evaluateMirror({ version }, currentVersion);
  if (first.kind !== 'incomplete') return first; // 已是最新(或当前版本号认不出):到此为止,不再多打一个请求
  const [sumsText, notes, size] = await Promise.all([
    mirrorText(fetchImpl, mirrorSumsUrl(version), timeouts.mirror),
    mirrorText(fetchImpl, mirrorManifestUrl(version), timeouts.extras)
      .then(text => notesFromMirrorManifest(JSON.parse(text), version))
      .catch(() => DEFAULT_RELEASE_NOTES),
    withTimeout(fetchWithTimeout(fetchImpl, mirrorApkUrl(version), { method: 'HEAD' }, timeouts.extras), timeouts.extras)
      .then(res => (res.ok ? Number(res.headers?.get?.('content-length')) : NaN))
      .then(n => (Number.isFinite(n) && n > 0 ? n : undefined))
      .catch(() => undefined),
  ]);
  return evaluateMirror({ version, sums: parseSha256Sums(sumsText), notes, size }, currentVersion);
}

async function checkGithub(fetchImpl: typeof fetch, currentVersion: string): Promise<AndroidReleaseVerdict> {
  const res = await fetchWithTimeout(fetchImpl, ANDROID_LATEST_RELEASE_API, { headers: { Accept: 'application/vnd.github+json' } }, timeouts.github);
  if (!res.ok) {
    const rl = githubRateLimit(res.status, res.headers);
    throw rl.limited ? new CheckError(`GitHub ${res.status} rate-limited`, rl.resetAt) : new Error(`GitHub ${res.status}`);
  }
  return evaluateAndroidRelease(await withTimeout(res.json(), timeouts.github), currentVersion);
}

/** 镜像优先,GitHub 兜底。规则见文件头。 */
async function resolveUpdate(fetchImpl: typeof fetch, currentVersion: string): Promise<AndroidReleaseVerdict> {
  let mirror: MirrorResult | undefined;
  try {
    mirror = await checkMirror(fetchImpl, currentVersion);
  } catch (error) {
    console.warn('[android-update] mirror check failed, asking GitHub', (error as any)?.message || error);
  }
  if (mirror && mirror.kind !== 'incomplete') return mirror;
  try {
    const gh = await checkGithub(fetchImpl, currentVersion);
    if (!mirror || gh.kind === 'available') return gh;
  } catch (error) {
    if (!mirror) throw error;
  }
  // 镜像已经知道有新版本、GitHub 这次没给出可装的包(限流/失败/还没挂 APK):告诉用户在同步,而不是「已是最新」。
  return { kind: 'error', message: `新版本 v${mirror.version} 的安卓安装包正在同步到国内镜像,请几分钟后再试` };
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
      const verdict = await atLeast(resolveUpdate(opts.fetchImpl ?? fetch, currentVersion), opts.minVisibleMs ?? 700, {
        now: () => Date.now(),
        sleep: opts.sleep ?? (ms => new Promise(resolve => setTimeout(resolve, ms))),
      });
      lastCheckedAt = Date.now();
      if (verdict.kind === 'available') dismissed = false;
      return publish(verdict.kind === 'available'
        ? { kind: 'available', version: verdict.version, notes: verdict.notes, apk: verdict.apk, releaseUrl: verdict.releaseUrl }
        : verdict);
    } catch (error: any) {
      lastCheckedAt = Date.now();
      return publish({ kind: 'error', message: error?.message || String(error), rateLimitResetAt: error?.rateLimitResetAt });
    } finally {
      checkInFlight = undefined;
    }
  })();
  return checkInFlight;
}

/**
 * 下载安装包。失败后再调一次 = 停滞的从断点续传(同一次运行、同一来源);硬失败的已经在这一次里换过来源了。
 * 装之前一定校验 sha256:镜像来源对 SHA256SUMS,GitHub 来源对资产 digest。没有期望值 / 算不出 / 不一致 → 不装。
 */
export async function downloadAndroidUpdate(): Promise<void> {
  const rel = releaseOf(state);
  if (!rel || state.kind === 'downloading') return;
  const { FileSystem, hashFile } = await deps();
  const expectedSha = rel.apk.sha256;
  if (!expectedSha) {
    publish({ ...rel, kind: 'download-error', message: downloadErrorReason('no sha256') });
    return;
  }
  const dir = `${FileSystem.cacheDirectory}updates/`;
  const fileUri = `${dir}${apkCacheFileName(rel.version)}`;
  const sources = [rel.apk.url, rel.apk.fallbackUrl].filter((u): u is string => !!u);
  if (sourceVersion !== rel.version) { sourceVersion = rel.version; sourceIndex = 0; }

  const verify = async (): Promise<boolean> => {
    publish({ ...rel, kind: 'downloading', percent: 100, verifying: true });
    try {
      return (await hashFile(fileUri, rel.apk.size)) === expectedSha;
    } catch (error: any) {
      console.warn('[android-update] sha256 failed', error?.message || error);
      throw new Error('cannot verify: sha256 failed');
    }
  };

  await FileSystem.makeDirectoryAsync(dir, { intermediates: true }).catch(() => undefined);
  // 上次已经完整下好就直接装,不再下一遍 77MB —— 但要先过 sha256(大小对得上不代表内容对)。
  const resuming = !!resumable && resumableVersion === rel.version;
  if (!resuming) {
    const existing = await FileSystem.getInfoAsync(fileUri).catch(() => undefined as any);
    if (existing?.exists && (!rel.apk.size || existing.size === rel.apk.size)) {
      let ok = false;
      try { ok = await verify(); } catch { ok = false; }
      if (ok) {
        publish({ ...rel, kind: 'ready', fileUri, installAttempted: false });
        return;
      }
    }
    if (existing?.exists) await FileSystem.deleteAsync(fileUri, { idempotent: true }).catch(() => undefined);
    await cleanupOldApks(FileSystem, dir, apkCacheFileName(rel.version));
  }

  let firstError: string | undefined;
  for (let i = sourceIndex; i < sources.length; i++) {
    sourceIndex = i;
    const outcome = await downloadFrom(sources[i], fileUri, rel);
    if (outcome.kind === 'stalled') {
      publish({ ...rel, kind: 'download-error', message: downloadErrorReason('stalled') });
      return;
    }
    if (outcome.kind === 'failed') {
      firstError ??= outcome.message;
      continue;
    }
    let ok = false;
    try {
      ok = await verify();
    } catch (error: any) {
      // 算不出摘要是本机的问题,换来源再下 77 MB 也一样算不出:直接报错,不装。
      await FileSystem.deleteAsync(fileUri, { idempotent: true }).catch(() => undefined);
      sourceIndex = 0;
      publish({ ...rel, kind: 'download-error', message: downloadErrorReason(error?.message || String(error)) });
      return;
    }
    if (ok) {
      sourceIndex = 0;
      publish({ ...rel, kind: 'ready', fileUri, installAttempted: false });
      await installAndroidUpdate();
      return;
    }
    await FileSystem.deleteAsync(fileUri, { idempotent: true }).catch(() => undefined);
    firstError ??= 'sha256 mismatch';
  }
  sourceIndex = 0; // 下次重试从镜像重新来
  publish({ ...rel, kind: 'download-error', message: downloadErrorReason(firstError) });
}

type DownloadOutcome = { kind: 'done' } | { kind: 'stalled' } | { kind: 'failed'; message: string };

/** 从一个地址下到 fileUri。停滞 → 保留断点;其他失败 → 丢掉断点、删掉半截文件(下一个来源从头下)。 */
async function downloadFrom(url: string, fileUri: string, rel: Release): Promise<DownloadOutcome> {
  const { FileSystem } = await deps();
  let stallTimer: ReturnType<typeof setTimeout> | undefined;
  let stalled = false;
  const armStall = () => {
    if (stallTimer) clearTimeout(stallTimer);
    stallTimer = setTimeout(() => {
      stalled = true;
      void resumable?.pauseAsync?.().catch(() => undefined);
    }, stallMs);
  };
  const dropPartial = async () => {
    resumable = undefined;
    resumableUrl = undefined;
    await FileSystem.deleteAsync(fileUri, { idempotent: true }).catch(() => undefined);
  };
  try {
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
    if (resumable && resumableVersion === rel.version && resumableUrl === url) {
      result = await resumable.resumeAsync();
    } else {
      resumable = FileSystem.createDownloadResumable(url, fileUri, {}, (p: { totalBytesWritten: number; totalBytesExpectedToWrite: number }) => progressRef?.(p));
      resumableVersion = rel.version;
      resumableUrl = url;
      result = await resumable.downloadAsync();
    }
    if (stalled || !result) return { kind: 'stalled' }; // pauseAsync 之后 download/resume 以 undefined 结束
    if (result.status && (result.status < 200 || result.status >= 300)) {
      await dropPartial();
      return { kind: 'failed', message: `HTTP ${result.status}` };
    }
    const info = await FileSystem.getInfoAsync(fileUri);
    if (!info.exists || (rel.apk.size && (info as any).size !== rel.apk.size)) {
      await dropPartial();
      return { kind: 'failed', message: 'size mismatch' };
    }
    resumable = undefined;
    resumableUrl = undefined;
    return { kind: 'done' };
  } catch (error: any) {
    // 停滞时我们自己 pause 的:不管底层以 undefined 还是「Socket closed」结束,都当停滞(可续传)。
    if (stalled) return { kind: 'stalled' };
    await dropPartial();
    return { kind: 'failed', message: error?.message || String(error) };
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

/** 「在浏览器中下载」:本版的首选直链(镜像来源时是 ModelScope 带版本号的地址);没有就镜像 latest 那份。 */
export async function openApkInBrowser(): Promise<void> {
  const rel = releaseOf(state);
  const { openURL } = await deps();
  await openURL(rel?.apk.url || MIRROR_LATEST_APK_URL);
}

/** 测试用:把模块状态复位。 */
export function __resetAndroidUpdaterForTest(injected?: Deps, opts: { stallMs?: number; timeouts?: Partial<typeof DEFAULT_TIMEOUTS> } = {}) {
  testDeps = injected;
  stallMs = opts.stallMs ?? 45_000;
  timeouts = { ...DEFAULT_TIMEOUTS, ...opts.timeouts };
  state = { kind: 'idle' };
  lastCheckedAt = undefined;
  checkInFlight = undefined;
  resumable = undefined;
  resumableVersion = undefined;
  resumableUrl = undefined;
  sourceIndex = 0;
  sourceVersion = undefined;
  dismissed = false;
}
