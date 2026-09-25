import { describeUpdateRow, type UpdateRowView } from './update-check-state';

/**
 * 安卓端「检查更新」的纯逻辑(Vincent 2026-09-25「安卓APP它点击更新的时候，它好像更新不了」)。
 *
 * 桌面端走 Tauri updater + latest.json,而 latest.json 只列 darwin-aarch64 / windows-x86_64;
 * 安卓以前点「检查更新」直接落到 `unsupported`(没有 __TAURI_INTERNALS__),那一行随即变灰、不可点。
 * 安卓包一直作为 `Agent.Network_<ver>_android-universal.apk` 挂在 GitHub release `desktop-v<ver>` 上,
 * 这里负责:比版本、从 release JSON 里挑 APK、把 app.json 的 versionName 映射成单调递增的 versionCode。
 * 没有任何 React Native / expo 依赖,ck 测试直接跑。
 */

export const ANDROID_RELEASES_REPO = 'sleep2agi/agent-network-app';
export const ANDROID_LATEST_RELEASE_API = `https://api.github.com/repos/${ANDROID_RELEASES_REPO}/releases/latest`;
export const ANDROID_RELEASES_PAGE = `https://github.com/${ANDROID_RELEASES_REPO}/releases/latest`;
/** app.json expo.android.package —— version-consistency.test.ts 守着两边一致。 */
export const ANDROID_PACKAGE = 'com.anonymous.agentnetworkapp';
export const APK_MIME = 'application/vnd.android.package-archive';

/** `0.2.98` / `v0.2.98` / `desktop-v0.2.98` → [0, 2, 98];认不出返回 null(不当成 0.0.0)。 */
export function parseVersion(raw: string | null | undefined): [number, number, number] | null {
  const m = /^(?:desktop-)?v?(\d+)\.(\d+)\.(\d+)$/.exec(String(raw ?? '').trim());
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

/** a > b → 1,a < b → -1,相等 → 0。任一边认不出 → null(调用方必须当成「无法判断」,不能当成「没有更新」)。 */
export function compareVersions(a: string, b: string): -1 | 0 | 1 | null {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  if (!pa || !pb) return null;
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return pa[i] > pb[i] ? 1 : -1;
  }
  return 0;
}

/**
 * versionCode = major * 1_000_000 + minor * 1_000 + patch(0.2.98 → 2098)。
 * minor / patch 各占三位,所以只要都 < 1000,顺序就和 semver 一致;major ≤ 2099 保证低于
 * Google Play / Android 的上限 2_100_000_000。已安装的旧包 versionCode 都是 1,任何 ≥ 0.0.2 的值都比它大。
 * 越界直接抛 —— 宁可让发版 bump 的 PR 红,也不要悄悄生成一个会倒序的号。
 */
export function androidVersionCode(version: string): number {
  const v = parseVersion(version);
  if (!v || /^desktop-|^v/.test(version.trim())) throw new Error(`versionCode: not a plain major.minor.patch version: ${version}`);
  const [major, minor, patch] = v;
  if (minor > 999 || patch > 999) throw new Error(`versionCode: minor/patch must be < 1000 (got ${version})`);
  const code = major * 1_000_000 + minor * 1_000 + patch;
  if (code < 2 || code >= 2_100_000_000) throw new Error(`versionCode ${code} for ${version} is outside 2..2099999999`);
  return code;
}

export type ReleaseAsset = { name?: string; size?: number; browser_download_url?: string; content_type?: string };
export type ReleaseJson = {
  tag_name?: string;
  name?: string;
  body?: string | null;
  html_url?: string;
  draft?: boolean;
  prerelease?: boolean;
  assets?: ReleaseAsset[];
};
export type ApkAsset = { name: string; url: string; size?: number };

/**
 * 从 release 里挑安卓包。优先 `_<ver>_android-universal.apk`(版本号必须和 tag 一致,
 * 否则一个手工传错的旧包会被当成新版);没有 universal 时退回 tag 版本号相同的任意 .apk。
 */
export function pickAndroidApk(release: ReleaseJson): ApkAsset | null {
  const version = parseVersion(release.tag_name)?.join('.');
  if (!version) return null;
  const assets = (release.assets ?? []).filter(a => a && typeof a.name === 'string' && typeof a.browser_download_url === 'string');
  const toApk = (a: ReleaseAsset): ApkAsset => ({
    name: a.name!,
    url: a.browser_download_url!,
    size: typeof a.size === 'number' && a.size > 0 ? a.size : undefined,
  });
  const universal = assets.find(a => a.name === `Agent.Network_${version}_android-universal.apk`);
  if (universal) return toApk(universal);
  const anyApk = assets.find(a => a.name!.toLowerCase().endsWith('.apk') && a.name!.includes(`_${version}_`));
  return anyApk ? toApk(anyApk) : null;
}

export type AndroidUpdateState =
  | { kind: 'idle' | 'checking' }
  | { kind: 'up-to-date'; latest: string }
  | { kind: 'error'; message: string }
  | { kind: 'available'; version: string; notes: string; apk: ApkAsset; releaseUrl: string }
  | { kind: 'downloading'; version: string; notes: string; apk: ApkAsset; releaseUrl: string; percent?: number }
  | { kind: 'download-error'; version: string; notes: string; apk: ApkAsset; releaseUrl: string; message: string }
  | { kind: 'ready'; version: string; notes: string; apk: ApkAsset; releaseUrl: string; fileUri: string; installAttempted: boolean };

export type AndroidReleaseVerdict =
  | { kind: 'up-to-date'; latest: string }
  | { kind: 'available'; version: string; notes: string; apk: ApkAsset; releaseUrl: string }
  | { kind: 'error'; message: string };

