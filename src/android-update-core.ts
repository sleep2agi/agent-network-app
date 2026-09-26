import { describeUpdateRow, formatCheckedAt, type UpdateRowView } from './update-check-state';
import type { UpdateRoute } from './update-route';

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

/**
 * 国内镜像(app#374 modelscope-mirror,布局见 docs/desktop-release-sop.md 第 10 节)。安卓检查更新**先问它**:
 * GitHub 未登录 REST API 每个出口 IP 每小时只有 60 次,共享 VPN 出口很快用完(0.2.100 真机:
 * 「检查更新失败：GitHub 限流」),77 MB 的 APK 从 GitHub 下在国内也慢。
 *
 *   desktop/latest/VERSION           "<ver>\n" —— 镜像最新版(只前进,不回滚)
 *   desktop/<ver>/SHA256SUMS         `sha256sum` 格式,basename,含 Agent.Network_<ver>_android-universal.apk
 *   desktop/<ver>/latest.json        Tauri 清单,notes 字段 = release 正文(本版说明从这里拿,不打 GitHub)
 *   desktop/<ver>/Agent.Network_<ver>_android-universal.apk   与 GitHub 资产逐字节相同
 *
 * 下载用带版本号的路径,不用 desktop/latest/ 下那份无版本号的副本:后者在镜像推进时会被换掉,下到一半会串版本。
 */
export const MIRROR_BASE = 'https://modelscope.cn/datasets/SmartFlowAI/agent-network-releases/resolve/master';
export const MIRROR_VERSION_URL = `${MIRROR_BASE}/desktop/latest/VERSION`;
export const MIRROR_LATEST_APK_URL = `${MIRROR_BASE}/desktop/latest/Agent.Network_android-universal.apk`;
export const mirrorSumsUrl = (version: string) => `${MIRROR_BASE}/desktop/${plainVersion(version)}/SHA256SUMS`;
export const mirrorManifestUrl = (version: string) => `${MIRROR_BASE}/desktop/${plainVersion(version)}/latest.json`;
export const mirrorApkUrl = (version: string) => `${MIRROR_BASE}/desktop/${plainVersion(version)}/${apkCacheFileName(version)}`;
/** GitHub 资产的直链(releases/download,不是 REST API,不占那 60 次/小时)。镜像下载失败时的第二来源。 */
export const githubApkUrl = (version: string) =>
  `https://github.com/${ANDROID_RELEASES_REPO}/releases/download/desktop-v${plainVersion(version)}/${apkCacheFileName(version)}`;
export const githubReleasePage = (version: string) => `https://github.com/${ANDROID_RELEASES_REPO}/releases/tag/desktop-v${plainVersion(version)}`;
export const DEFAULT_RELEASE_NOTES = '此版本包含功能改进和问题修复。';

function plainVersion(version: string): string {
  const v = parseVersion(version)?.join('.');
  if (!v) throw new Error(`bad version ${version}`);
  return v;
}
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

export type ReleaseAsset = { name?: string; size?: number; browser_download_url?: string; content_type?: string; digest?: string | null };
export type ReleaseJson = {
  tag_name?: string;
  name?: string;
  body?: string | null;
  html_url?: string;
  draft?: boolean;
  prerelease?: boolean;
  assets?: ReleaseAsset[];
};
/**
 * url = 首选下载地址;fallbackUrl = 首选地址硬失败(HTTP 错误/网络错误/校验不符)后改用的地址。
 * sha256 = 期望的小写十六进制摘要;镜像来源取自 SHA256SUMS,GitHub 来源取自资产的 `digest`。
 * 没有 sha256 的包不会交给安装器(下载阶段拒绝,见 android-updater.ts)。
 */
export type ApkAsset = { name: string; url: string; size?: number; sha256?: string; fallbackUrl?: string; source?: 'mirror' | 'github' };

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
    sha256: githubDigestSha256(a.digest),
    source: 'github',
  });
  const universal = assets.find(a => a.name === `Agent.Network_${version}_android-universal.apk`);
  if (universal) return toApk(universal);
  const anyApk = assets.find(a => a.name!.toLowerCase().endsWith('.apk') && a.name!.includes(`_${version}_`));
  return anyApk ? toApk(anyApk) : null;
}

