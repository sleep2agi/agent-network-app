// 下载线路(线路一 ModelScope / 线路二 GitHub)的纯逻辑 + 弹窗文案 + 桌面来源识别 + 接线。
// ck 风格:自执行,失败退出码非 0(scripts/run-tests.mjs 汇总)。
import { readdirSync, readFileSync } from 'node:fs';
import { join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  apkUrlFor,
  apkUrlForAsset,
  checkOrder,
  createRoutePrefsStore,
  formatProgressBytes,
  formatSize,
  memoryRouteStorage,
  otherRoute,
  parseRoute,
  parseRoutePreference,
  ROUTE_LABEL,
  ROUTE_LAST_OK_KEY,
  ROUTE_PREF_KEY,
  ROUTE_SHORT,
  routeOrder,
  routePreferenceSummary,
} from './update-route';
import { androidPromptView, desktopPromptView, versionLine } from './update-prompt-model';
import { apkCacheFileName, notesFromMirrorManifest, type AndroidUpdateState } from './android-update-core';
import { desktopUpdateSource, latestReleaseNotes } from './desktop-updater';

let p = 0, t = 0;
const ck = (name: string, ok: boolean) => { t++; if (ok) { p++; console.log(`PASS: ${name}`); } else console.log(`FAIL: ${name}`); };

// ── URL 构造:带版本号,三位 patch ──
const MS = 'https://modelscope.cn/datasets/SmartFlowAI/agent-network-releases/resolve/master/desktop';
const GH = 'https://github.com/sleep2agi/agent-network-app/releases/download';
for (const v of ['0.2.99', '0.2.100', '0.2.117', '1.10.305']) {
  ck(`线路一 URL for ${v}`, apkUrlFor('mirror', v) === `${MS}/${v}/Agent.Network_${v}_android-universal.apk`);
  ck(`线路二 URL for ${v}`, apkUrlFor('github', v) === `${GH}/desktop-v${v}/Agent.Network_${v}_android-universal.apk`);
}
ck('URL builder normalises v-prefix / desktop- tag', apkUrlFor('github', 'desktop-v0.2.118') === apkUrlFor('github', '0.2.118') && apkUrlFor('mirror', 'v0.2.118') === apkUrlFor('mirror', '0.2.118'));
ck('URL builder: 0.2.100 is not truncated to 0.2.10', apkUrlFor('mirror', '0.2.100').includes('/0.2.100/Agent.Network_0.2.100_'));
let threw = false; try { apkUrlFor('mirror', '../../evil'); } catch { threw = true; }
ck('URL builder rejects a non-version (no path injection)', threw);

const uni = { name: apkCacheFileName('0.2.118'), url: 'x', source: 'mirror' as const };
const odd = { name: 'Agent.Network_0.2.118_arm64.apk', url: `${GH}/desktop-v0.2.118/Agent.Network_0.2.118_arm64.apk`, source: 'github' as const };
ck('asset URL: universal → both routes', apkUrlForAsset('mirror', '0.2.118', uni) === apkUrlFor('mirror', '0.2.118') && apkUrlForAsset('github', '0.2.118', uni) === apkUrlFor('github', '0.2.118'));
ck('asset URL: non-universal GitHub asset → 线路二 keeps its own URL, 线路一 skipped (mirror only has universal)', apkUrlForAsset('github', '0.2.118', odd) === odd.url && apkUrlForAsset('mirror', '0.2.118', odd) === null);

// ── 线路顺序 ──
ck('auto, no history → 线路一 first', routeOrder('auto', null).join() === 'mirror,github');
ck('auto, last good github → 线路二 first', routeOrder('auto', 'github').join() === 'github,mirror');
ck('auto, no history, check answered by GitHub → 线路二 first', routeOrder('auto', null, null, 'github').join() === 'github,mirror');
ck('auto: last good beats the check route', routeOrder('auto', 'mirror', null, 'github').join() === 'mirror,github');
ck('pref github beats last good mirror', routeOrder('github', 'mirror').join() === 'github,mirror');
ck('pref mirror beats last good github', routeOrder('mirror', 'github').join() === 'mirror,github');
ck('prompt choice beats preference', routeOrder('github', 'github', 'mirror').join() === 'mirror,github');
ck('order always has both routes (fallback kept even with an explicit pick)', (['auto', 'mirror', 'github'] as const).every(pr => new Set(routeOrder(pr, null)).size === 2));
ck('otherRoute flips', otherRoute('mirror') === 'github' && otherRoute('github') === 'mirror');
ck('check order: only explicit 线路二 asks GitHub REST first', checkOrder('github')[0] === 'github' && checkOrder('auto')[0] === 'mirror' && checkOrder('mirror')[0] === 'mirror');

