// 安卓更新流程(android-updater.ts)在假的 fetch / expo-file-system / expo-intent-launcher 上走一遍:
// 镜像优先 → GitHub 兜底的检查规则;下载:镜像优先、硬失败换 GitHub、停滞续传、sha256 校验不符拒装;
// 以及原有的安装器 intent、404、大小不符、浏览器兜底。
import { createHash } from 'node:crypto';
import {
  __resetAndroidUpdaterForTest,
  androidUpdateSnapshot,
  checkAndroidUpdate,
  downloadAndroidUpdate,
  installAndroidUpdate,
  openApkInBrowser,
  openUnknownSourcesSettings,
} from './android-updater';
import { describeAndroidUpdateRow, githubApkUrl, mirrorApkUrl, mirrorManifestUrl, mirrorSumsUrl, MIRROR_VERSION_URL, ANDROID_LATEST_RELEASE_API } from './android-update-core';
import { Sha256 } from './sha256';

let p = 0, t = 0;
const ck = (name: string, ok: boolean) => { t++; if (ok) { p++; console.log(`PASS: ${name}`); } else console.log(`FAIL: ${name}`); };

// ── fixtures ──
const SIZE = 1000;
const APK = new Uint8Array(SIZE).map((_, i) => (i * 31) & 255);
const BAD = APK.map((b, i) => (i === 500 ? b ^ 1 : b)); // 同样大小,一个字节不同
const shaOf = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
const GOOD_SHA = shaOf(APK);
const apkName = (v: string) => `Agent.Network_${v}_android-universal.apk`;
const sumsFor = (v: string, sha = GOOD_SHA) => `${'0'.repeat(64)}  Agent.Network_${v}_aarch64.dmg\n${sha}  ${apkName(v)}\n`;
const ghRelease = (v: string, opts: { digest?: string | null; apk?: boolean } = {}) => ({
  tag_name: `desktop-v${v}`,
  html_url: `https://github.com/sleep2agi/agent-network-app/releases/tag/desktop-v${v}`,
  body: `What's new in ${v}:\n- from github`,
  assets: opts.apk === false ? [] : [{
    name: apkName(v), size: SIZE, browser_download_url: githubApkUrl(v),
    ...(opts.digest === null ? {} : { digest: `sha256:${opts.digest ?? GOOD_SHA}` }),
  }],
});

type Resp = { status: number; body?: string; json?: unknown; headers?: Record<string, string> } | 'throw' | 'hang';
/** URL → 应答。没配的 URL 一律 404。记录每次请求。 */
function makeFetch(routes: Record<string, Resp>) {
  const calls: string[] = [];
  const fetchImpl = (async (url: string, init?: any) => {
    const key = init?.method === 'HEAD' ? `HEAD ${url}` : url;
    calls.push(key);
    const r = routes[key] ?? { status: 404, body: '' };
    if (r === 'throw') throw new TypeError('Network request failed');
    if (r === 'hang') return new Promise((_, reject) => init?.signal?.addEventListener?.('abort', () => { const e: any = new Error('aborted'); e.name = 'AbortError'; reject(e); }));
    const headers = { get: (k: string) => r.headers?.[k.toLowerCase()] ?? null };
    return { ok: r.status >= 200 && r.status < 300, status: r.status, headers, text: async () => r.body ?? JSON.stringify(r.json ?? ''), json: async () => r.json ?? JSON.parse(r.body ?? 'null') };
  }) as unknown as typeof fetch;
  return { fetchImpl, calls, gh: () => calls.filter(c => c.startsWith('https://api.github.com')).length };
}
const mirrorRoutes = (v: string, opts: { sums?: string | null; notes?: boolean; head?: boolean } = {}): Record<string, Resp> => ({
  [MIRROR_VERSION_URL]: { status: 200, body: `${v}\n` },
  ...(opts.sums === null ? {} : { [mirrorSumsUrl(v)]: { status: 200, body: opts.sums ?? sumsFor(v) } }),
  ...(opts.notes === false ? {} : { [mirrorManifestUrl(v)]: { status: 200, json: { version: v, notes: `What's new in ${v}:\n- from mirror` } } }),
  ...(opts.head === false ? {} : { [`HEAD ${mirrorApkUrl(v)}`]: { status: 200, headers: { 'content-length': String(SIZE) } } }),
});
const GH_403_RL = { status: 403, json: { message: 'API rate limit exceeded' }, headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(Math.floor(Date.now() / 1000) + 30 * 60) } };
const noSleep = { minVisibleMs: 0, sleep: async () => {} };