/** 一个来源的一次下载尝试失败了:哪个、为什么(已翻成人话)。内部用,不展示。 */
export type RouteAttempt = { route: UpdateRoute; reason: string };
/** 下载中的附加信息:走的哪个来源(内部)、已下多少、是不是从另一个切过来的(内部)。 */
export type DownloadProgress = {
  route?: UpdateRoute;
  percent?: number;
  written?: number;
  total?: number;
  verifying?: boolean;
  /** 首选来源失败、已自动切到当前来源时,首选那个为什么失败(内部)。 */
  fallbackFrom?: RouteAttempt;
};

export type AndroidUpdateState =
  | { kind: 'idle' | 'checking' }
  | { kind: 'up-to-date'; latest: string; route?: UpdateRoute }
  | { kind: 'error'; message: string; rateLimitResetAt?: number }
  | { kind: 'available'; version: string; notes: string; apk: ApkAsset; releaseUrl: string; checkRoute?: UpdateRoute }
  | ({ kind: 'downloading'; version: string; notes: string; apk: ApkAsset; releaseUrl: string; checkRoute?: UpdateRoute } & DownloadProgress)
  | { kind: 'download-error'; version: string; notes: string; apk: ApkAsset; releaseUrl: string; checkRoute?: UpdateRoute; message: string; attempts?: RouteAttempt[] }
  | { kind: 'ready'; version: string; notes: string; apk: ApkAsset; releaseUrl: string; checkRoute?: UpdateRoute; fileUri: string; installAttempted: boolean; route?: UpdateRoute };

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
    notes: String(release.body ?? '').trim() || DEFAULT_RELEASE_NOTES,
    apk,
    releaseUrl: typeof release.html_url === 'string' && release.html_url ? release.html_url : ANDROID_RELEASES_PAGE,
  };
}

/** GitHub 资产的 `digest`(`sha256:<64 hex>`)→ 小写 hex;没有或不是 sha256 → undefined。 */
export function githubDigestSha256(digest: string | null | undefined): string | undefined {
  const m = /^sha256:([0-9a-fA-F]{64})$/.exec(String(digest ?? '').trim());
  return m ? m[1].toLowerCase() : undefined;
}

/** desktop/latest/VERSION 的内容("0.2.101\n")→ "0.2.101";其他任何形状(HTML 错误页、空、带前缀)→ null。 */
export function parseMirrorVersion(text: string | null | undefined): string | null {
  const t = String(text ?? '').trim();
  return /^\d+\.\d+\.\d+$/.test(t) ? t : null;
}

/**
 * `sha256sum` 输出 → { 文件名: 小写 hex }。实测镜像的行形如 `<64 hex>␠␠Agent.Network_0.2.101_android-universal.apk`
 * (两个空格 = 文本模式;`sha256sum -b` 会写成 `<hex>␠*<name>`,一并认)。认不出的行跳过,不抛。
 */
export function parseSha256Sums(text: string | null | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of String(text ?? '').split(/\r?\n/)) {
    const m = /^([0-9a-fA-F]{64}) [ *](.+)$/.exec(line);
    if (m) out[m[2]] = m[1].toLowerCase();
  }
  return out;
}

/** 镜像 latest.json 里的 notes;拿不到就给通用说明 —— 说明文字永远不挡更新。 */
export function notesFromMirrorManifest(manifest: unknown, version: string): string {
  const m = manifest as { version?: unknown; notes?: unknown } | null;
  if (!m || typeof m !== 'object' || typeof m.notes !== 'string') return DEFAULT_RELEASE_NOTES;
  if (compareVersions(String(m.version ?? ''), version) !== 0) return DEFAULT_RELEASE_NOTES;
  return m.notes.trim() || DEFAULT_RELEASE_NOTES;
}

/**
 * 镜像给出的结论。`incomplete` = 镜像已经推进到更新的版本、但那一版的 SHA256SUMS 里还没有安卓包
 * (APK 是 release 发布之后才挂上去的,镜像要下一轮才补)—— 只有这时才回头问 GitHub。
 */
