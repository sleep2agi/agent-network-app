// 下载来源(镜像 / GitHub)的内部逻辑 + 弹窗文案 + 桌面来源识别 + 接线。
// 来源是内部概念:用户可见的文字里不能出现「线路」(Vincent 2026-09-26 否掉了 #427 的线路选择)。
// ck 风格:自执行,失败退出码非 0(scripts/run-tests.mjs 汇总)。
import { readdirSync, readFileSync } from 'node:fs';
import { join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  apkUrlFor,
  apkUrlForAsset,
  createRoutePrefsStore,
  formatProgressBytes,
  formatSize,
  LEGACY_ROUTE_PREF_KEY,
  memoryRouteStorage,
  otherRoute,
  parseRoute,
  ROUTE_LAST_OK_KEY,
  routeOrder,
} from './update-route';
import { androidPromptView, desktopPromptView, DOWNLOAD_FAILED_TITLE, versionLine, type AndroidPromptView } from './update-prompt-model';
import { apkCacheFileName, describeAndroidUpdateRow, notesFromMirrorManifest, type AndroidUpdateState } from './android-update-core';
import { SETTINGS_CATEGORIES } from './settings-model';
import { describeUpdateRow } from './update-check-state';
import { desktopUpdateSource, latestReleaseNotes } from './desktop-updater';

let p = 0, t = 0;
const ck = (name: string, ok: boolean) => { t++; if (ok) { p++; console.log(`PASS: ${name}`); } else console.log(`FAIL: ${name}`); };

// ── URL 构造:带版本号,三位 patch ──
const MS = 'https://modelscope.cn/datasets/SmartFlowAI/agent-network-releases/resolve/master/desktop';
const GH = 'https://github.com/sleep2agi/agent-network-app/releases/download';
for (const v of ['0.2.99', '0.2.100', '0.2.117', '1.10.305']) {
  ck(`mirror URL for ${v}`, apkUrlFor('mirror', v) === `${MS}/${v}/Agent.Network_${v}_android-universal.apk`);
  ck(`GitHub URL for ${v}`, apkUrlFor('github', v) === `${GH}/desktop-v${v}/Agent.Network_${v}_android-universal.apk`);
}
ck('URL builder normalises v-prefix / desktop- tag', apkUrlFor('github', 'desktop-v0.2.118') === apkUrlFor('github', '0.2.118') && apkUrlFor('mirror', 'v0.2.118') === apkUrlFor('mirror', '0.2.118'));
ck('URL builder: 0.2.100 is not truncated to 0.2.10', apkUrlFor('mirror', '0.2.100').includes('/0.2.100/Agent.Network_0.2.100_'));
let threw = false; try { apkUrlFor('mirror', '../../evil'); } catch { threw = true; }
ck('URL builder rejects a non-version (no path injection)', threw);

const uni = { name: apkCacheFileName('0.2.118'), url: 'x', source: 'mirror' as const };
const odd = { name: 'Agent.Network_0.2.118_arm64.apk', url: `${GH}/desktop-v0.2.118/Agent.Network_0.2.118_arm64.apk`, source: 'github' as const };
ck('asset URL: universal → both routes', apkUrlForAsset('mirror', '0.2.118', uni) === apkUrlFor('mirror', '0.2.118') && apkUrlForAsset('github', '0.2.118', uni) === apkUrlFor('github', '0.2.118'));
ck('asset URL: non-universal GitHub asset → GitHub keeps its own URL, mirror skipped (mirror only has universal)', apkUrlForAsset('github', '0.2.118', odd) === odd.url && apkUrlForAsset('mirror', '0.2.118', odd) === null);

// ── 来源顺序(内部,全自动)──
ck('no history → mirror first', routeOrder(null).join() === 'mirror,github');
ck('last good github → GitHub first', routeOrder('github').join() === 'github,mirror');
ck('no history, check answered by GitHub → GitHub first', routeOrder(null, 'github').join() === 'github,mirror');
ck('last good beats the check route', routeOrder('mirror', 'github').join() === 'mirror,github');
ck('order always has both sources (fallback kept)', ([null, 'mirror', 'github'] as const).every(lg => new Set(routeOrder(lg)).size === 2));
ck('otherRoute flips', otherRoute('mirror') === 'github' && otherRoute('github') === 'mirror');
ck('parseRoute: only mirror/github', parseRoute('mirror') === 'mirror' && parseRoute('auto') === null && parseRoute('') === null);