type DlMode = 'ok' | 'bad-bytes' | 'stall-then-ok' | 'stall-reject' | '404' | 'short' | 'throw';
function makeDeps(modes: Record<string, DlMode>, opts: { hashThrows?: boolean } = {}) {
  const files = new Map<string, Uint8Array>();
  const calls = { created: [] as string[], resumed: 0, hashed: 0, intents: [] as any[], urls: [] as string[], deleted: [] as string[] };
  const FileSystem = {
    cacheDirectory: 'file:///cache/',
    makeDirectoryAsync: async () => {},
    readDirectoryAsync: async () => ['Agent.Network_0.2.97_android-universal.apk'],
    deleteAsync: async (u: string) => { calls.deleted.push(u); files.delete(u); },
    getInfoAsync: async (u: string) => (files.has(u) ? { exists: true, size: files.get(u)!.length } : { exists: false }),
    getContentUriAsync: async (u: string) => u.replace('file:///cache/', 'content://com.anonymous.agentnetworkapp.FileSystemFileProvider/cached_expo_files/'),
    createDownloadResumable: (url: string, fileUri: string, _o: unknown, cb: (p: any) => void) => {
      calls.created.push(url);
      const mode = modes[url] ?? '404';
      let attempt = 0;
      let pausedResolve: ((v: undefined) => void) | undefined;
      let pausedReject: ((e: Error) => void) | undefined;
      const run = async () => {
        attempt++;
        if (mode === 'throw') throw new Error('Unable to resolve host "modelscope.cn"');
        if ((mode === 'stall-then-ok' || mode === 'stall-reject') && attempt === 1) {
          cb({ totalBytesWritten: 300, totalBytesExpectedToWrite: SIZE });
          files.set(fileUri, APK.subarray(0, 300));
          return new Promise((resolve, reject) => { pausedResolve = resolve; pausedReject = reject; }); // hangs until pauseAsync
        }
        cb({ totalBytesWritten: 500, totalBytesExpectedToWrite: SIZE });
        cb({ totalBytesWritten: SIZE, totalBytesExpectedToWrite: SIZE });
        files.set(fileUri, mode === 'short' ? APK.subarray(0, SIZE - 1) : mode === 'bad-bytes' ? BAD : APK);
        return { status: mode === '404' ? 404 : 200, uri: fileUri };
      };
      return {
        downloadAsync: run,
        resumeAsync: async () => { calls.resumed++; return run(); },
        pauseAsync: async () => { if (mode === 'stall-reject') pausedReject?.(new Error('Socket closed')); else pausedResolve?.(undefined); return { resumeData: 'r' }; },
        savable: () => ({ resumeData: 'r' }),
      };
    },
  };
  const IntentLauncher = { startActivityAsync: async (action: string, params: any) => { calls.intents.push({ action, ...params }); return { resultCode: 0 }; } };
  const hashFile = async (uri: string) => {
    calls.hashed++;
    if (opts.hashThrows) throw new Error('OOM');
    const b = files.get(uri);
    if (!b) throw new Error('no file');
    return new Sha256().update(b).hex(); // 被测的 JS 实现;sha256.test.ts 已对照 node:crypto
  };
  return { deps: { FileSystem, IntentLauncher, openURL: async (u: string) => { calls.urls.push(u); }, hashFile }, calls, files };
}
const CACHED = (v: string) => `file:///cache/updates/${apkName(v)}`;

// ════════ check ════════

