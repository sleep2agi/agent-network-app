/**
 * web GUI 验收夹具(更新弹窗)。不连 Hub、不打网络。
 * `?fixture=update-prompt&platform=android|desktop&state=available|downloading|verifying|fallback|error|ready|uptodate&theme=dark|light`
 * `&current=0.2.153`:换一个已装版本 —— 说明里会出现比它新的每一版(多版本分组)。
 *
 * 背后是 设置 → 关于(按安卓渲染:版本 / 软件更新),前面是对应状态的更新弹窗。
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
export const FIXTURE_CURRENT = '0.2.156';
export const FIXTURE_NEXT = '0.2.157';
const SIZE = 80_321_331; // ≈ 76.6 MB
// 公开 release desktop-v0.2.157 的正文形状(累积了旧版本;开头前言、结尾尾注都在),用来验证解析和排版。
const NOTES = `Signed and notarized stable update for macOS (Apple Silicon) and Windows (x64).

What's new in ${FIXTURE_NEXT}:
- 用户管理：成员的「可访问范围」可在「全部 Agent / 仅指定 Agent」之间切换；从全部切到仅指定时，会先勾好成员当前能看到的 Agent。
- 修复：给升级前就加入的成员分配 Agent 并保存后，对方仍能看到并联系全部 Agent。
- 只读成员不再显示「可对话」开关（桌面显示「只读」）；网络所有者可以修改成员角色，所有者或管理员可以把成员移出网络。
- 任务页新增「甘特图」视图（只读）：按项目或负责 Agent 分组，日 / 周刻度，点条打开任务详情；Hub 还没有开始日期，开始按创建时间算。手机上改为按周分组的列表。

What's new in ${FIXTURE_CURRENT}:
- 设置 → 账号里新增「登录设备」：查看这个账号在哪些设备上登录、最近何时使用，可以退出某台设备或「退出其他所有设备」。
- 登录过期时会提示「登录已过期，请重新登录」。

What's new in 0.2.155:
- 优先级显示为 P0 / P1 / P2 / P3（紧凑徽标）。

What's new in 0.2.154:
- 任务描述可直接在排版后的内容上编辑，仍存为 Markdown，可切回「源码」编辑；手机不变。

Existing installations can update in place; new installations can use the assets below.`;

export type UpdatePromptFixture = { theme: 'dark' | 'light'; platform: 'android' | 'desktop'; state: string; current: string };

export function readUpdatePromptFixture(): UpdatePromptFixture | null {
  if (Platform.OS !== 'web') return null;
  try {
    const params = new URLSearchParams(String((globalThis as { location?: { search?: string } }).location?.search ?? ''));
    if (params.get('fixture') !== 'update-prompt') return null;
    return {
      theme: params.get('theme') === 'light' ? 'light' : 'dark',
      platform: params.get('platform') === 'desktop' ? 'desktop' : 'android',
      state: params.get('state') || 'available',
      current: /^\d+\.\d+\.\d+$/.test(params.get('current') ?? '') ? params.get('current')! : FIXTURE_CURRENT,
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
    case 'downloading': return { ...rel, kind: 'downloading', route: 'mirror', percent: 44, written: Math.round(SIZE * 0.44), total: SIZE };
    case 'verifying': return { ...rel, kind: 'downloading', route: 'mirror', percent: 100, written: SIZE, total: SIZE, verifying: true };
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
    else {
      __showDesktopUpdateForFixture({ kind: 'available', version: FIXTURE_NEXT, currentVersion: fixture.current, source: 'github', notes: NOTES });
      // 真实流程:先「有新版本」,点了之后进入下载 —— 说明沿用上一步那份。
      if (fixture.state === 'downloading') __showDesktopUpdateForFixture({ kind: 'downloading', version: FIXTURE_NEXT, currentVersion: fixture.current, source: 'github', percent: 44, downloaded: Math.round(SIZE * 0.44), total: SIZE });
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
      {fixture.platform === 'android' ? <AndroidUpdatePrompt currentVersion={fixture.current} /> : <DesktopUpdatePrompt />}
    </SafeAreaView>
  );
}