// ── 持久化:只记「上次成功来源」;0.2.121 的「下载线路」偏好被忽略并静默删掉 ──
{
  const st = memoryRouteStorage();
  const a = createRoutePrefsStore(st);
  await a.hydrate();
  ck('fresh device: no last good', a.snapshot().lastGood === null);
  let notified = 0; a.subscribe(() => notified++);
  await a.recordSuccess('mirror');
  ck('recordSuccess writes storage + notifies', st.data[ROUTE_LAST_OK_KEY] === 'mirror' && notified === 1);
  await a.recordSuccess('mirror');
  ck('recording the same source again is a no-op', notified === 1);
  const b = createRoutePrefsStore(st); // 「重启 app」
  await b.hydrate();
  ck('last good persisted across restart', b.snapshot().lastGood === 'mirror');
  ck('store exposes no user preference any more', !('pref' in b.snapshot()) && !('setPreference' in b));
  const bad = createRoutePrefsStore(memoryRouteStorage({ [ROUTE_LAST_OK_KEY]: 'ftp' }));
  await bad.hydrate();
  ck('corrupt stored value → no history', bad.snapshot().lastGood === null);
  const broken = createRoutePrefsStore({ get: async () => { throw new Error('EIO'); }, set: async () => { throw new Error('EIO'); } });
  await broken.hydrate();
  await broken.recordSuccess('github');
  ck('storage failure: in-memory still updates, nothing throws', broken.snapshot().lastGood === 'github');
}
for (const legacy of ['github', 'mirror', 'auto']) {
  const st = memoryRouteStorage({ [LEGACY_ROUTE_PREF_KEY]: legacy });
  const store = createRoutePrefsStore(st);
  await store.hydrate();
  ck(`legacy 下载线路 pref "${legacy}" is deleted on hydrate`, !(LEGACY_ROUTE_PREF_KEY in st.data));
  ck(`legacy pref "${legacy}" does not steer the order (treated as auto)`, routeOrder(store.snapshot().lastGood).join() === 'mirror,github');
}
{
  // 没有 remove 的后端(旧实现/第三方):忽略即可,不抛
  const store = createRoutePrefsStore({ get: async k => (k === LEGACY_ROUTE_PREF_KEY ? 'github' : null), set: async () => undefined });
  let threw = false; try { await store.hydrate(); } catch { threw = true; }
  ck('legacy pref on a backend without remove(): ignored, no throw', !threw && store.snapshot().lastGood === null);
}

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
const rel = { version: '0.2.118', notes: cumulative, releaseUrl: 'r', checkRoute: 'mirror' as const, apk: { name: apkCacheFileName('0.2.118'), url: apkUrlFor('mirror', '0.2.118'), size: SIZE, sha256: 'a'.repeat(64), source: 'mirror' as const } };
const view = (s: AndroidUpdateState) => androidPromptView(s, { currentVersion: '0.2.117' })!;
{
  const v = view({ ...rel, kind: 'available' });
  ck('prompt: 当前 v0.2.117 → 新 v0.2.118', v.versions.current === 'v0.2.117' && v.versions.next === 'v0.2.118');
  ck('prompt: meta = size only', v.meta === '77.0 MB');
  ck('prompt available: download button, 稍后 shown', v.primary?.action === 'download' && v.primary.label === '下载并安装' && v.showLater);
}
{
  const v = view({ ...rel, kind: 'downloading', route: 'github', percent: 42, written: Math.round(SIZE * 0.42), total: SIZE, fallbackFrom: { route: 'mirror', reason: '网络不通' } });
  ck('prompt downloading (after a silent switch): progress = bytes + percent, nothing else', v.progressLine === '正在下载 · 32.3 / 77.0 MB · 42%');
  ck('prompt downloading: no 稍后, no primary', !v.showLater && !v.primary);
  ck('prompt downloading: meta unchanged by the source in use', v.meta === '77.0 MB');
}
ck('prompt verifying line', view({ ...rel, kind: 'downloading', route: 'mirror', percent: 100, verifying: true }).progressLine === '正在校验安装包（sha256）…');
{
  const v = view({ ...rel, kind: 'download-error', message: '网络不通', attempts: [{ route: 'mirror', reason: '网络不通' }, { route: 'github', reason: '安装包地址不可用(404)' }] });
  ck('prompt error (both sources failed): one simple sentence, no per-source lines', v.errorTitle === '下载失败，请检查网络后重试' && v.errorTitle === DOWNLOAD_FAILED_TITLE && v.errorDetail === undefined);
  ck('prompt error: retry offered', v.primary?.action === 'retry' && v.primary.label === '重试');
  const stalled = view({ ...rel, kind: 'download-error', message: '下载太慢或已中断', attempts: [{ route: 'mirror', reason: '下载太慢或已中断' }] });
  ck('prompt error (stalled): same simple sentence', stalled.errorTitle === DOWNLOAD_FAILED_TITLE && stalled.errorDetail === undefined);
  const disk = view({ ...rel, kind: 'download-error', message: '手机存储空间不足' });
  ck('prompt error (local cause, network would not help): adds the reason', disk.errorTitle === DOWNLOAD_FAILED_TITLE && disk.errorDetail === '手机存储空间不足');
}
ck('prompt ready after failed install: 重新安装 + settings button', (() => { const v = view({ ...rel, kind: 'ready', fileUri: 'f', installAttempted: true, route: 'github' }); return v.primary?.label === '重新安装' && v.showOpenSettings; })());
ck('prompt: no view for non-release states', androidPromptView({ kind: 'checking' }, { currentVersion: '0.2.117' }) === null);
ck('versionLine strips prefixes', versionLine('desktop-v0.2.117', 'v0.2.118').current === 'v0.2.117' && versionLine(undefined, '0.2.118').current === undefined);

