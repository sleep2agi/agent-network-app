/**
 * web GUI 验收夹具(更新弹窗 · 下载线路)。不连 Hub、不打网络。
 * `?fixture=update-prompt&platform=android|desktop&state=available|downloading|fallback|error|ready|uptodate&theme=dark|light`
 *
 * 背后是 设置 → 关于(按安卓渲染:版本 / 软件更新 / 下载线路),前面是对应状态的更新弹窗。
 * 浏览器里 Platform.OS 恒为 web,App 不会挂 AndroidUpdatePrompt —— 这里直接挂。
 */
import { useState } from 'react';
import { Platform, SafeAreaView } from 'react-native';
import SettingsScreen from './SettingsScreen';
import AndroidUpdatePrompt from './AndroidUpdatePrompt';
import DesktopUpdatePrompt from './DesktopUpdatePrompt';
import type { HubConfig } from './api';
import { __showAndroidUpdateForFixture } from './android-updater';
import { __showDesktopUpdateForFixture } from './desktop-updater';
import { apkCacheFileName, githubReleasePage, mirrorApkUrl, githubApkUrl, type AndroidUpdateState } from './android-update-core';
import { rememberSettingsCategory } from './settings-model';
import { colors, setThemeMode, themeMode } from './theme';

const FIXTURE_CFG: HubConfig = { serverUrl: 'http://127.0.0.1:9', token: 'fixture', profileId: 'fixture', username: 'demo' };
export const FIXTURE_CURRENT = '0.2.117';
export const FIXTURE_NEXT = '0.2.118';
const SIZE = 80_740_352; // ≈ 77.0 MB
const NOTES = `Signed and notarized stable update for macOS (Apple Silicon) and Windows (x64).\n\nWhat's new in ${FIXTURE_NEXT}:\n- 检查更新显示「当前版本 → 新版本」,可选下载线路:线路一(国内 · ModelScope)/ 线路二(GitHub)。\n- 线路一失败时自动改用线路二,并记住本机上次成功的线路。\n- 设置 → 关于 新增「下载线路」:自动 / 线路一 / 线路二。\n\nWhat's new in ${FIXTURE_CURRENT}:\n- 旧版本说明(不应出现在弹窗里)。`;

export type UpdatePromptFixture = { theme: 'dark' | 'light'; platform: 'android' | 'desktop'; state: string };

export function readUpdatePromptFixture(): UpdatePromptFixture | null {
  if (Platform.OS !== 'web') return null;
  try {
    const params = new URLSearchParams(String((globalThis as { location?: { search?: string } }).location?.search ?? ''));
    if (params.get('fixture') !== 'update-prompt') return null;
    return {
      theme: params.get('theme') === 'light' ? 'light' : 'dark',
      platform: params.get('platform') === 'desktop' ? 'desktop' : 'android',
      state: params.get('state') || 'available',
    };
  } catch {
    return null;
  }
}

function androidState(kind: string): AndroidUpdateState {
  const rel = {
    version: FIXTURE_NEXT,
    notes: NOTES,
    releaseUrl: githubReleasePage(FIXTURE_NEXT),
    checkRoute: 'mirror' as const,
    apk: { name: apkCacheFileName(FIXTURE_NEXT), url: mirrorApkUrl(FIXTURE_NEXT), fallbackUrl: githubApkUrl(FIXTURE_NEXT), size: SIZE, sha256: 'f'.repeat(64), source: 'mirror' as const },
  };
  switch (kind) {
    case 'uptodate': return { kind: 'up-to-date', latest: FIXTURE_CURRENT, route: 'mirror' };
    case 'downloading': return { ...rel, kind: 'downloading', route: 'mirror', percent: 16, written: Math.round(SIZE * 0.16), total: SIZE };
    case 'fallback': return { ...rel, kind: 'downloading', route: 'github', percent: 42, written: Math.round(SIZE * 0.42), total: SIZE, fallbackFrom: { route: 'mirror', reason: '网络不通' } };
    case 'error': return { ...rel, kind: 'download-error', message: '网络不通', attempts: [{ route: 'mirror', reason: '网络不通' }, { route: 'github', reason: '下载太慢或已中断' }] };
    case 'ready': return { ...rel, kind: 'ready', fileUri: 'file:///cache/x.apk', installAttempted: true, route: 'mirror' };
    default: return { ...rel, kind: 'available' };
  }
}

let seeded = false;
export default function UpdatePromptFixtureScreen({ fixture }: { fixture: UpdatePromptFixture }) {
  if (themeMode() !== fixture.theme) setThemeMode(fixture.theme);
  useState(() => {
    if (seeded) return;
    seeded = true;
    rememberSettingsCategory('about');
    if (fixture.platform === 'android') __showAndroidUpdateForFixture(androidState(fixture.state), { lastCheckedAt: Date.now() });
    else if (fixture.state === 'downloading') {
      __showDesktopUpdateForFixture({ kind: 'downloading', version: FIXTURE_NEXT, currentVersion: FIXTURE_CURRENT, source: 'github', percent: 35, downloaded: Math.round(SIZE * 0.35), total: SIZE });
    } else {
      __showDesktopUpdateForFixture({ kind: 'available', version: FIXTURE_NEXT, currentVersion: FIXTURE_CURRENT, source: 'github', notes: NOTES });
    }
  });
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} testID="update-prompt-fixture">
      <SettingsScreen
        cfg={FIXTURE_CFG}
        onLogout={() => {}}
        onLocalDataDeleted={() => {}}
        onAddAccount={() => {}}
        onSwitchProfile={() => {}}
        onReauthProfile={() => {}}
        notifyPreview={{
          platform: fixture.platform,
          permission: { status: 'granted', canAskAgain: true },
          keepAlive: { available: fixture.platform === 'android', running: true, error: null },
          guideOpen: false,
        }}
      />
      {fixture.platform === 'android' ? <AndroidUpdatePrompt currentVersion={FIXTURE_CURRENT} /> : <DesktopUpdatePrompt />}
    </SafeAreaView>
  );
}
