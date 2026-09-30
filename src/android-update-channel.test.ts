// 安卓专用镜像通道 android/latest/VERSION(Vincent 2026-09-30「你每次就是 modelscope 给我上传好之后，
// 我在设置里面检查更新都检查不到」)。发版时安卓包先传到 android/agent-network-<ver>.apk,
// desktop/latest/VERSION 要等桌面 release 发布 + 镜像 workflow 跑完才前进(实测 0.2.157 已上传时它还是 0.2.156)。
// 检查更新必须同时看两个通道、取较高的那个,并且各自从自己的路径下载、各自校验 sha256。
//
// 通道 URL 在这里直接写死(不从 android-update-core 导入):这个文件要能喂给**修复前**的代码,
// 证明「desktop VERSION 落后」那一条在旧代码上是红的。
import { createHash } from 'node:crypto';
import {
  __resetAndroidUpdaterForTest,
  checkAndroidUpdate,
  downloadAndroidUpdate,
  androidBrowserApkUrl,
} from './android-updater';
import { ANDROID_LATEST_RELEASE_API, MIRROR_BASE, MIRROR_VERSION_URL, githubApkUrl, mirrorApkUrl, mirrorManifestUrl, mirrorSumsUrl } from './android-update-core';
import { Sha256 } from './sha256';

let p = 0, t = 0;
const ck = (name: string, ok: boolean) => { t++; if (ok) { p++; console.log(`PASS: ${name}`); } else console.log(`FAIL: ${name}`); };

const ANDROID_VERSION = `${MIRROR_BASE}/android/latest/VERSION`;
const androidApk = (v: string) => `${MIRROR_BASE}/android/agent-network-${v}.apk`;
const androidSha = (v: string) => `${MIRROR_BASE}/android/agent-network-${v}.apk.sha256`;

const SIZE = 1000;
const APK = new Uint8Array(SIZE).map((_, i) => (i * 7) & 255);
const GOOD_SHA = createHash('sha256').update(APK).digest('hex');
const universal = (v: string) => `Agent.Network_${v}_android-universal.apk`;

type Resp = { status: number; body?: string; json?: unknown; headers?: Record<string, string> } | 'throw';
function makeFetch(routes: Record<string, Resp>) {
  const calls: string[] = [];
  const fetchImpl = (async (url: string, init?: any) => {
    const key = init?.method === 'HEAD' ? `HEAD ${url}` : url;
    calls.push(key);
    const r = routes[key] ?? { status: 404, body: '' };
    if (r === 'throw') throw new TypeError('Network request failed');
    const headers = { get: (k: string) => r.headers?.[k.toLowerCase()] ?? null };
    return { ok: r.status >= 200 && r.status < 300, status: r.status, headers, text: async () => r.body ?? JSON.stringify(r.json ?? ''), json: async () => r.json ?? JSON.parse(r.body ?? 'null') };
  }) as unknown as typeof fetch;
  return { fetchImpl, calls, gh: () => calls.filter(c => c.startsWith('https://api.github.com')).length };
}
const desktopRoutes = (v: string): Record<string, Resp> => ({
  [MIRROR_VERSION_URL]: { status: 200, body: `${v}\n` },
  [mirrorSumsUrl(v)]: { status: 200, body: `${GOOD_SHA}  ${universal(v)}\n` },
  [mirrorManifestUrl(v)]: { status: 200, json: { version: v, notes: `desktop notes ${v}` } },
  [`HEAD ${mirrorApkUrl(v)}`]: { status: 200, headers: { 'content-length': String(SIZE) } },
});
const androidRoutes = (v: string, opts: { sha?: string | null } = {}): Record<string, Resp> => ({
  [ANDROID_VERSION]: { status: 200, body: `${v}\n` },
  ...(opts.sha === null ? {} : { [androidSha(v)]: { status: 200, body: opts.sha ?? `${GOOD_SHA}  agent-network-${v}.apk\n` } }),
  [`HEAD ${androidApk(v)}`]: { status: 200, headers: { 'content-length': String(SIZE) } },
  [`${MIRROR_BASE}/android/${v}/notes.md`]: { status: 200, body: `What's new in ${v}:\n- android notes ${v}\n` },
});
const GH_500: Resp = { status: 500, body: '' };
const noSleep = { minVisibleMs: 0, sleep: async () => {} };

