import {
  ANDROID_LATEST_RELEASE_API,
  androidPromptVisible,
  androidVersionCode,
  apkCacheFileName,
  compareVersions,
  describeAndroidUpdateRow,
  downloadErrorReason,
  downloadPercent,
  evaluateAndroidRelease,
  parseVersion,
  pickAndroidApk,
  type AndroidUpdateState,
} from './android-update-core';

let p = 0, t = 0;
const ck = (name: string, ok: boolean) => { t++; if (ok) { p++; console.log(`PASS: ${name}`); } else console.log(`FAIL: ${name}`); };
const throws = (fn: () => unknown) => { try { fn(); return false; } catch { return true; } };

// ── version compare ──
ck('parse plain / v / desktop-v', JSON.stringify([parseVersion('0.2.98'), parseVersion('v0.2.98'), parseVersion('desktop-v0.2.98')]) === JSON.stringify([[0, 2, 98], [0, 2, 98], [0, 2, 98]]));
ck('parse rejects garbage and prerelease', parseVersion('0.2') === null && parseVersion('0.2.98-rc1') === null && parseVersion('') === null && parseVersion(undefined) === null);
ck('patch is numeric not lexical (0.2.100 > 0.2.99)', compareVersions('0.2.100', '0.2.99') === 1);
ck('patch is numeric not lexical (0.2.9 < 0.2.10)', compareVersions('0.2.9', '0.2.10') === -1);
ck('minor outranks patch', compareVersions('0.3.0', '0.2.999') === 1);
ck('major outranks minor', compareVersions('1.0.0', '0.99.99') === 1);
ck('equal → 0 across prefixes', compareVersions('desktop-v0.2.98', '0.2.98') === 0);
ck('older → -1', compareVersions('0.2.97', '0.2.98') === -1);
ck('unparseable → null, never "no update"', compareVersions('latest', '0.2.98') === null);

// ── versionCode ──
ck('0.2.98 → 2098', androidVersionCode('0.2.98') === 2098);
ck('0.3.0 → 3000', androidVersionCode('0.3.0') === 3000);
ck('1.0.0 → 1000000', androidVersionCode('1.0.0') === 1_000_000);
ck('every already-installed APK is versionCode 1: first derived code is > 1', androidVersionCode('0.2.99') > 1);
const seq = ['0.0.2', '0.2.9', '0.2.10', '0.2.98', '0.2.99', '0.2.100', '0.2.999', '0.3.0', '0.10.0', '0.999.999', '1.0.0', '2.5.7', '2099.999.999'];
ck('versionCode is strictly monotonic in semver order', seq.every((v, i) => i === 0 || androidVersionCode(v) > androidVersionCode(seq[i - 1])));
ck('versionCode stays below 2100000000', androidVersionCode('2099.999.999') < 2_100_000_000);
ck('minor/patch ≥ 1000 rejected (would collide)', throws(() => androidVersionCode('0.2.1000')) && throws(() => androidVersionCode('0.1000.0')));
ck('major 2100 rejected (over the Android cap)', throws(() => androidVersionCode('2100.0.0')));
ck('prefixed / prerelease rejected', throws(() => androidVersionCode('v0.2.98')) && throws(() => androidVersionCode('0.2.98-1')));
ck('0.0.1 / 0.0.0 rejected (≤ installed code 1)', throws(() => androidVersionCode('0.0.1')) && throws(() => androidVersionCode('0.0.0')));

// ── APK pick from a real-shaped release JSON ──
const asset = (name: string, size = 100) => ({ name, size, browser_download_url: `https://github.com/sleep2agi/agent-network-app/releases/download/desktop-v0.2.99/${name}` });
const release = {
  tag_name: 'desktop-v0.2.99',
  html_url: 'https://github.com/sleep2agi/agent-network-app/releases/tag/desktop-v0.2.99',
  body: "Signed.\n\nWhat's new in 0.2.99:\n- 安卓可以应用内更新",
  assets: [
    asset('Agent.Network_0.2.99_aarch64.dmg'),
    asset('Agent.Network_0.2.99_x64-setup.exe'),
    asset('Agent.Network_0.2.99_android-universal.apk', 77_148_197),
    asset('latest.json'),
  ],
};
const picked = pickAndroidApk(release);
ck('picks the universal APK', picked?.name === 'Agent.Network_0.2.99_android-universal.apk' && picked.size === 77_148_197 && picked.url.endsWith('/Agent.Network_0.2.99_android-universal.apk'));
ck('ignores an APK whose version is not the tag (stale upload)', pickAndroidApk({ ...release, assets: [asset('Agent.Network_0.2.98_android-universal.apk')] }) === null);
ck('falls back to another same-version APK', pickAndroidApk({ ...release, assets: [asset('Agent.Network_0.2.99_arm64-v8a.apk')] })?.name === 'Agent.Network_0.2.99_arm64-v8a.apk');
ck('no APK → null', pickAndroidApk({ ...release, assets: release.assets.filter(a => !a.name.endsWith('.apk')) }) === null);
ck('assets missing url are skipped', pickAndroidApk({ ...release, assets: [{ name: 'Agent.Network_0.2.99_android-universal.apk' }] }) === null);
ck('size 0 → unknown', pickAndroidApk({ ...release, assets: [asset('Agent.Network_0.2.99_android-universal.apk', 0)] })?.size === undefined);