// 1. mirror OK, same version → up-to-date with exactly one request (no GitHub)
{
  const { deps } = makeDeps({});
  __resetAndroidUpdaterForTest(deps);
  const f = makeFetch({ ...mirrorRoutes('0.2.101'), [ANDROID_LATEST_RELEASE_API]: GH_403_RL });
  const s = await checkAndroidUpdate('0.2.101', { fetchImpl: f.fetchImpl, ...noSleep });
  ck('mirror OK + same version → up-to-date', s.kind === 'up-to-date' && s.latest === '0.2.101');
  ck('up-to-date check costs one mirror request and zero GitHub requests', f.calls.length === 1 && f.calls[0] === MIRROR_VERSION_URL && f.gh() === 0);
}
// 2. mirror OK, newer → available from the mirror (0.2.100 installed → 0.2.101)
{
  const { deps } = makeDeps({});
  __resetAndroidUpdaterForTest(deps);
  const f = makeFetch({ ...mirrorRoutes('0.2.101'), [ANDROID_LATEST_RELEASE_API]: GH_403_RL });
  const s = await checkAndroidUpdate('0.2.100', { fetchImpl: f.fetchImpl, ...noSleep });
  ck('mirror OK + newer → available v0.2.101 (0.2.100 compares numerically)', s.kind === 'available' && s.version === '0.2.101');
  ck('available from mirror: versioned mirror URL first, GitHub download link as fallback', s.kind === 'available' && s.apk.source === 'mirror' && s.apk.url === mirrorApkUrl('0.2.101') && s.apk.fallbackUrl === githubApkUrl('0.2.101'));
  ck('sha256 comes from the mirror SHA256SUMS, size from HEAD, notes from mirrored latest.json', s.kind === 'available' && s.apk.sha256 === GOOD_SHA && s.apk.size === SIZE && s.notes.includes('from mirror'));
  // ↓ this is the owner's report: GitHub API is 403 rate-limited, but the mirror is fine → update still found
  ck('GitHub 403 rate limit does not matter while the mirror works (GitHub never asked)', f.gh() === 0);
}
// 3. mirror notes / HEAD missing → still available, generic notes, no size
{
  const { deps } = makeDeps({});
  __resetAndroidUpdaterForTest(deps);
  const f = makeFetch(mirrorRoutes('0.2.101', { notes: false, head: false }));
  const s = await checkAndroidUpdate('0.2.100', { fetchImpl: f.fetchImpl, ...noSleep });
  ck('notes/size unavailable never block the update', s.kind === 'available' && s.notes === '此版本包含功能改进和问题修复。' && s.apk.size === undefined && f.gh() === 0);
}
// 4. mirror down in each way → GitHub
for (const [label, versionResp] of [
  ['network error', 'throw'],
  ['HTTP 503', { status: 503, body: 'busy' }],
  ['HTML instead of a version', { status: 200, body: '<!doctype html><title>login</title>' }],
  ['timeout', 'hang'],
] as [string, Resp][]) {
  const { deps } = makeDeps({});
  __resetAndroidUpdaterForTest(deps, { timeouts: { mirror: 30, extras: 30, github: 200 } });
  const f = makeFetch({ [MIRROR_VERSION_URL]: versionResp, [ANDROID_LATEST_RELEASE_API]: { status: 200, json: ghRelease('0.2.101') } });
  const s = await checkAndroidUpdate('0.2.100', { fetchImpl: f.fetchImpl, ...noSleep });
  ck(`mirror down (${label}) → GitHub → available with GitHub source + digest`, s.kind === 'available' && s.apk.source === 'github' && s.apk.url === githubApkUrl('0.2.101') && s.apk.sha256 === GOOD_SHA && f.gh() === 1);
}
// 4b. mirror VERSION OK but its SHA256SUMS fails → mirror failure → GitHub
{
  const { deps } = makeDeps({});
  __resetAndroidUpdaterForTest(deps);
  const f = makeFetch({ ...mirrorRoutes('0.2.101', { sums: null }), [ANDROID_LATEST_RELEASE_API]: { status: 200, json: ghRelease('0.2.101') } });
  const s = await checkAndroidUpdate('0.2.100', { fetchImpl: f.fetchImpl, ...noSleep });
  ck('mirror SHA256SUMS 404 → GitHub', s.kind === 'available' && s.apk.source === 'github' && f.gh() === 1);
}
// 5. mirror behind GitHub (mirror 0.2.101, GitHub already 0.2.102) → trust the mirror, do not hit GitHub
{
  const { deps } = makeDeps({});
  __resetAndroidUpdaterForTest(deps);
  const f = makeFetch({ ...mirrorRoutes('0.2.101'), [ANDROID_LATEST_RELEASE_API]: { status: 200, json: ghRelease('0.2.102') } });
  const s = await checkAndroidUpdate('0.2.101', { fetchImpl: f.fetchImpl, ...noSleep });
  ck('mirror behind GitHub → up-to-date for now, GitHub not asked (next check catches up)', s.kind === 'up-to-date' && s.latest === '0.2.101' && f.gh() === 0);
  __resetAndroidUpdaterForTest(deps);
  const s2 = await checkAndroidUpdate('0.2.100', { fetchImpl: f.fetchImpl, ...noSleep });
  ck('mirror behind GitHub, installed older than both → offered the mirror version', s2.kind === 'available' && s2.version === '0.2.101' && f.gh() === 0);
}
// 6. mirror moved to 0.2.102 but its APK is not mirrored yet → GitHub consulted once
{
  const { deps } = makeDeps({});
  __resetAndroidUpdaterForTest(deps);
  const f = makeFetch({ ...mirrorRoutes('0.2.102', { sums: `${GOOD_SHA}  Agent.Network_0.2.102_aarch64.dmg\n` }), [ANDROID_LATEST_RELEASE_API]: { status: 200, json: ghRelease('0.2.102') } });
  const s = await checkAndroidUpdate('0.2.101', { fetchImpl: f.fetchImpl, ...noSleep });
  ck('mirror has the version but not the APK yet → GitHub → available from GitHub', s.kind === 'available' && s.version === '0.2.102' && s.apk.source === 'github' && f.gh() === 1);
  __resetAndroidUpdaterForTest(deps);
  const f2 = makeFetch({ ...mirrorRoutes('0.2.102', { sums: `${GOOD_SHA}  Agent.Network_0.2.102_aarch64.dmg\n` }), [ANDROID_LATEST_RELEASE_API]: GH_403_RL });
  const s2 = await checkAndroidUpdate('0.2.101', { fetchImpl: f2.fetchImpl, ...noSleep });
  ck('…and GitHub rate-limited → says the APK is syncing (not up-to-date, not 限流)', s2.kind === 'error' && s2.message.includes('v0.2.102') && s2.message.includes('同步'));
}
// 7. mirror down AND GitHub rate-limited → accurate error with reset time
{
  const { deps } = makeDeps({});
  __resetAndroidUpdaterForTest(deps);
  const f = makeFetch({ [MIRROR_VERSION_URL]: 'throw', [ANDROID_LATEST_RELEASE_API]: GH_403_RL });
  const s = await checkAndroidUpdate('0.2.100', { fetchImpl: f.fetchImpl, ...noSleep });
  ck('mirror down + GitHub 403 rate limit → error carrying the reset time', s.kind === 'error' && s.message === 'GitHub 403 rate-limited' && typeof s.rateLimitResetAt === 'number');
  const r = describeAndroidUpdateRow(s, { currentVersion: '0.2.100', now: Date.now() });
  ck('row says both sources failed and suggests retrying', r.label.includes('镜像') && r.label.includes('限流') && /约 (29|30) 分钟后恢复/.test(r.detail ?? '') && r.actionable);
  __resetAndroidUpdaterForTest(deps);
  const f2 = makeFetch({ [MIRROR_VERSION_URL]: 'throw', [ANDROID_LATEST_RELEASE_API]: { status: 403, json: {}, headers: { 'x-ratelimit-remaining': '40' } } });
  const s2 = await checkAndroidUpdate('0.2.100', { fetchImpl: f2.fetchImpl, ...noSleep });
  ck('403 with quota left is not called rate-limiting', s2.kind === 'error' && s2.message === 'GitHub 403');
}