// ── 解析 ──
ck('parseRoutePreference: unknown / corrupt → auto', parseRoutePreference('ghub') === 'auto' && parseRoutePreference(null) === 'auto' && parseRoutePreference(42) === 'auto');
ck('parseRoutePreference: valid kept', parseRoutePreference('github') === 'github' && parseRoutePreference('mirror') === 'mirror' && parseRoutePreference('auto') === 'auto');
ck('parseRoute: only mirror/github', parseRoute('mirror') === 'mirror' && parseRoute('auto') === null && parseRoute('') === null);

// ── 偏好持久化 ──
{
  const st = memoryRouteStorage();
  const a = createRoutePrefsStore(st);
  await a.hydrate();
  ck('fresh device: auto + no last good', a.snapshot().pref === 'auto' && a.snapshot().lastGood === null);
  let notified = 0; a.subscribe(() => notified++);
  await a.setPreference('github');
  await a.recordSuccess('mirror');
  ck('setPreference / recordSuccess write storage', st.data[ROUTE_PREF_KEY] === 'github' && st.data[ROUTE_LAST_OK_KEY] === 'mirror');
  ck('subscribers notified', notified === 2);
  await a.recordSuccess('mirror');
  ck('recording the same route again is a no-op', notified === 2);
  const b = createRoutePrefsStore(st); // 「重启 app」:新 store 读同一份存储
  await b.hydrate();
  ck('persisted across restart', b.snapshot().pref === 'github' && b.snapshot().lastGood === 'mirror');
  const bad = createRoutePrefsStore(memoryRouteStorage({ [ROUTE_PREF_KEY]: 'nonsense', [ROUTE_LAST_OK_KEY]: 'ftp' }));
  await bad.hydrate();
  ck('corrupt stored values → defaults', bad.snapshot().pref === 'auto' && bad.snapshot().lastGood === null);
  const broken = createRoutePrefsStore({ get: async () => { throw new Error('EIO'); }, set: async () => { throw new Error('EIO'); } });
  await broken.hydrate();
  await broken.setPreference('mirror');
  ck('storage failure: in-memory still updates, nothing throws', broken.snapshot().pref === 'mirror');
}
ck('summary: auto no history names both routes', routePreferenceSummary('auto', null).includes('线路一') && routePreferenceSummary('auto', null).includes('线路二'));
ck('summary: auto with history names the remembered route', routePreferenceSummary('auto', 'github').includes('上次成功的线路二'));
ck('labels', ROUTE_LABEL.mirror === '线路一（国内 · ModelScope）' && ROUTE_LABEL.github === '线路二（GitHub）' && ROUTE_SHORT.mirror === '线路一');

// ── 大小/进度 ──
ck('formatSize 77.0 MB', formatSize(80_740_352) === '77.0 MB' && formatSize(0) === undefined && formatSize(undefined) === undefined);
ck('progress bytes with total', formatProgressBytes(12_897_485, 80_740_352) === '12.3 / 77.0 MB');
ck('progress bytes without total', formatProgressBytes(1_048_576, undefined) === '1.0 MB' && formatProgressBytes(0, undefined) === undefined);

// ── 本版说明:latest.json 的累计 notes 只取最新一段 ──
const cumulative = "Signed and notarized stable update.\n\nWhat's new in 0.2.118:\n- A\n- B\n\nWhat's new in 0.2.117:\n- old\n";
ck('release notes: newest section only', latestReleaseNotes(cumulative) === "What's new in 0.2.118:\n- A\n- B");
ck('release notes: mirror manifest of the same version → its notes', notesFromMirrorManifest({ version: '0.2.118', notes: cumulative }, '0.2.118').includes("What's new in 0.2.118"));
ck('release notes: manifest of another version → generic text, never stale notes', !notesFromMirrorManifest({ version: '0.2.117', notes: cumulative }, '0.2.118').includes('0.2.118:'));