export function evaluateAndroidRelease(release: ReleaseJson | null | undefined, currentVersion: string): AndroidReleaseVerdict {
  if (!release || typeof release !== 'object') return { kind: 'error', message: '更新清单格式错误' };
  const latest = parseVersion(release.tag_name)?.join('.');
  if (!latest) return { kind: 'error', message: `更新清单格式错误(无法识别版本 ${String(release.tag_name ?? '')})` };
  const cmp = compareVersions(latest, currentVersion);
  if (cmp === null) return { kind: 'error', message: `无法识别当前版本 ${currentVersion}` };
  if (cmp <= 0) return { kind: 'up-to-date', latest };
  const apk = pickAndroidApk(release);
  if (!apk) return { kind: 'error', message: `新版本 v${latest} 还没有安卓安装包` };
  return {
    kind: 'available',
    version: latest,
    notes: String(release.body ?? '').trim() || '此版本包含功能改进和问题修复。',
    apk,
    releaseUrl: typeof release.html_url === 'string' && release.html_url ? release.html_url : ANDROID_RELEASES_PAGE,
  };
}

/** 缓存目录里的安装包文件名;只允许版本号字符,防止 release JSON 里的名字带路径。 */
export function apkCacheFileName(version: string): string {
  const v = parseVersion(version)?.join('.');
  if (!v) throw new Error(`bad version ${version}`);
  return `Agent.Network_${v}_android-universal.apk`;
}

export function downloadPercent(written: number, expected: number | undefined): number | undefined {
  if (!expected || expected <= 0 || !Number.isFinite(written)) return undefined;
  return Math.max(0, Math.min(100, Math.floor((written * 100) / expected)));
}

/** 下载失败 → 一句人能看懂的原因(原始 message 仍留给日志)。 */
export function downloadErrorReason(message: string | null | undefined): string {
  const raw = String(message ?? '').trim();
  const m = raw.toLowerCase();
  if (!raw) return '下载失败';
  if (/stall|timed? ?out|timeout|too slow/.test(m)) return '下载太慢或已中断';
  if (/\b(403|429)\b|rate limit/.test(m)) return 'GitHub 拒绝了请求(可能被限流)';
  if (/\b404\b|not found/.test(m)) return '安装包地址不可用(404)';
  if (/\b5\d\d\b/.test(m)) return 'GitHub 服务器暂时不可用';
  if (/size mismatch|incomplete|truncat/.test(m)) return '安装包不完整';
  if (/space|enospc|no space/.test(m)) return '手机存储空间不足';
  if (/network|unreachable|dns|resolve|connect|offline|socket|ssl|tls|certificate|unable to resolve host|failed to connect/.test(m)) return '网络不通';
  return raw.length > 60 ? `${raw.slice(0, 57)}…` : raw;
}

/** 装不上时的说明:放进弹窗里,用户读得懂、知道点哪里。 */
export const INSTALL_PERMISSION_HINT =
  '如果系统提示「禁止安装未知来源的应用」:点下面的「去设置允许安装」,把 Agent Network 的「允许来自此来源的应用」打开,返回后点「重新安装」。\n' +
  '小米 / 红米(MIUI、HyperOS)还可能弹出「安全守护」或「纯净模式」拦截:选择「继续安装」,或在 设置 → 应用设置 → 纯净模式 里暂时关闭。';

/** `package:<id>` —— MANAGE_UNKNOWN_APP_SOURCES 直达本应用那一页。 */
export const UNKNOWN_SOURCES_SETTINGS_DATA = `package:${ANDROID_PACKAGE}`;

/** 设置页「软件更新」那一行(安卓)。检查阶段与桌面端同一套文案;下载/安装阶段点一下就把弹窗叫回来。 */
export function describeAndroidUpdateRow(
  state: AndroidUpdateState,
  opts: { currentVersion: string; lastCheckedAt?: number; now: number },
): UpdateRowView {
  switch (state.kind) {
    case 'up-to-date':
      return describeUpdateRow({ kind: 'up-to-date' }, opts);
    case 'error': {
      const rateLimited = /GitHub (403|429)/.test(state.message);
      return rateLimited
        ? { label: '检查更新失败：GitHub 限流,请稍后再试', detail: '点击重试', tone: 'danger', busy: false, actionable: true }
        : describeUpdateRow({ kind: 'error', message: state.message }, opts);
    }
    case 'available':
      return describeUpdateRow({ kind: 'available', version: state.version, notes: state.notes }, opts);
    case 'downloading':
      return {
        label: `正在下载 v${state.version}${state.percent == null ? '' : ` ${state.percent}%`}`,
        detail: '点击查看进度', tone: 'accent', busy: true, actionable: true,
      };
    case 'download-error':
      return { label: `下载失败：${state.message}`, detail: '点击重试或在浏览器中下载', tone: 'danger', busy: false, actionable: true };
    case 'ready':
      return { label: `v${state.version} 安装包已下载`, detail: '点击安装', tone: 'accent', busy: false, actionable: true };
    case 'checking':
      return describeUpdateRow({ kind: 'checking' }, opts);
    case 'idle':
    default:
      return describeUpdateRow({ kind: 'idle' }, opts);
  }
}

/** 更新弹窗该不该显示:有新版本/下载中/下载失败/已下载时显示,除非用户点了「稍后」(下载中不能关)。 */
export function androidPromptVisible(state: AndroidUpdateState, dismissed: boolean): boolean {
  if (state.kind === 'downloading') return true;
  if (state.kind === 'available' || state.kind === 'download-error' || state.kind === 'ready') return !dismissed;
  return false;
}
