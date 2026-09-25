// 安卓更新流程(android-updater.ts)在假的 expo-file-system / expo-intent-launcher 上走一遍:
// 检查 → 有新版 → 下载(进度)→ 交给系统安装器 → 回来了显示引导;以及停滞续传、404、大小不符、已是最新、浏览器兜底。
import {
  __resetAndroidUpdaterForTest,
  androidUpdateSnapshot,
  checkAndroidUpdate,
  downloadAndroidUpdate,
  installAndroidUpdate,
  openApkInBrowser,
  openUnknownSourcesSettings,
} from './android-updater';

let p = 0, t = 0;
const ck = (name: string, ok: boolean) => { t++; if (ok) { p++; console.log(`PASS: ${name}`); } else console.log(`FAIL: ${name}`); };

const SIZE = 1000;
const release = (tag = 'desktop-v0.2.99') => ({
  tag_name: tag,
  html_url: `https://github.com/sleep2agi/agent-network-app/releases/tag/${tag}`,
  body: "What's new in 0.2.99:\n- x",
  assets: [{ name: `Agent.Network_${tag.replace('desktop-v', '')}_android-universal.apk`, size: SIZE, browser_download_url: 'https://github.com/dl/app.apk' }],
});
const okFetch = (body: unknown, status = 200): typeof fetch => (async () => ({ ok: status < 300, status, json: async () => body })) as any;
const noSleep = { minVisibleMs: 0, sleep: async () => {} };

type Mode = 'ok' | 'stall-then-ok' | 'stall-reject' | '404' | 'short' | 'throw';
function makeDeps(mode: Mode) {
  const files = new Map<string, number>();
  const calls = { created: 0, resumed: 0, intents: [] as any[], urls: [] as string[], deleted: [] as string[] };
  const FileSystem = {
    cacheDirectory: 'file:///cache/',
    makeDirectoryAsync: async () => {},
    readDirectoryAsync: async () => ['Agent.Network_0.2.97_android-universal.apk'],
    deleteAsync: async (u: string) => { calls.deleted.push(u); files.delete(u); },
    getInfoAsync: async (u: string) => (files.has(u) ? { exists: true, size: files.get(u) } : { exists: false }),
    getContentUriAsync: async (u: string) => u.replace('file:///cache/', 'content://com.anonymous.agentnetworkapp.FileSystemFileProvider/cached_expo_files/'),
    createDownloadResumable: (_url: string, fileUri: string, _o: unknown, cb: (p: any) => void) => {
      calls.created++;
      let attempt = 0;
      let pausedResolve: ((v: undefined) => void) | undefined;
      let pausedReject: ((e: Error) => void) | undefined;
      const run = async () => {
        attempt++;
        if (mode === 'throw') throw new Error('Unable to resolve host "github.com"');
        if ((mode === 'stall-then-ok' || mode === 'stall-reject') && attempt === 1) {
          cb({ totalBytesWritten: 300, totalBytesExpectedToWrite: SIZE });
          return new Promise((resolve, reject) => { pausedResolve = resolve; pausedReject = reject; }); // hangs until pauseAsync
        }
        cb({ totalBytesWritten: 500, totalBytesExpectedToWrite: SIZE });
        cb({ totalBytesWritten: SIZE, totalBytesExpectedToWrite: SIZE });
        files.set(fileUri, mode === 'short' ? SIZE - 1 : SIZE);
        return { status: mode === '404' ? 404 : 200, uri: fileUri };
      };
      return {
        downloadAsync: run,
        resumeAsync: async () => { calls.resumed++; return run(); },
        // 有的实现 pause 后 downloadAsync 以 undefined 结束,有的以「Socket closed」之类的错误结束 —— 两种都要当成停滞。
        pauseAsync: async () => { if (mode === 'stall-reject') pausedReject?.(new Error('Socket closed')); else pausedResolve?.(undefined); return { resumeData: 'r' }; },
        savable: () => ({ resumeData: mode === 'stall-then-ok' ? 'r' : undefined }),
      };
    },
  };
  const IntentLauncher = { startActivityAsync: async (action: string, params: any) => { calls.intents.push({ action, ...params }); return { resultCode: 0 }; } };
  return { deps: { FileSystem, IntentLauncher, openURL: async (u: string) => { calls.urls.push(u); } }, calls, files };
}