function makeDeps() {
  const files = new Map<string, Uint8Array>();
  const created: string[] = [];
  const FileSystem = {
    cacheDirectory: 'file:///cache/',
    makeDirectoryAsync: async () => {},
    readDirectoryAsync: async () => [],
    deleteAsync: async (u: string) => { files.delete(u); },
    getInfoAsync: async (u: string) => (files.has(u) ? { exists: true, size: files.get(u)!.length } : { exists: false }),
    getContentUriAsync: async (u: string) => u,
    createDownloadResumable: (url: string, fileUri: string) => {
      created.push(url);
      const ok = url.includes('/android/agent-network-') || url === mirrorApkUrl('0.2.157');
      return {
        downloadAsync: async () => { if (ok) files.set(fileUri, APK); return { status: ok ? 200 : 404, uri: fileUri }; },
        resumeAsync: async () => undefined,
        pauseAsync: async () => ({}),
      };
    },
  };
  const hashFile = async (uri: string) => new Sha256().update(files.get(uri)!).hex();
  return { deps: { FileSystem, IntentLauncher: { startActivityAsync: async () => ({}) }, openURL: async () => {}, hashFile }, created };
}

// 1. 事故现场:安卓通道 0.2.157,desktop/latest/VERSION 仍是 0.2.156,手机装的 0.2.156 → 必须发现 0.2.157
{
  const { deps, created } = makeDeps();
  __resetAndroidUpdaterForTest(deps);
  const f = makeFetch({ ...desktopRoutes('0.2.156'), ...androidRoutes('0.2.157'), [ANDROID_LATEST_RELEASE_API]: GH_500 });
  const s = await checkAndroidUpdate('0.2.156', { fetchImpl: f.fetchImpl, ...noSleep });
  ck('stale desktop VERSION (0.2.156) + android channel 0.2.157 → available v0.2.157', s.kind === 'available' && s.version === '0.2.157');
  ck('android channel: downloads android/agent-network-<ver>.apk', s.kind === 'available' && s.apk.url === androidApk('0.2.157'));
  ck('android channel: sha256 from android/agent-network-<ver>.apk.sha256', s.kind === 'available' && s.apk.sha256 === GOOD_SHA);
  ck('android channel: size from HEAD of the android path', s.kind === 'available' && s.apk.size === SIZE);
  ck('android channel answered: GitHub not asked', f.gh() === 0);
  await downloadAndroidUpdate();
  const after = (await import('./android-updater')).androidUpdateSnapshot();
  ck('android channel: first download hits the android path', created[0] === androidApk('0.2.157'));
  ck('android channel: verified download reaches ready', after.kind === 'ready' && after.version === '0.2.157');
  ck('browser download link for the android channel is the android path', androidBrowserApkUrl() === androidApk('0.2.157'));
}
// 2. desktop 较新(安卓通道还停在旧版)→ 走 desktop 通道,原有路径与 GitHub 兜底不变
{
  const { deps } = makeDeps();
  __resetAndroidUpdaterForTest(deps);
  const f = makeFetch({ ...desktopRoutes('0.2.157'), ...androidRoutes('0.2.156'), [ANDROID_LATEST_RELEASE_API]: GH_500 });
  const s = await checkAndroidUpdate('0.2.156', { fetchImpl: f.fetchImpl, ...noSleep });
  ck('desktop 0.2.157 newer than android 0.2.156 → available v0.2.157 from desktop', s.kind === 'available' && s.version === '0.2.157');
  ck('desktop channel: versioned desktop/<ver>/ path + GitHub fallback URL', s.kind === 'available' && s.apk.url === mirrorApkUrl('0.2.157') && s.apk.fallbackUrl === githubApkUrl('0.2.157'));
  ck('desktop channel: sha256 from desktop/<ver>/SHA256SUMS, notes from latest.json', s.kind === 'available' && s.apk.sha256 === GOOD_SHA && s.notes === 'desktop notes 0.2.157');
  ck('desktop channel: android sha file never fetched', !f.calls.includes(androidSha('0.2.156')) && !f.calls.includes(androidSha('0.2.157')));
}
// 3. 安卓通道不存在(404,今天的镜像就是这样)→ 退回 desktop,行为同以前
{
  const { deps } = makeDeps();
  __resetAndroidUpdaterForTest(deps);
  const f = makeFetch({ ...desktopRoutes('0.2.157'), [ANDROID_LATEST_RELEASE_API]: GH_500 });
  const s = await checkAndroidUpdate('0.2.156', { fetchImpl: f.fetchImpl, ...noSleep });
  ck('android channel 404 → falls back to desktop channel (available v0.2.157)', s.kind === 'available' && s.version === '0.2.157' && s.apk.url === mirrorApkUrl('0.2.157'));
  const f2 = makeFetch({ ...desktopRoutes('0.2.156'), [ANDROID_VERSION]: 'throw', [ANDROID_LATEST_RELEASE_API]: GH_500 });
  __resetAndroidUpdaterForTest(makeDeps().deps);
  const s2 = await checkAndroidUpdate('0.2.156', { fetchImpl: f2.fetchImpl, ...noSleep });
  ck('android channel network error + desktop same version → up-to-date (desktop answered)', s2.kind === 'up-to-date' && s2.latest === '0.2.156');
  ck('…and GitHub still not asked', f2.gh() === 0);
}
// 4. 安卓 VERSION 有、sha 文件没有 → 报错,绝不给出一个没法校验的包
{
  const { deps, created } = makeDeps();
  __resetAndroidUpdaterForTest(deps);
  const f = makeFetch({ ...desktopRoutes('0.2.156'), ...androidRoutes('0.2.157', { sha: null }), [ANDROID_LATEST_RELEASE_API]: GH_500 });
  const s = await checkAndroidUpdate('0.2.156', { fetchImpl: f.fetchImpl, ...noSleep });
  ck('android VERSION 0.2.157 but no sha file → error (not up-to-date, not available)', s.kind === 'error' && s.message.includes('0.2.157'));
  await downloadAndroidUpdate();
  ck('…nothing downloaded', created.length === 0);
  __resetAndroidUpdaterForTest(makeDeps().deps);
  const f2 = makeFetch({ ...desktopRoutes('0.2.156'), ...androidRoutes('0.2.157', { sha: '<html>not found</html>' }), [ANDROID_LATEST_RELEASE_API]: GH_500 });
  const s2 = await checkAndroidUpdate('0.2.156', { fetchImpl: f2.fetchImpl, ...noSleep });
  ck('android sha file unparseable → error', s2.kind === 'error');
  __resetAndroidUpdaterForTest(makeDeps().deps);
  const f3 = makeFetch({ ...desktopRoutes('0.2.156'), ...androidRoutes('0.2.157', { sha: `${GOOD_SHA}  agent-network-0.2.156.apk\n` }), [ANDROID_LATEST_RELEASE_API]: GH_500 });
  const s3 = await checkAndroidUpdate('0.2.156', { fetchImpl: f3.fetchImpl, ...noSleep });
  ck('android sha file names another version → error (never paired with the wrong APK)', s3.kind === 'error');
  __resetAndroidUpdaterForTest(makeDeps().deps);
  const f4 = makeFetch({ ...desktopRoutes('0.2.156'), ...androidRoutes('0.2.157', { sha: `${GOOD_SHA}\n` }), [ANDROID_LATEST_RELEASE_API]: GH_500 });
  const s4 = await checkAndroidUpdate('0.2.156', { fetchImpl: f4.fetchImpl, ...noSleep });
  ck('android sha file with a bare 64-hex digest is accepted', s4.kind === 'available' && s4.apk.sha256 === GOOD_SHA);
}
// 5. 两个 VERSION 都认不出(HTML 错误页)、GitHub 也不可用 → 「无法判断」,不是「已是最新」
{
  __resetAndroidUpdaterForTest(makeDeps().deps);
  const f = makeFetch({
    [MIRROR_VERSION_URL]: { status: 200, body: '<html>busy</html>' },
    [ANDROID_VERSION]: { status: 200, body: 'v0.2.157-rc' },
    [ANDROID_LATEST_RELEASE_API]: GH_500,
  });
  const s = await checkAndroidUpdate('0.2.156', { fetchImpl: f.fetchImpl, ...noSleep });
  ck('both VERSION files unparseable + GitHub down → error, not up-to-date', s.kind === 'error');
  ck('…and GitHub was asked (mirror unusable = existing fallback)', f.gh() === 1);
}
// 6. 同版本时仍然走 desktop(有 release 说明、GitHub 兜底同一字节)
{
  __resetAndroidUpdaterForTest(makeDeps().deps);
  const f = makeFetch({ ...desktopRoutes('0.2.157'), ...androidRoutes('0.2.157'), [ANDROID_LATEST_RELEASE_API]: GH_500 });
  const s = await checkAndroidUpdate('0.2.156', { fetchImpl: f.fetchImpl, ...noSleep });
  ck('both channels 0.2.157 → desktop channel (tie keeps the established path)', s.kind === 'available' && s.apk.url === mirrorApkUrl('0.2.157'));
  __resetAndroidUpdaterForTest(makeDeps().deps);
  const f2 = makeFetch({ ...desktopRoutes('0.2.157'), ...androidRoutes('0.2.157'), [ANDROID_LATEST_RELEASE_API]: GH_500 });
  const s2 = await checkAndroidUpdate('0.2.157', { fetchImpl: f2.fetchImpl, ...noSleep });
  ck('both channels = installed → up-to-date', s2.kind === 'up-to-date' && s2.latest === '0.2.157');
}

console.log(`\n${p}/${t} passed`);
if (p !== t) process.exit(1);
