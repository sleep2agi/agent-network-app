/**
 * web GUI 验收夹具。不连 Hub、不碰 127.0.0.1:9200。
 * `?fixture=unread-badge&theme=dark|light&compact=1`
 *
 * 三行钉死 #161 视觉：有未读显示数字 / 无未读完全没有红点 / 超过 99 显示 99+。
 */
import { useEffect, useMemo } from 'react';
import { Platform, SafeAreaView, View } from 'react-native';
import AgentsScreen from './AgentsScreen';
import type { HubConfig, Session } from './api';
import {
  initialUnreadState,
  reduceUnread,
  type UnreadEvent,
} from './unread-ledger';
import { setThemeMode } from './theme';
import { colors } from './theme';

const DUMMY_CFG: HubConfig = { serverUrl: 'http://127.0.0.1:9', token: 'fixture' };

const session = (alias: string, status: string, task?: string): Session => ({
  alias,
  status,
  task,
});

function ledgerWith(events: UnreadEvent[]) {
  return events.reduce(reduceUnread, initialUnreadState());
}

export function readWebFixture(): { theme: 'dark' | 'light'; compact: boolean } | null {
  if (Platform.OS !== 'web') return null;
  try {
    const search = String((globalThis as { location?: { search?: string } }).location?.search ?? '');
    const params = new URLSearchParams(search);
    if (params.get('fixture') !== 'unread-badge') return null;
    const theme = params.get('theme') === 'light' ? 'light' : 'dark';
    return { theme, compact: params.get('compact') === '1' };
  } catch {
    return null;
  }
}

export default function UnreadBadgeFixtureScreen({
  theme,
  compact,
}: {
  theme: 'dark' | 'light';
  compact: boolean;
}) {
  useEffect(() => {
    setThemeMode(theme);
  }, [theme]);

  const preview = useMemo(() => ({
    sessions: [
      session('通信龙', 'idle', '刚刚发来一条任务'),
      session('打包牛', 'working', '正在打包'),
      session('测试马', 'idle', '堆积的未读'),
    ],
    ledger: ledgerWith([
      ...Array.from({ length: 3 }, () => ({ kind: 'message_arrived' as const, agent: '通信龙' })),
      ...Array.from({ length: 100 }, () => ({ kind: 'message_arrived' as const, agent: '测试马' })),
    ]),
    serverBody: { ok: true, messages: [], unread: 103, pending_count: 103 },
  }), []);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} testID="unread-badge-fixture">
      <View style={{ flex: 1 }}>
        <AgentsScreen
          cfg={DUMMY_CFG}
          compact={compact}
          preview={preview}
          onOpenChat={() => {}}
          onOpenPicker={() => {}}
          onOpenNodeDetail={() => {}}
        />
      </View>
    </SafeAreaView>
  );
}
