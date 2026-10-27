// 用法:`?fixture=nav-rail&icons=1|0&hub=skills&theme=light|dark`
// 折叠屏宽窗左侧导航:带标签(<=900 dp)与纯图标(>=900 dp,对齐桌面端)并排对比,改版前后截图用。
// 带 `hub=` 时右侧渲染 Hub 设置页,复现 admin 2026-10-24 那张小米折叠屏截图(导航 + Hub 设置)。
// 只存在于 web 自检构建,不进原生包。
import { SafeAreaView, View } from 'react-native';
import MobileNavRail, { MobileNavTab } from './MobileNavRail';
import HubScopeScreen from './HubScopeScreen';
import { isHubSection } from './hub-scope-demo';
import { colors } from './theme';

const TABS: readonly MobileNavTab[] = [
  { key: 'agents', label: 'nav.agents', icon: 'people-outline', iconActive: 'people' },
  { key: 'tasks', label: 'nav.tasks', icon: 'list-outline', iconActive: 'list' },
  { key: 'scheduled', label: 'nav.scheduled', icon: 'time-outline', iconActive: 'time' },
  { key: 'server', label: 'nav.server', icon: 'server-outline', iconActive: 'server' },
  { key: 'settings', label: 'nav.settings', icon: 'settings-outline', iconActive: 'settings' },
];

export function readNavRailFixture(search = globalThis.location?.search ?? ''): { icons: boolean; hub: string | null } | null {
  const q = new URLSearchParams(search);
  if (q.get('fixture') !== 'nav-rail') return null;
  const hub = q.get('hub');
  return { icons: q.get('icons') === '1', hub: hub && isHubSection(hub) ? hub : null };
}

export default function NavRailFixtureScreen({ icons, hub }: { icons: boolean; hub: string | null }) {
  return (
    <SafeAreaView testID="nav-rail-fixture" style={{ flex: 1, flexDirection: 'row', backgroundColor: colors.bg }}>
      <MobileNavRail
        tabs={TABS}
        active={hub ? 'server' : 'agents'}
        onSelect={() => {}}
        insetLeft={0}
        insetBottom={0}
        showBrand
        iconsOnly={icons}
      />
      <View style={{ flex: 1, minWidth: 0, backgroundColor: colors.bg }}>
        {hub && isHubSection(hub) ? <HubScopeScreen key={hub} section={hub} /> : null}
      </View>
    </SafeAreaView>
  );
}
