/**
 * web GUI 验收夹具。不连 Hub，也不提交。
 * `?fixture=clone-node&theme=dark|light`
 */
import { Platform, View } from 'react-native';
import CloneNodeDialog from './CloneNodeDialog';
import { setLanguagePreference } from './i18n';
import './i18n-node-clone';
import { colors } from './theme';
import type { HubConfig } from './api';

const DUMMY_CFG: HubConfig = { serverUrl: 'http://127.0.0.1:9', token: 'fixture', networkId: 'fixture-net' };

export function readCloneNodeFixture(): { theme: 'dark' | 'light' } | null {
  if (Platform.OS !== 'web') return null;
  try {
    const q = new URLSearchParams(String((globalThis as { location?: { search?: string } }).location?.search ?? '').replace(/^\?/, ''));
    if (q.get('fixture') !== 'clone-node') return null;
    return { theme: q.get('theme') === 'light' ? 'light' : 'dark' };
  } catch {
    return null;
  }
}

export default function CloneNodeFixtureScreen() {
  setLanguagePreference('zh');
  return (
    <View testID="clone-node-fixture" style={{ flex: 1, backgroundColor: colors.bg }}>
      <CloneNodeDialog
        cfg={DUMMY_CFG}
        source={{ nodeId: 'node_src', alias: 'planner', name: 'planner', daemonNodeId: 'node_daemon' }}
        takenNames={['planner', 'planner-copy']}
        onClose={() => {}}
        onDone={() => {}}
      />
    </View>
  );
}