// ── 弹窗文案 ──
const SIZE = 80_740_352;
const rel = { version: '0.2.118', notes: cumulative, releaseUrl: 'r', apk: { name: apkCacheFileName('0.2.118'), url: apkUrlFor('mirror', '0.2.118'), size: SIZE, sha256: 'a'.repeat(64), source: 'mirror' as const } };
const view = (s: AndroidUpdateState, route: 'mirror' | 'github' = 'mirror') => androidPromptView(s, { currentVersion: '0.2.117', route })!;
{
  const v = view({ ...rel, kind: 'available' });
  ck('prompt: 当前 v0.2.117 → 新 v0.2.118', v.versions.current === 'v0.2.117' && v.versions.next === 'v0.2.118');
  ck('prompt: meta = size · 线路一 label', v.meta === '77.0 MB · 线路一（国内 · ModelScope）');
  ck('prompt available: download button, picker enabled, 稍后 shown', v.primary?.action === 'download' && v.primary.label === '下载并安装' && v.routePickerEnabled && v.showLater);
  ck('prompt: chosen 线路二 shows in meta', view({ ...rel, kind: 'available' }, 'github').meta.endsWith('线路二（GitHub）'));
}
{
  const v = view({ ...rel, kind: 'downloading', route: 'github', percent: 42, written: Math.round(SIZE * 0.42), total: SIZE, fallbackFrom: { route: 'mirror', reason: '网络不通' } });
  ck('prompt fallback: notice names failed route, reason, and new route', v.fallbackNotice === '线路一下载失败：网络不通。已自动切换到线路二');
  ck('prompt downloading: progress line has route, bytes, percent', v.progressLine === '正在通过线路二下载 · 32.3 / 77.0 MB · 42%');
  ck('prompt downloading: meta shows the route actually in use (not the preferred one)', v.meta.endsWith('线路二（GitHub）'));
  ck('prompt downloading: picker locked, no 稍后, no primary', !v.routePickerEnabled && !v.showLater && !v.primary);
}
ck('prompt downloading without fallback: no notice', view({ ...rel, kind: 'downloading', route: 'mirror', percent: 5 }).fallbackNotice === undefined);
ck('prompt verifying line', view({ ...rel, kind: 'downloading', route: 'mirror', percent: 100, verifying: true }).progressLine === '线路一 · 正在校验安装包（sha256）…');
{
  const v = view({ ...rel, kind: 'download-error', message: '网络不通', attempts: [{ route: 'mirror', reason: '网络不通' }, { route: 'github', reason: '安装包地址不可用(404)' }] });
  ck('prompt error (both routes): title + one line per route', v.errorTitle === '两条线路都下载失败' && v.attemptLines.join('|') === '线路一：网络不通|线路二：安装包地址不可用(404)');
  ck('prompt error: retry + picker enabled (can switch route)', v.primary?.action === 'retry' && v.routePickerEnabled);
  const one = view({ ...rel, kind: 'download-error', message: '下载太慢或已中断', attempts: [{ route: 'mirror', reason: '下载太慢或已中断' }] });
  ck('prompt error (one route, stalled): reason in title, no duplicate line', one.errorTitle === '下载失败：下载太慢或已中断' && one.attemptLines.length === 0);
}
ck('prompt ready after failed install: 重新安装 + settings button', (() => { const v = view({ ...rel, kind: 'ready', fileUri: 'f', installAttempted: true, route: 'github' }); return v.primary?.label === '重新安装' && v.showOpenSettings && v.meta.endsWith('线路二（GitHub）'); })());
ck('prompt: no view for non-release states', androidPromptView({ kind: 'checking' }, { currentVersion: '0.2.117', route: 'mirror' }) === null);
ck('versionLine strips prefixes', versionLine('desktop-v0.2.117', 'v0.2.118').current === 'v0.2.117' && versionLine(undefined, '0.2.118').current === undefined);

