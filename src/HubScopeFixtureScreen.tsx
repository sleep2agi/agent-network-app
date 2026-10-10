/**
 * web GUI 验收夹具。不连 Hub。
 * `?fixture=hub-scope&section=skills|tokens|env|providers&theme=dark|light`
 * 左边是服务器管理侧栏，右边是对应的 Hub 页。概览 / 节点 / 新建节点 / 事件与日志仍可点，只标出名字。
 * 集成分段（SKILLS / 令牌 / Provider）同样可点，只标出名字，不替换三栏演示壳。
 */
import { useState } from 'react';
import { Platform, SafeAreaView, View } from 'react-native';
import { Text } from './ui-text';
import ServerSidebar, { type ServerSection } from './ServerSidebar';
import HubScopeScreen from './HubScopeScreen';
import { hubSectionForScreen, parseHubScopeFixture, screenForHubSection, type HubSection } from './hub-scope-demo';
import { t } from './i18n';
import './i18n-hub-scope';
import { colors, setThemeMode, spacing, themeMode, type as typeScale, weight } from './theme';
import type { HubConfig } from './api';

const DUMMY_CFG: HubConfig = { serverUrl: 'http://127.0.0.1:9', token: 'fixture', networkId: 'fixture-net' };

const PLACEHOLDER_LABEL: Partial<Record<ServerSection, string>> = {
  overview: 'server.overview',
  nodes: 'server.nodes',
  create: 'server.create',
  logs: 'server.logs',
  skills: 'server.pendingTitle.skills',
  tokens: 'server.pendingTitle.tokens',
  provider: 'server.pendingTitle.provider',
};

export function readHubScopeFixture(): { theme: 'dark' | 'light'; section: HubSection } | null {
  if (Platform.OS !== 'web') return null;
  try {
    return parseHubScopeFixture(String((globalThis as { location?: { search?: string } }).location?.search ?? ''));
  } catch {
    return null;
  }
}

export default function HubScopeFixtureScreen({ theme, section }: { theme: 'dark' | 'light'; section: HubSection }) {
  if (themeMode() !== theme) setThemeMode(theme);
  const [active, setActive] = useState<ServerSection>(screenForHubSection(section));
  const hub = hubSectionForScreen(active);
  return (
    <SafeAreaView testID="hub-scope-fixture" style={{ flex: 1, flexDirection: 'row', backgroundColor: colors.bg }}>
      <View style={{ width: 310, borderRightWidth: 1, borderRightColor: colors.border }}>
        <ServerSidebar cfg={DUMMY_CFG} active={active} onSelect={setActive} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        {hub ? <HubScopeScreen key={hub} section={hub} /> : (
          <View testID="hub-fixture-existing" style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.sm, backgroundColor: colors.bg }}>
            <Text style={{ color: colors.text, fontSize: typeScale.heading, fontWeight: weight.strong }}>{t(PLACEHOLDER_LABEL[active] ?? 'server.overview')}</Text>
          </View>
        )}
      </View>
    </SafeAreaView>
  );
}
