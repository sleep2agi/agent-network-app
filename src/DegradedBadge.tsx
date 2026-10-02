// 节点「降级」徽标(board #460):琥珀小胶囊「降级 · App Server 断开」。不降级 / 不知道时什么都不画。
// 详情:指针悬停出提示条,点按出同一条提示(4 秒),与连接状态角标(ConnectivityIndicator)同一套交互;
// 完整原因始终在 accessibilityLabel 里(读屏不用点开)。判据在 node-degraded.ts。
//
// 提示条朝**上**弹:列表里后面的行会盖住前面行里绝对定位的东西,朝上压在上一行上才看得见。
import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from './ui-text';
import { colors, radius } from './theme';
import { degradedDetailLines, type NodeDegraded } from './node-degraded';

export const DEGRADED_TIP_MS = 4_000;

export default function DegradedBadge({ info, testID, size = 'row' }: { info: NodeDegraded | null; testID?: string; size?: 'row' | 'header' }) {
  const styles = useMemo(makeStyles, []);
  const [hovered, setHovered] = useState(false);
  const [tapped, setTapped] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  if (!info) return null;
  const onPress = () => {
    setTapped(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setTapped(false), DEGRADED_TIP_MS);
  };
  return (
    <View style={styles.wrap}>
      <Pressable
        testID={testID}
        accessibilityRole="button"
        accessibilityLabel={info.summary}
        accessibilityHint="查看降级原因"
        onPress={onPress}
        onHoverIn={() => setHovered(true)}
        onHoverOut={() => setHovered(false)}
        hitSlop={6}
        style={[styles.pill, size === 'header' && styles.pillHeader]}
      >
        <Text dense selectable={false} numberOfLines={1} style={[styles.text, size === 'header' && styles.textHeader]}>{`降级 · ${info.short}`}</Text>
      </Pressable>
      {hovered || tapped ? (
        <View testID={testID ? `${testID}-tip` : undefined} pointerEvents="none" style={styles.tip}>
          <Text style={styles.tipTitle}>{info.summary}</Text>
          {degradedDetailLines(info).map(line => <Text key={line} style={styles.tipLine}>{line}</Text>)}
          <Text style={styles.tipLine}>新任务会被拒收,修好后自动恢复</Text>
        </View>
      ) : null}
    </View>
  );
}

const makeStyles = () => StyleSheet.create({
  wrap: { flexShrink: 0, zIndex: 20 },
  pill: { borderRadius: radius.pill, paddingHorizontal: 6, paddingVertical: 1, backgroundColor: colors.blocked + '26', borderWidth: StyleSheet.hairlineWidth, borderColor: colors.blocked },
  pillHeader: { paddingHorizontal: 8, paddingVertical: 2 },
  text: { color: colors.blocked, fontSize: 11, fontWeight: '600' },
  textHeader: { fontSize: 12 },
  // 右缘对齐徽标右缘、向左展开:徽标总在名字右边,左边有头像 + 名字那么宽的地方;向右展开会被窄侧栏裁掉。
  tip: { position: 'absolute', bottom: '100%', marginBottom: 6, right: 0, paddingHorizontal: 10, paddingVertical: 6, borderRadius: radius.item, backgroundColor: colors.railTooltipBg, width: 220, zIndex: 40 },
  tipTitle: { color: colors.railTooltipText, fontSize: 12, fontWeight: '600', lineHeight: 17 },
  tipLine: { color: colors.railTooltipText, opacity: 0.8, fontSize: 11, lineHeight: 16, marginTop: 2 },
});