// ── 桌面:清单地址 → 来源 ──
const manifest = (host: string) => ({ platforms: { 'darwin-aarch64': { url: `${host}/a.tar.gz` }, 'windows-x86_64': { url: `${host}/b.exe` } } });
ck('desktop source: anet.sh manifest (GitHub asset URLs) → github', desktopUpdateSource(manifest('https://github.com/sleep2agi/agent-network-app/releases/download/desktop-v0.2.118')) === 'github');
ck('desktop source: ModelScope manifest → mirror', desktopUpdateSource(manifest(`${MS}/0.2.118`)) === 'mirror');
ck('desktop source: mixed hosts → unknown (no guess)', desktopUpdateSource({ platforms: { a: { url: `${MS}/x` }, b: { url: `${GH}/y` } } }) === undefined);
ck('desktop source: lookalike host is not ModelScope', desktopUpdateSource(manifest('https://modelscope.cn.evil.example/x')) === undefined);
ck('desktop source: missing/garbage → unknown', desktopUpdateSource(undefined) === undefined && desktopUpdateSource({ platforms: { a: { url: 'not a url' } } }) === undefined);
{
  const d = desktopPromptView({ kind: 'available', version: '0.2.118', notes: '', currentVersion: '0.2.117', source: 'mirror' }, '0.0.0');
  ck('desktop prompt: versions, and no source line', d?.versions.current === 'v0.2.117' && d.versions.next === 'v0.2.118' && !('sourceLine' in d));
  const d2 = desktopPromptView({ kind: 'downloading', version: '0.2.118', percent: 35, downloaded: Math.round(SIZE * 0.35), total: SIZE, source: 'github' }, '0.2.117');
  ck('desktop prompt: falls back to APP_VERSION, progress with size', d2?.versions.current === 'v0.2.117' && d2.progressLine === '正在下载安装… · 26.9 / 77.0 MB · 35%');
}