export type MirrorVerdict = AndroidReleaseVerdict | { kind: 'incomplete'; version: string };

export function evaluateMirror(
  input: { version: string; sums?: Record<string, string>; notes?: string; size?: number },
  currentVersion: string,
): MirrorVerdict {
  const latest = parseMirrorVersion(input.version);
  if (!latest) return { kind: 'error', message: `镜像版本号格式错误(${String(input.version).slice(0, 20)})` };
  const cmp = compareVersions(latest, currentVersion);
  if (cmp === null) return { kind: 'error', message: `无法识别当前版本 ${currentVersion}` };
  if (cmp <= 0) return { kind: 'up-to-date', latest };
  const name = apkCacheFileName(latest);
  const sha256 = input.sums?.[name];
  if (!sha256) return { kind: 'incomplete', version: latest };
  return {
    kind: 'available',
    version: latest,
    notes: String(input.notes ?? '').trim() || DEFAULT_RELEASE_NOTES,
    apk: {
      name,
      url: mirrorApkUrl(latest),
      fallbackUrl: githubApkUrl(latest),
      size: typeof input.size === 'number' && input.size > 0 ? input.size : undefined,
      sha256,
      source: 'mirror',
    },
    releaseUrl: githubReleasePage(latest),
  };
}

/**
 * GitHub REST 的失败 → 是不是限流。429 一定是;403 只有在 `x-ratelimit-remaining: 0` 时才是
 * (其他 403 —— 被封、滥用检测 —— 不该说成「稍后再试就好」)。reset 是 epoch 秒。
 */
export function githubRateLimit(status: number, headers: { get(name: string): string | null } | undefined): { limited: boolean; resetAt?: number } {
  const remaining = headers?.get('x-ratelimit-remaining');
  const limited = status === 429 || (status === 403 && remaining === '0');
  if (!limited) return { limited: false };
  const reset = Number(headers?.get('x-ratelimit-reset'));
  return Number.isFinite(reset) && reset > 0 ? { limited: true, resetAt: reset * 1000 } : { limited: true };
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
  if (/sha256 mismatch|checksum/.test(m)) return '安装包校验失败(sha256 不一致,已删除)';
  if (/no sha256/.test(m)) return '无法校验安装包(缺少 sha256)';
  if (/cannot verify/.test(m)) return '无法校验安装包(本机算不出 sha256)';
  if (/stall|timed? ?out|timeout|too slow/.test(m)) return '下载太慢或已中断';
  if (/\b(403|429)\b|rate limit/.test(m)) return '下载被服务器拒绝(403/429)';
  if (/\b404\b|not found/.test(m)) return '安装包地址不可用(404)';
  if (/\b5\d\d\b/.test(m)) return '下载服务器暂时不可用';
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
    case 'up-to-date': {
      // 「已是最新版本 v0.2.117」+「刚刚检查」。哪个来源回答的只留在内部,不展示。
      const base = describeUpdateRow({ kind: 'up-to-date' }, opts);
      return { ...base, detail: formatCheckedAt(opts.lastCheckedAt, opts.now) };
    }
    case 'error': {
      // 走到这里 = 国内镜像也没连上(镜像通的时候根本不问 GitHub)。说清楚是哪两个都不行,以及大概多久恢复。
      if (/GitHub (403|429) rate-limited/.test(state.message)) {
        const mins = state.rateLimitResetAt ? Math.max(1, Math.ceil((state.rateLimitResetAt - opts.now) / 60_000)) : undefined;
        return {
          label: '检查更新失败：国内镜像连不上,GitHub 又被限流(同一网络出口每小时 60 次)',
          detail: mins ? `约 ${mins} 分钟后恢复,可点击重试` : '请稍后点击重试',
          tone: 'danger', busy: false, actionable: true,
        };
      }
      return describeUpdateRow({ kind: 'error', message: state.message }, opts);
    }
    case 'available':
      return describeUpdateRow({ kind: 'available', version: state.version, notes: state.notes }, opts);
    case 'downloading':
      if (state.verifying) return { label: `正在校验 v${state.version} 安装包`, detail: '点击查看进度', tone: 'accent', busy: true, actionable: true };
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