// ── 桌面:清单地址 → 来源 ──
const manifest = (host: string) => ({ platforms: { 'darwin-aarch64': { url: `${host}/a.tar.gz` }, 'windows-x86_64': { url: `${host}/b.exe` } } });
ck('desktop source: anet.sh manifest (GitHub asset URLs) → 线路二', desktopUpdateSource(manifest('https://github.com/sleep2agi/agent-network-app/releases/download/desktop-v0.2.118')) === 'github');
ck('desktop source: ModelScope manifest → 线路一', desktopUpdateSource(manifest(`${MS}/0.2.118`)) === 'mirror');
ck('desktop source: mixed hosts → unknown (no guess)', desktopUpdateSource({ platforms: { a: { url: `${MS}/x` }, b: { url: `${GH}/y` } } }) === undefined);
ck('desktop source: lookalike host is not ModelScope', desktopUpdateSource(manifest('https://modelscope.cn.evil.example/x')) === undefined);
ck('desktop source: missing/garbage → unknown', desktopUpdateSource(undefined) === undefined && desktopUpdateSource({ platforms: { a: { url: 'not a url' } } }) === undefined);
{
  const d = desktopPromptView({ kind: 'available', version: '0.2.118', notes: '', currentVersion: '0.2.117', source: 'mirror' }, '0.0.0');
  ck('desktop prompt: versions + source line', d?.versions.current === 'v0.2.117' && d.versions.next === 'v0.2.118' && d.sourceLine === '更新来源：线路一（国内 · ModelScope）');
  const d2 = desktopPromptView({ kind: 'downloading', version: '0.2.118', percent: 35, downloaded: Math.round(SIZE * 0.35), total: SIZE }, '0.2.117');
  ck('desktop prompt: falls back to APP_VERSION, progress with size', d2?.versions.current === 'v0.2.117' && d2.progressLine === '正在下载安装… · 26.9 / 77.0 MB · 35%' && d2.sourceLine === undefined);
}

// ── 接线(源码扫描;路径统一成 POSIX,Windows 检出也一样)──
const root = fileURLToPath(new URL('..', import.meta.url));
const toPosix = (s: string) => s.split(sep).join('/');
const read = (rel: string) => readFileSync(join(root, rel), 'utf8');
const prompt = read('src/AndroidUpdatePrompt.tsx');
const desktopPrompt = read('src/DesktopUpdatePrompt.tsx');
const settings = read('src/SettingsScreen.tsx');
const updater = read('src/android-updater.ts');
const model = read('src/settings-model.ts');
ck('wiring: prompt route segments call chooseAndroidUpdateRoute', /onPress=\{\(\) => chooseAndroidUpdateRoute\(r\)\}/.test(prompt));
ck('wiring: prompt browser buttons pass the route to openApkInBrowser', prompt.includes('openApkInBrowser(r)'));
ck('wiring: prompt text comes from androidPromptView', prompt.includes('androidPromptView(update, { currentVersion, route })'));
ck('wiring: updater orders downloads via routeOrder and records success', updater.includes('routeOrder(pref, lastGood, chosen') && updater.includes('prefs.recordSuccess(route)'));
ck('wiring: browser download goes through deps.openURL (Linking), not Markdown', updater.includes("Linking.openURL(url)") && !prompt.includes('MarkdownMessage'));
ck('wiring: settings has the 下载线路 segmented control writing the preference', settings.includes('routePrefs.setPreference(option)') && settings.includes("show('about', 'updateRoute')"));
ck('wiring: settings-model lists updateRoute (android only)', /key: 'updateRoute'[^\n]*platforms: \['android'\]/.test(model));
ck('wiring: desktop prompt shows versions + source via desktopPromptView', desktopPrompt.includes('desktopPromptView(update, APP_VERSION)') && desktopPrompt.includes('view.sourceLine'));
// APK 直链只允许经 android-update-core 的构造函数拼出来(下划线文件名手拼过一次就会漏版本号/拼错)。
const srcFiles = readdirSync(join(root, 'src')).filter(f => /\.tsx?$/.test(f) && !f.includes('.test.')).map(f => toPosix(join('src', f)));
// 只看代码行:注释(// 与 JSDoc 的 * 开头)里描述文件名不算。
const codeLines = (src: string) => src.split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l));
const handBuilt = srcFiles.filter(f => f !== 'src/android-update-core.ts' && codeLines(read(f)).some(l => /_android-universal\.apk/.test(l)));
ck(`APK file names are only built in android-update-core.ts (scanned ${srcFiles.length} files)`, srcFiles.length > 50 && handBuilt.length === 0);
if (handBuilt.length) console.log('  hand-built:', handBuilt.join(', '));

console.log(`\n${p}/${t} passed`);
if (p !== t) process.exit(1);
