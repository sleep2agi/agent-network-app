/**
 * web GUI 验收夹具(0.2.107 手机通知设置)。不连 Hub。
 * `?fixture=notify-settings&platform=android|ios|desktop&theme=dark|light&guide=1`
 *
 * 浏览器里 Platform.OS 恒为 web,设置页会把安卓专属的行(后台保持连接 / 小米指引 / 测试通知)
 * 藏起来 —— 夹具通过 SettingsScreen 的 notifyPreview 按指定平台渲染,占位数据:
 * 两个免打扰的 agent、「后台保持连接」开着且在运行、通知权限已授予。
 */
import { Platform, SafeAreaView } from 'react-native';
import SettingsScreen from './SettingsScreen';
import type { HubConfig } from './api';
import { DEFAULT_NOTIFY_SETTINGS, saveNotifySettings } from './notify-settings';
import { rememberSettingsCategory, type SettingsPlatform } from './settings-model';
import { colors, setThemeMode, themeMode } from './theme';

const FIXTURE_CFG: HubConfig = { serverUrl: 'http://127.0.0.1:9', token: 'fixture', profileId: 'fixture', username: 'demo' };

export type NotifyFixture = { theme: 'dark' | 'light'; platform: SettingsPlatform; guide: boolean };

export function readNotifyFixture(): NotifyFixture | null {
  if (Platform.OS !== 'web') return null;
  try {
    const params = new URLSearchParams(String((globalThis as { location?: { search?: string } }).location?.search ?? ''));
    if (params.get('fixture') !== 'notify-settings') return null;
    const p = params.get('platform');
    const platform: SettingsPlatform = p === 'ios' || p === 'desktop' || p === 'web' ? p : 'android';
    return { theme: params.get('theme') === 'light' ? 'light' : 'dark', platform, guide: params.get('guide') === '1' };
  } catch {
    return null;
  }
}

let seeded = false;
export default function NotifySettingsFixtureScreen({ fixture }: { fixture: NotifyFixture }) {
  if (themeMode() !== fixture.theme) setThemeMode(fixture.theme);
  if (!seeded) {
    seeded = true;
    rememberSettingsCategory('notifications');
    saveNotifySettings({ ...DEFAULT_NOTIFY_SETTINGS, keepAlive: true, mutedByProfile: { fixture: ['构建助手', '日报机器人'] } });
  }
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} testID="notify-settings-fixture">
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
          guideOpen: fixture.guide,
        }}
      />
    </SafeAreaView>
  );
}
