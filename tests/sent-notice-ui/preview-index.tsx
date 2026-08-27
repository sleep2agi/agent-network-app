// 发送提示条的可视预览。四种情况各渲染一格,颜色和「弹不弹」都走真实代码,
// 所以「成功即安静」在图里是可见的空白,而不是靠说明文字声称的。
//
// 出图:
//   1) 临时把 package.json 的 main 指向本文件
//   2) bunx expo export --platform web --output-dir dist-preview
//   3) python3 -m http.server 4173 --directory dist-preview
//   4) 用 playwright 截 http://127.0.0.1:4173/?theme=light 与 ?theme=dark
//   5) 还原 package.json
// 产物在 docs/screenshots/sent-notice/。
import { useMemo } from 'react';
import { registerRootComponent } from 'expo';
import { ScrollView, Text, View } from 'react-native';
import ActualRecipientNotice from '../../src/ActualRecipientNotice';
import { sendNoticeFor, type SendConfirmation } from '../../src/actual-recipient';
import { colors, setThemeMode } from '../../src/theme';

const confirmation = (over: Partial<SendConfirmation>): SendConfirmation => ({
  actualRecipient: { alias: 'TM运维', toNodeId: 'node_1', networkId: 'net_a' },
  queued: false,
  ...over,
});

/** 每个格子都走真实的 sendNoticeFor,所以「成功不弹」在图里是可见的空。 */
const CASES: Array<{ label: string; confirmation: SendConfirmation; intended: string }> = [
  { label: '正常送达(成功即安静)', confirmation: confirmation({}), intended: 'TM运维' },
  { label: '旧版 Hub 未报告接收方', confirmation: confirmation({ actualRecipient: null }), intended: 'TM运维' },
  { label: '对方离线 → 排队', confirmation: confirmation({ queued: true }), intended: 'TM运维' },
  { label: 'Hub 改投到别的节点', confirmation: confirmation({}), intended: '老名字' },
];

function Preview() {
  const query = useMemo(() => new URLSearchParams(globalThis.location?.search ?? ''), []);
  setThemeMode(query.get('theme') === 'light' ? 'light' : 'dark');
  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={{ padding: 24 }}>
      {CASES.map(c => {
        const notice = sendNoticeFor(c.confirmation, c.intended);
        return (
          <View key={c.label} style={{ marginBottom: 28 }}>
            <Text style={{ color: colors.textSecondary, fontSize: 12, marginBottom: 8 }}>{c.label}</Text>
            <View style={{ minHeight: 34, justifyContent: 'center' }} testID={`case-${CASES.indexOf(c)}`}>
              {notice ? <ActualRecipientNotice notice={notice} /> : (
                <Text style={{ color: colors.textMuted, fontSize: 11 }}>（不显示任何提示）</Text>
              )}
            </View>
          </View>
        );
      })}
    </ScrollView>
  );
}

registerRootComponent(Preview);