// ── verdict ──
const avail = evaluateAndroidRelease(release, '0.2.98');
ck('newer release → available with version, notes, apk', avail.kind === 'available' && avail.version === '0.2.99' && avail.notes.includes('应用内更新') && avail.apk.name.endsWith('android-universal.apk'));
ck('same version → up-to-date', evaluateAndroidRelease(release, '0.2.99').kind === 'up-to-date');
ck('older release (installed a newer build) → up-to-date', evaluateAndroidRelease(release, '0.3.0').kind === 'up-to-date');
const noApk = evaluateAndroidRelease({ ...release, assets: [] }, '0.2.98');
ck('newer release without an APK → error naming the version, not up-to-date', noApk.kind === 'error' && noApk.message.includes('0.2.99') && noApk.message.includes('安卓'));
ck('bad tag → error', evaluateAndroidRelease({ ...release, tag_name: 'nightly' }, '0.2.98').kind === 'error');
ck('null JSON → error', evaluateAndroidRelease(null, '0.2.98').kind === 'error');
ck('bad current version → error, not up-to-date', evaluateAndroidRelease(release, 'dev').kind === 'error');
ck('empty notes get a default', (evaluateAndroidRelease({ ...release, body: '' }, '0.2.98') as any).notes === '此版本包含功能改进和问题修复。');

// ── small helpers ──
ck('cache file name is sanitised', apkCacheFileName('desktop-v0.2.99') === 'Agent.Network_0.2.99_android-universal.apk' && throws(() => apkCacheFileName('../../x')));
ck('percent', downloadPercent(50, 200) === 25 && downloadPercent(300, 200) === 100 && downloadPercent(5, 0) === undefined && downloadPercent(5, undefined) === undefined);
ck('download errors are readable', downloadErrorReason('stalled') === '下载太慢或已中断' && downloadErrorReason('HTTP 404') === '安装包地址不可用(404)' && downloadErrorReason('Unable to resolve host "github.com"') === '网络不通' && downloadErrorReason('size mismatch') === '安装包不完整');
ck('the API endpoint is the same repo the desktop releases come from', ANDROID_LATEST_RELEASE_API === 'https://api.github.com/repos/sleep2agi/agent-network-app/releases/latest');

// ── settings row ──
const now = Date.UTC(2026, 8, 25, 12, 0);
const row = (s: AndroidUpdateState) => describeAndroidUpdateRow(s, { currentVersion: '0.2.98', now, lastCheckedAt: now - 1000 });
const apk = { name: 'a.apk', url: 'u', size: 10 };
const base = { version: '0.2.99', notes: 'n', apk, releaseUrl: 'r' };
ck('idle row is clickable 检查更新', row({ kind: 'idle' }).label === '检查更新' && row({ kind: 'idle' }).actionable);
ck('up-to-date says 已是最新版本 v0.2.98', row({ kind: 'up-to-date', latest: '0.2.98' }).label === '已是最新版本 v0.2.98' && row({ kind: 'up-to-date', latest: '0.2.98' }).actionable);
ck('idle is never "unsupported" on Android', !row({ kind: 'idle' }).label.includes('不支持'));
ck('available row names the version', row({ kind: 'available', ...base }).label === '发现新版本 v0.2.99');
ck('downloading row stays clickable (re-opens the prompt)', row({ kind: 'downloading', ...base, percent: 42 }).label === '正在下载 v0.2.99 42%' && row({ kind: 'downloading', ...base }).actionable);
ck('download-error row says why', row({ kind: 'download-error', ...base, message: '网络不通' }).label === '下载失败：网络不通');
ck('ready row offers install', row({ kind: 'ready', ...base, fileUri: 'f', installAttempted: false }).detail === '点击安装');
ck('rate-limit error is explained', row({ kind: 'error', message: 'GitHub 403' }).label.includes('限流'));
ck('network error reuses the desktop reason mapping', row({ kind: 'error', message: 'Network request failed' }).label === '检查更新失败：网络不通');

// ── prompt visibility ──
ck('prompt hidden when idle / up-to-date', !androidPromptVisible({ kind: 'idle' }, false) && !androidPromptVisible({ kind: 'up-to-date', latest: '0.2.98' }, false));
ck('prompt shows for available unless dismissed', androidPromptVisible({ kind: 'available', ...base }, false) && !androidPromptVisible({ kind: 'available', ...base }, true));
ck('prompt cannot be dismissed while downloading', androidPromptVisible({ kind: 'downloading', ...base }, true));

console.log(`\n${p}/${t} passed`);
if (p !== t) process.exit(1);
