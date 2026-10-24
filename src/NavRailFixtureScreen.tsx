// 用法:`?fixture=nav-rail&icons=1|0&theme=light|dark`
// 折叠屏宽窗左侧导航:带标签(<=900 dp)与纯图标(>=900 dp,对齐桌面端)并排对比,改版前后截图用。
// 只存在于 web 自检构建,不进原生包。
import { SafeAreaView, View } from 'react-native';
import MobileNavRail, { MobileNavTab } from './MobileNavRail';
import { colors } from './theme';

const TABS: readonly MobileNavTab[] = [
  { key: 'agents', label: 'nav.agents', icon: 'people-outline', iconActive: 'people' },
  { key: 'tasks', label: 'nav.tasks', icon: 'list-outline', iconActive: 'list' },
  { key: 'scheduled', label: 'nav.scheduled', icon: 'time-outline', iconActive: 'time' },
  { key: 'server', label: 'nav.server', icon: 'server-outline', iconActive: 'server' },
  { key: 'settings', label: 'nav.settings', icon: 'settings-outline', iconActive: 'settings' },
];

export function readNavRailFixture(search = globalThis.location?.search ?? ''): { icons: boolean } | null {
  const q = new URLSearchParams(search);
  if (q.get('fixture') !== 'nav-rail') return null;
  return { icons: q.get('icons') === '1' };
}

export default function NavRailFixtureScreen({ icons }: { icons: boolean }) {
  return (
    <SafeAreaView testID="nav-rail-fixture" style={{ flex: 1, flexDirection: 'row', backgroundColor: colors.bg }}>
      <MobileNavRail tabs={TABS} active="agents" onSelect={() => {}} insetLeft={0} insetBottom={0} showBrand iconsOnly={icons} />
      <View style={{ flex: 1, backgroundColor: colors.bg }} />
    </SafeAreaView>
  );
}