// 1. up to date
{
  const { deps } = makeDeps('ok');
  __resetAndroidUpdaterForTest(deps);
  const s = await checkAndroidUpdate('0.2.99', { fetchImpl: okFetch(release()), ...noSleep });
  ck('same version → up-to-date', s.kind === 'up-to-date');
}
// 2. check error
{
  const { deps } = makeDeps('ok');
  __resetAndroidUpdaterForTest(deps);
  const s = await checkAndroidUpdate('0.2.98', { fetchImpl: okFetch({}, 403), ...noSleep });
  ck('HTTP 403 → error state carrying the status', s.kind === 'error' && s.message === 'GitHub 403');
}
// 3. happy path
{
  const { deps, calls } = makeDeps('ok');
  __resetAndroidUpdaterForTest(deps);
  const s = await checkAndroidUpdate('0.2.98', { fetchImpl: okFetch(release()), ...noSleep });
  ck('newer → available', s.kind === 'available' && s.version === '0.2.99');
  await downloadAndroidUpdate();
  const st = androidUpdateSnapshot();
  ck('download finished → ready and install attempted', st.kind === 'ready' && st.installAttempted);
  ck('old APKs in the cache are cleaned', calls.deleted.includes('file:///cache/updates/Agent.Network_0.2.97_android-universal.apk'));
  const intent = calls.intents[0];
  ck('installer opened with ACTION_VIEW', intent?.action === 'android.intent.action.VIEW');
  ck('installer gets a content:// uri (not file://)', typeof intent?.data === 'string' && intent.data.startsWith('content://') && intent.data.endsWith('Agent.Network_0.2.99_android-universal.apk'));
  ck('installer gets the APK mime type', intent?.type === 'application/vnd.android.package-archive');
  ck('installer gets FLAG_GRANT_READ_URI_PERMISSION', intent?.flags === 1);
  await openUnknownSourcesSettings();
  ck('settings shortcut opens MANAGE_UNKNOWN_APP_SOURCES for this package', calls.intents[1]?.action === 'android.settings.MANAGE_UNKNOWN_APP_SOURCES' && calls.intents[1]?.data === 'package:com.anonymous.agentnetworkapp');
  await installAndroidUpdate();
  ck('reinstall re-launches the installer', calls.intents.length === 3 && calls.intents[2].action === 'android.intent.action.VIEW');
  // tapping the row again while ready does not re-check (keeps the downloaded file)
  const again = await checkAndroidUpdate('0.2.98', { fetchImpl: (async () => { throw new Error('should not fetch'); }) as any, ...noSleep });
  ck('tapping again while ready re-opens instead of re-checking', again.kind === 'ready');
}
// 4. already downloaded file with the right size → no second download
{
  const { deps, calls, files } = makeDeps('ok');
  __resetAndroidUpdaterForTest(deps);
  files.set('file:///cache/updates/Agent.Network_0.2.99_android-universal.apk', SIZE);
  await checkAndroidUpdate('0.2.98', { fetchImpl: okFetch(release()), ...noSleep });
  await downloadAndroidUpdate();
  ck('complete cached APK is reused', calls.created === 0 && androidUpdateSnapshot().kind === 'ready');
}
// 5. stall → error → retry resumes
{
  const { deps, calls } = makeDeps('stall-then-ok');
  __resetAndroidUpdaterForTest(deps, { stallMs: 30 });
  await checkAndroidUpdate('0.2.98', { fetchImpl: okFetch(release()), ...noSleep });
  await downloadAndroidUpdate();
  const s = androidUpdateSnapshot();
  ck('stalled download → download-error 下载太慢或已中断', s.kind === 'download-error' && s.message === '下载太慢或已中断');
  await openApkInBrowser();
  ck('browser fallback opens the APK url', calls.urls[0] === 'https://github.com/dl/app.apk');
  await downloadAndroidUpdate();
  ck('retry resumes the same download (resumeAsync, no new resumable)', calls.created === 1 && calls.resumed === 1);
  ck('resumed download completes', androidUpdateSnapshot().kind === 'ready');
}
// 5b. pause surfaces as a rejection → still reported as a stall and resumable
{
  const { deps, calls } = makeDeps('stall-reject');
  __resetAndroidUpdaterForTest(deps, { stallMs: 30 });
  await checkAndroidUpdate('0.2.98', { fetchImpl: okFetch(release()), ...noSleep });
  await downloadAndroidUpdate();
  const s = androidUpdateSnapshot();
  ck('stall that rejects → 下载太慢或已中断 (not 网络不通)', s.kind === 'download-error' && s.message === '下载太慢或已中断');
  await downloadAndroidUpdate();
  ck('stall that rejects → retry still resumes', calls.created === 1 && calls.resumed === 1);
}
// 6. 404
{
  const { deps } = makeDeps('404');
  __resetAndroidUpdaterForTest(deps);
  await checkAndroidUpdate('0.2.98', { fetchImpl: okFetch(release()), ...noSleep });
  await downloadAndroidUpdate();
  const s = androidUpdateSnapshot();
  ck('HTTP 404 body is not installed', s.kind === 'download-error' && s.message === '安装包地址不可用(404)');
}
// 7. truncated
{
  const { deps, calls } = makeDeps('short');
  __resetAndroidUpdaterForTest(deps);
  await checkAndroidUpdate('0.2.98', { fetchImpl: okFetch(release()), ...noSleep });
  await downloadAndroidUpdate();
  const s = androidUpdateSnapshot();
  ck('size mismatch → error, never handed to the installer', s.kind === 'download-error' && s.message === '安装包不完整' && calls.intents.length === 0);
}
// 8. network failure → next try starts over (no resume data)
{
  const { deps, calls } = makeDeps('throw');
  __resetAndroidUpdaterForTest(deps);
  await checkAndroidUpdate('0.2.98', { fetchImpl: okFetch(release()), ...noSleep });
  await downloadAndroidUpdate();
  ck('network failure → 网络不通', (androidUpdateSnapshot() as any).message === '网络不通');
  await downloadAndroidUpdate();
  ck('without resume data the retry creates a fresh download', calls.created === 2 && calls.resumed === 0);
}

console.log(`\n${p}/${t} passed`);
if (p !== t) process.exit(1);