// ── 用户可见文字里没有「线路」──
// 1) 渲染出来的文字模型:每个会出现在弹窗/设置里的状态都过一遍(含已经自动切换过来源、两边都失败的状态)。
const NO_ROUTE = /线路/;
const now = Date.now();
const promptStates: AndroidUpdateState[] = [
  { ...rel, kind: 'available' },
  { ...rel, kind: 'available', checkRoute: 'github' },
  { ...rel, kind: 'downloading', route: 'mirror', percent: 16, written: 1, total: SIZE },
  { ...rel, kind: 'downloading', route: 'github', percent: 42, written: 2, total: SIZE, fallbackFrom: { route: 'mirror', reason: '网络不通' } },
  { ...rel, kind: 'downloading', route: 'github', percent: 100, verifying: true },
  { ...rel, kind: 'download-error', message: '网络不通', attempts: [{ route: 'mirror', reason: '网络不通' }, { route: 'github', reason: '下载太慢或已中断' }] },
  { ...rel, kind: 'download-error', message: '手机存储空间不足', attempts: [{ route: 'github', reason: '手机存储空间不足' }] },
  { ...rel, kind: 'ready', fileUri: 'f', installAttempted: false, route: 'github' },
  { ...rel, kind: 'ready', fileUri: 'f', installAttempted: true, route: 'mirror' },
];
const rowStates: AndroidUpdateState[] = [
  ...promptStates,
  { kind: 'idle' }, { kind: 'checking' },
  { kind: 'up-to-date', latest: '0.2.118', route: 'mirror' },
  { kind: 'up-to-date', latest: '0.2.118', route: 'github' },
  { kind: 'error', message: 'GitHub 403 rate-limited', rateLimitResetAt: now + 60_000 },
  { kind: 'error', message: 'mirror down' },
];
const promptText = (v: AndroidPromptView) => [v.title, v.versions.current, v.versions.next, v.meta, v.progressLine, v.errorTitle, v.errorDetail, v.primary?.label].filter(Boolean).join('\n');
const renderedPrompts = promptStates.map(st => promptText(view(st)));
const renderedRows = rowStates.map(st => { const r = describeAndroidUpdateRow(st, { currentVersion: '0.2.117', lastCheckedAt: now, now }); return `${r.label}\n${r.detail ?? ''}`; });
const renderedDesktop = (['mirror', 'github', undefined] as const).flatMap(source => [
  desktopPromptView({ kind: 'available', version: '0.2.118', notes: '', currentVersion: '0.2.117', source }, '0.2.117'),
  desktopPromptView({ kind: 'downloading', version: '0.2.118', percent: 35, downloaded: 1, total: SIZE, source }, '0.2.117'),
]).map(v => JSON.stringify(v));
const settingsText = SETTINGS_CATEGORIES.flatMap(c => [c.label, ...c.rows.flatMap(r => [r.label, ...(r.keywords ?? [])])]);
ck(`rendered prompt text (${renderedPrompts.length} states) never mentions 线路`, renderedPrompts.length === promptStates.length && renderedPrompts.every(t => t.length > 0 && !NO_ROUTE.test(t)));
ck(`rendered settings 软件更新 row (${renderedRows.length} states) never mentions 线路`, renderedRows.every(t => !NO_ROUTE.test(t)));
ck('settings up-to-date row: 已是最新版本 + 刚刚检查, no source suffix', (() => { const r = describeAndroidUpdateRow({ kind: 'up-to-date', latest: '0.2.118', route: 'mirror' }, { currentVersion: '0.2.118', lastCheckedAt: now, now }); return r.label === '已是最新版本 v0.2.118' && r.detail === describeUpdateRow({ kind: 'up-to-date' }, { currentVersion: '0.2.118', lastCheckedAt: now, now }).detail && r.detail === '刚刚检查'; })());
ck('rendered desktop prompt never mentions 线路 / 更新来源', renderedDesktop.every(t => !NO_ROUTE.test(t) && !t.includes('更新来源')));
ck(`settings model (labels + search keywords, ${settingsText.length} strings) never mentions 线路`, settingsText.length > 20 && settingsText.every(t => !NO_ROUTE.test(t)));
ck('settings model: the 下载线路 row is gone', SETTINGS_CATEGORIES.every(c => c.rows.every(r => r.key !== 'updateRoute')) && SETTINGS_CATEGORIES.find(c => c.key === 'about')!.rows.map(r => r.key).join() === 'version,update');

