import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Platform, Pressable, StyleSheet, View, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';
import { Text } from './ui-text';

import { bannerText, connectivityState, connectivityVersion, requestReconnect, subscribeConnectivity, type ConnectivityState } from './connectivity';
import { colors, radius } from './theme';

// 连接状态角标(取代 0.2.178 及以前的全宽顶部横幅 ConnectivityBanner)。
//
// Vincent 2026-10-01(iPad 宽屏截图,v0.2.178):顶上一整条橙色「连接较慢 · 数据可能稍有延迟」太丑、
// 截图全毁,「缩到角落里,让我知道就行」。判断何时慢/连不上的逻辑不动(src/connectivity.ts),
// 只换呈现:
//   - 宽屏(桌面 rail、iPad 横屏 / 安卓展开的 MobileNavRail):左栏底部版本号左边一个小圆点;
//     指针悬停出提示条,点按出同一条提示(并立即重试)。
//   - 手机:内容区右上角一个小圆点(绝对定位,不占位、不推内容),点按出提示。
// 颜色:琥珀 = 连接较慢;琥珀空心环 = 正在重试;红 = 无法连接。在线时什么都不画。
// 完整文案始终在 accessibilityLabel 里(读屏不用点开)。
// 守卫:src/connectivity-indicator.test.ts(静态)+ tests/test-connectivity-indicator/drive.mjs(量框)。

/** 点按后提示条停留多久。 */
export const INDICATOR_TIP_MS = 4_000;

type Placement = 'rail' | 'corner';

function dotStyle(s: ConnectivityState): ViewStyle {
  if (s.level === 'offline') return { backgroundColor: colors.failed };
  // 正在重试(读在失败、还没到「连不上」):空心环,和「数据到了只是慢」区分开。
  if (s.reconnecting) return { borderWidth: 1.5, borderColor: colors.blocked, backgroundColor: 'transparent' };
  return { backgroundColor: colors.blocked };
}

export default function ConnectivityIndicator({ placement, label, labelStyle, style }: {
  placement: Placement;
  /** rail:圆点挂在这段文字(版本号)左边;不传 = 只有圆点。 */
  label?: string;
  labelStyle?: StyleProp<TextStyle>;
  style?: StyleProp<ViewStyle>;
}) {
  useSyncExternalStore(subscribeConnectivity, connectivityVersion, connectivityVersion);
  // AppRoot is keyed by theme, so this remounts on a theme change and rebuilds its styles.
  const styles = useMemo(makeStyles, []);
  const s = connectivityState();
  const text = bannerText(s);
  const [hovered, setHovered] = useState(false);
  const [tapped, setTapped] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  useEffect(() => { if (!text) setTapped(false); }, [text]);

  // 在线:rail 上只剩版本号,手机角标不画。
  if (!text) {
    // 圆点的位置在线时也留着(空槽),状态翻转时版本号一像素都不动。
    if (placement === 'rail' && label) return <View style={[styles.railWrap, style]}><View style={styles.railRow}><View style={styles.railDotSlot} /><Text testID="rail-version" style={labelStyle}>{label}</Text></View></View>;
    return null;
  }

  const onPress = () => {
    requestReconnect();
    setTapped(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setTapped(false), INDICATOR_TIP_MS);
  };
  const dot = <View testID={`connectivity-indicator-${s.level}`} style={[styles.dot, dotStyle(s)]} />;
  const tip = hovered || tapped ? (
    <View testID="connectivity-indicator-tip" pointerEvents="none" style={[styles.tip, placement === 'rail' ? styles.tipRail : styles.tipCorner]}>
      <Text style={styles.tipText}>{text}</Text>
      {s.level === 'offline' ? <Text style={styles.tipHint}>已立即重试</Text> : null}
    </View>
  ) : null;
  const a11y = {
    testID: 'connectivity-indicator',
    accessibilityRole: 'button' as const,
    accessibilityLabel: text,
    accessibilityHint: '立即重试',
    onPress,
    onHoverIn: () => setHovered(true),
    onHoverOut: () => setHovered(false),
  };

  if (placement === 'rail') {
    return (
      <View style={[styles.railWrap, style]}>
        <Pressable {...a11y} hitSlop={label ? { top: 6, bottom: 6, left: 4, right: 4 } : { left: 12, right: 12, bottom: 4 }} style={styles.railRow}>
          {/* 圆点占版本号左边一个固定的槽(在线时是空槽),整行居中、不出 rail 边、不随状态挪动。 */}
          <View style={label ? styles.railDotSlot : styles.railDotAlone}>{dot}</View>
          {label ? <Text testID="rail-version" style={labelStyle}>{label}</Text> : null}
        </Pressable>
        {tip}
      </View>
    );
  }
  return (
    <View style={[styles.corner, style]} pointerEvents="box-none">
      <Pressable {...a11y} style={styles.cornerHit}>{dot}</Pressable>
      {tip}
    </View>
  );
}

const DOT = 7;
// 提示条挂在一个很窄的锚点上,按锚点宽度收缩会一字一行:web 上按内容取宽(封顶 maxWidth),原生给定宽。
const tipWidth = (native: number) => (Platform.OS === 'web' ? ({ width: 'max-content' } as unknown as ViewStyle) : { width: native });
const makeStyles = () => StyleSheet.create({
  dot: { width: DOT, height: DOT, borderRadius: radius.pill },
  railWrap: { alignSelf: 'center', zIndex: 30 },
  railRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  railDotSlot: { width: DOT, height: DOT, marginRight: 3, alignItems: 'center', justifyContent: 'center' },
  // 矮屏只有圆点:8×8,正好放进 rail 底部 8 的留白,不碰「设置」的命中区。
  railDotAlone: { width: 8, height: 8, alignItems: 'center', justifyContent: 'center' },
  // 手机:内容区右上角,贴边;14×14 的命中区只占角上的空白,不压标题栏按钮(drive 量重叠)。
  corner: { position: 'absolute', top: 0, right: 0, zIndex: 30, alignItems: 'flex-end' },
  cornerHit: { width: 14, height: 14, alignItems: 'center', justifyContent: 'center' },
  tip: { position: 'absolute', paddingHorizontal: 10, paddingVertical: 6, borderRadius: radius.item, backgroundColor: colors.railTooltipBg, maxWidth: 280, zIndex: 40 },
  // rail 提示条挂在左栏右侧(同 rail 按钮的悬停提示),底边对齐版本号。
  tipRail: { left: '100%', marginLeft: 16, bottom: -4, ...tipWidth(260) },
  tipCorner: { top: 16, right: 4, ...tipWidth(240) },
  tipText: { color: colors.railTooltipText, fontSize: 12, fontWeight: '500', lineHeight: 17 },
  tipHint: { color: colors.railTooltipText, opacity: 0.7, fontSize: 11, marginTop: 2 },
});