// ════════ download ════════
const mirrorModes = (m: DlMode, g: DlMode = 'ok') => ({ [mirrorApkUrl('0.2.101')]: m, [githubApkUrl('0.2.101')]: g });
const checkMirrorOk = async (current = '0.2.100') =>
  checkAndroidUpdate(current, { fetchImpl: makeFetch(mirrorRoutes('0.2.101')).fetchImpl, ...noSleep });

// 8. happy path from the mirror + installer intent details
{
  const { deps, calls } = makeDeps(mirrorModes('ok'));
  __resetAndroidUpdaterForTest(deps);
  await checkMirrorOk();
  await downloadAndroidUpdate();
  const st = androidUpdateSnapshot();
  ck('download from the versioned mirror URL (not desktop/latest, not GitHub)', calls.created.length === 1 && calls.created[0] === mirrorApkUrl('0.2.101'));
  ck('verified then ready and install attempted', calls.hashed === 1 && st.kind === 'ready' && st.installAttempted);
  ck('old APKs in the cache are cleaned', calls.deleted.includes('file:///cache/updates/Agent.Network_0.2.97_android-universal.apk'));
  const intent = calls.intents[0];
  ck('installer opened with ACTION_VIEW', intent?.action === 'android.intent.action.VIEW');
  ck('installer gets a content:// uri (not file://)', typeof intent?.data === 'string' && intent.data.startsWith('content://') && intent.data.endsWith(apkName('0.2.101')));
  ck('installer gets the APK mime type', intent?.type === 'application/vnd.android.package-archive');
  ck('installer gets FLAG_GRANT_READ_URI_PERMISSION', intent?.flags === 1);
  await openUnknownSourcesSettings();
  ck('settings shortcut opens MANAGE_UNKNOWN_APP_SOURCES for this package', calls.intents[1]?.action === 'android.settings.MANAGE_UNKNOWN_APP_SOURCES' && calls.intents[1]?.data === 'package:com.anonymous.agentnetworkapp');
  await installAndroidUpdate();
  ck('reinstall re-launches the installer', calls.intents.length === 3 && calls.intents[2].action === 'android.intent.action.VIEW');
  const again = await checkAndroidUpdate('0.2.100', { fetchImpl: (async () => { throw new Error('should not fetch'); }) as any, ...noSleep });
  ck('tapping again while ready re-opens instead of re-checking', again.kind === 'ready');
}
// 9. sha mismatch
{
  const { deps, calls, files } = makeDeps(mirrorModes('bad-bytes', 'ok'));
  __resetAndroidUpdaterForTest(deps);
  await checkMirrorOk();
  await downloadAndroidUpdate();
  ck('mirror bytes fail sha256 → falls back to GitHub, whose bytes pass → ready', calls.created.join(',') === `${mirrorApkUrl('0.2.101')},${githubApkUrl('0.2.101')}` && androidUpdateSnapshot().kind === 'ready' && files.get(CACHED('0.2.101')) !== undefined && shaOf(files.get(CACHED('0.2.101'))!) === GOOD_SHA);
}
{
  const { deps, calls, files } = makeDeps(mirrorModes('bad-bytes', 'bad-bytes'));
  __resetAndroidUpdaterForTest(deps);
  await checkMirrorOk();
  await downloadAndroidUpdate();
  const s = androidUpdateSnapshot();
  ck('sha256 mismatch on every source → rejected, never handed to the installer', s.kind === 'download-error' && s.message === '安装包校验失败(sha256 不一致,已删除)' && calls.intents.length === 0);
  ck('the mismatching file is deleted', !files.has(CACHED('0.2.101')));
}
// 10. GitHub-sourced: asset digest is the reference
{
  const { deps, calls } = makeDeps({ [githubApkUrl('0.2.101')]: 'bad-bytes' });
  __resetAndroidUpdaterForTest(deps);
  await checkAndroidUpdate('0.2.100', { fetchImpl: makeFetch({ [MIRROR_VERSION_URL]: 'throw', [ANDROID_LATEST_RELEASE_API]: { status: 200, json: ghRelease('0.2.101') } }).fetchImpl, ...noSleep });
  await downloadAndroidUpdate();
  const s = androidUpdateSnapshot();
  ck('GitHub source: bytes not matching the asset digest → rejected', s.kind === 'download-error' && s.message.includes('校验失败') && calls.intents.length === 0);
}
{
  const { deps, calls } = makeDeps({ [githubApkUrl('0.2.101')]: 'ok' });
  __resetAndroidUpdaterForTest(deps);
  await checkAndroidUpdate('0.2.100', { fetchImpl: makeFetch({ [MIRROR_VERSION_URL]: 'throw', [ANDROID_LATEST_RELEASE_API]: { status: 200, json: ghRelease('0.2.101', { digest: null }) } }).fetchImpl, ...noSleep });
  await downloadAndroidUpdate();
  const s = androidUpdateSnapshot();
  ck('no expected sha256 at all → refuses before downloading', s.kind === 'download-error' && s.message === '无法校验安装包(缺少 sha256)' && calls.created.length === 0);
}
// 11. hashing impossible → error, no second 77 MB download
{
  const { deps, calls } = makeDeps(mirrorModes('ok'), { hashThrows: true });
  __resetAndroidUpdaterForTest(deps);
  await checkMirrorOk();
  await downloadAndroidUpdate();
  const s = androidUpdateSnapshot();
  ck('cannot compute sha256 → error (not installed, not re-downloaded from GitHub)', s.kind === 'download-error' && s.message === '无法校验安装包(本机算不出 sha256)' && calls.intents.length === 0 && calls.created.length === 1);
}
// 12. mirror download hard failures → GitHub
for (const mode of ['404', 'throw', 'short'] as DlMode[]) {
  const { deps, calls } = makeDeps(mirrorModes(mode, 'ok'));
  __resetAndroidUpdaterForTest(deps);
  await checkMirrorOk();
  await downloadAndroidUpdate();
  ck(`mirror download ${mode} → GitHub download → ready`, calls.created.length === 2 && calls.created[1] === githubApkUrl('0.2.101') && androidUpdateSnapshot().kind === 'ready');
}
// 13. both sources fail → error names the first (mirror) reason; retry starts over from the mirror
{
  const { deps, calls } = makeDeps(mirrorModes('404', 'throw'));
  __resetAndroidUpdaterForTest(deps);
  await checkMirrorOk();
  await downloadAndroidUpdate();
  const s = androidUpdateSnapshot();
  ck('both sources fail → download-error (mirror reason)', s.kind === 'download-error' && s.message === '安装包地址不可用(404)');
  await downloadAndroidUpdate();
  ck('retry after total failure starts from the mirror again', calls.created.length === 4 && calls.created[2] === mirrorApkUrl('0.2.101'));
}
{
  const { deps, calls } = makeDeps(mirrorModes('short', 'short'));
  __resetAndroidUpdaterForTest(deps);
  await checkMirrorOk();
  await downloadAndroidUpdate();
  const s = androidUpdateSnapshot();
  ck('size mismatch on both → 安装包不完整, never installed', s.kind === 'download-error' && s.message === '安装包不完整' && calls.intents.length === 0);
}
// 14. stall → error → retry resumes the same (mirror) source
for (const mode of ['stall-then-ok', 'stall-reject'] as DlMode[]) {
  const { deps, calls } = makeDeps(mirrorModes(mode));
  __resetAndroidUpdaterForTest(deps, { stallMs: 30 });
  await checkMirrorOk();
  await downloadAndroidUpdate();
  const s = androidUpdateSnapshot();
  ck(`${mode}: stalled → 下载太慢或已中断 (does not jump to GitHub)`, s.kind === 'download-error' && s.message === '下载太慢或已中断' && calls.created.length === 1);
  await openApkInBrowser();
  ck(`${mode}: 在浏览器中下载 opens the versioned mirror URL`, calls.urls[0] === mirrorApkUrl('0.2.101'));
  await downloadAndroidUpdate();
  ck(`${mode}: retry resumes the mirror download (resumeAsync, no new resumable)`, calls.created.length === 1 && calls.resumed === 1);
  ck(`${mode}: resumed download verified and ready`, androidUpdateSnapshot().kind === 'ready' && calls.hashed === 1);
}
// 15. already-downloaded file
{
  const { deps, calls, files } = makeDeps(mirrorModes('ok'));
  __resetAndroidUpdaterForTest(deps);
  files.set(CACHED('0.2.101'), APK);
  await checkMirrorOk();
  await downloadAndroidUpdate();
  ck('complete cached APK with the right sha256 is reused', calls.created.length === 0 && calls.hashed === 1 && androidUpdateSnapshot().kind === 'ready');
}
{
  const { deps, calls, files } = makeDeps(mirrorModes('ok'));
  __resetAndroidUpdaterForTest(deps);
  files.set(CACHED('0.2.101'), BAD); // right size, wrong bytes
  await checkMirrorOk();
  await downloadAndroidUpdate();
  ck('cached APK of the right size but wrong sha256 is re-downloaded', calls.created.length === 1 && calls.hashed === 2 && androidUpdateSnapshot().kind === 'ready' && shaOf(files.get(CACHED('0.2.101'))!) === GOOD_SHA);
}

console.log(`\n${p}/${t} passed`);
if (p !== t) process.exit(1);