// 2) 组件源码里的字面量(注释不算):弹窗、设置、夹具都不许再写「线路」。路径统一成 POSIX,CRLF 统一成 LF。
const root = fileURLToPath(new URL('..', import.meta.url));
const toPosix = (s: string) => s.split(sep).join('/');
const read = (rel: string) => readFileSync(join(root, rel), 'utf8').replace(/\r\n/g, '\n');
const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '').split('\n').map(l => l.replace(/(^|[^:])\/\/.*$/, '$1')).join('\n');
const UI_FILES = ['src/AndroidUpdatePrompt.tsx', 'src/DesktopUpdatePrompt.tsx', 'src/SettingsScreen.tsx', 'src/UpdatePromptFixtureScreen.tsx', 'src/update-prompt-model.ts', 'src/android-update-core.ts', 'src/settings-model.ts'];
const withRoute = UI_FILES.filter(f => NO_ROUTE.test(stripComments(read(f))));
ck(`UI source literals (${UI_FILES.length} files) never contain 线路`, withRoute.length === 0);
if (withRoute.length) console.log('  still mentions 线路:', withRoute.join(', '));

const prompt = read('src/AndroidUpdatePrompt.tsx');
const desktopPrompt = read('src/DesktopUpdatePrompt.tsx');
const settings = read('src/SettingsScreen.tsx');
const updater = read('src/android-updater.ts');
ck('wiring: prompt has no route picker and exactly one browser button', !/chooseAndroidUpdateRoute|UPDATE_ROUTES|android-update-routes/.test(prompt) && (prompt.match(/openApkInBrowser\(/g) ?? []).length === 1 && prompt.includes('openApkInBrowser()') && prompt.includes('>在浏览器中下载<'));
ck('wiring: prompt text comes from androidPromptView', prompt.includes('androidPromptView(update, { currentVersion })'));
ck('wiring: prompt hydrates the store on mount (deletes the legacy pref at startup)', /useEffect\(\(\) => \{ void routePrefs\.hydrate\(\)/.test(prompt));
ck('wiring: updater orders downloads via routeOrder and records success', updater.includes('routeOrder(prefs.snapshot().lastGood') && updater.includes('prefs.recordSuccess(route)'));
ck('wiring: browser download goes through deps.openURL (Linking), not Markdown', updater.includes("Linking.openURL(url)") && !prompt.includes('MarkdownMessage'));
ck('wiring: settings has no 下载线路 row / route preference', !/updateRoute|settings-update-route|setPreference|routePreferenceSummary/.test(settings));
ck('wiring: desktop prompt shows versions via desktopPromptView, no source line', desktopPrompt.includes('desktopPromptView(update, APP_VERSION)') && !desktopPrompt.includes('sourceLine'));
// APK 直链只允许经 android-update-core 的构造函数拼出来(下划线文件名手拼过一次就会漏版本号/拼错)。
const srcFiles = readdirSync(join(root, 'src')).filter(f => /\.tsx?$/.test(f) && !f.includes('.test.')).map(f => toPosix(join('src', f)));
// 只看代码行:注释(// 与 JSDoc 的 * 开头)里描述文件名不算。
const codeLines = (src: string) => src.split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l));
const handBuilt = srcFiles.filter(f => f !== 'src/android-update-core.ts' && codeLines(read(f)).some(l => /_android-universal\.apk/.test(l)));
ck(`APK file names are only built in android-update-core.ts (scanned ${srcFiles.length} files)`, srcFiles.length > 50 && handBuilt.length === 0);
if (handBuilt.length) console.log('  hand-built:', handBuilt.join(', '));

console.log(`\n${p}/${t} passed`);
if (p !== t) process.exit(1);
