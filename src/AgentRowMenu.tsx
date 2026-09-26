// 会话行的浮动菜单(微信长按会话的形状):一块小白卡贴在按下点,四周一层淡遮罩。
// 手机 / 安卓双栏 = 长按;桌面 = 右键。菜单项与定位的规则在 agent-row-menu.ts(纯函数,有测试)。
//
// 用 Modal 而不是页面内绝对定位:Android 返回键只会以 onRequestClose 的形式送到 Modal
// (chat-overlay-back.test.ts 要求每个 Modal 都有真的 onRequestClose);react-native-web 也把 Esc 送到同一个 prop。
import { useEffect, useState } from 'react';
import { AccessibilityInfo, Modal, Platform, Pressable, View, useWindowDimensions } from 'react-native';
import * as Haptics from 'expo-haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Text } from './ui-text';
import { colors, themeMode } from './theme';
import { uiScale } from './ui-scale';
import { anchorRowMenu, rowMenuHeight, rowMenuMetrics, type AgentRowMenuItem, type AgentRowMenuKey } from './agent-row-menu';

export interface AgentRowMenuTarget {
  alias: string;
  /** 按下点(pageX / pageY)。 */
  x: number;
  y: number;
}

function useReduceMotion(): boolean {
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    let alive = true;
    AccessibilityInfo.isReduceMotionEnabled?.().then(v => { if (alive) setReduce(!!v); }).catch(() => {});
    const sub = AccessibilityInfo.addEventListener?.('reduceMotionChanged', (v: boolean) => setReduce(!!v));
    return () => { alive = false; sub?.remove?.(); };
  }, []);
  return reduce;
}

export default function AgentRowMenu({
  target,
  items,
  touch,
  onSelect,
  onClose,
}: {
  target: AgentRowMenuTarget | null;
  items: readonly AgentRowMenuItem[];
  /** 手机 / 双栏(长按)还是桌面(右键):决定行高、字号、遮罩深浅。 */
  touch: boolean;
  onSelect: (key: AgentRowMenuKey, alias: string) => void;
  onClose: () => void;
}) {
  const reduceMotion = useReduceMotion();
  const win = useWindowDimensions();
  const insets = useSafeAreaInsets();
  // Modal 铺满后的真实尺寸(安卓 edge-to-edge 下与窗口一致;先用窗口尺寸,量到了再换)。
  const [area, setArea] = useState<{ width: number; height: number } | null>(null);
  const open = !!target;

  // 轻触感反馈:只在原生触摸端、菜单打开那一刻。
  useEffect(() => {
    if (!open || !touch || Platform.OS === 'web') return;
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
  }, [open, touch]);

  const m = rowMenuMetrics(touch, uiScale().densityFactor, uiScale().denseFontMultiplier);
  const menuHeight = rowMenuHeight(m, items.length);
  const pos = target ? anchorRowMenu({
    x: target.x,
    y: target.y,
    menuWidth: m.width,
    menuHeight,
    viewportWidth: area?.width ?? win.width,
    viewportHeight: area?.height ?? win.height,
    insets: touch ? { top: insets.top, bottom: insets.bottom, left: insets.left, right: insets.right } : undefined,
  }) : null;
  // 手机长按:淡遮罩(微信同款,让菜单从列表里「浮」出来);桌面右键:透明,和系统右键菜单一样只截住外部点击。
  const scrim = touch ? (themeMode() === 'dark' ? 'rgba(0,0,0,0.45)' : 'rgba(0,0,0,0.18)') : 'transparent';

  return (
    <Modal
      visible={open}
      transparent
      animationType={reduceMotion ? 'none' : 'fade'}
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={onClose}
    >
      <View
        style={{ flex: 1 }}
        onLayout={e => setArea({ width: e.nativeEvent.layout.width, height: e.nativeEvent.layout.height })}
        testID="agent-row-menu-layer"
      >
        <Pressable
          testID="agent-row-menu-scrim"
          accessibilityLabel="关闭会话菜单"
          onPress={onClose}
          style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, backgroundColor: scrim }}
          {...({ onContextMenu: (e: any) => { e?.preventDefault?.(); onClose(); } } as object)}
        />
        {target && pos ? (
          <View
            testID="agent-row-menu"
            accessibilityRole="menu"
            accessibilityLabel={`${target.alias} 的会话菜单`}
            {...({ dataSet: { menuVertical: pos.vertical, menuHorizontal: pos.horizontal } } as object)}
            style={{
              position: 'absolute',
              left: pos.left,
              top: pos.top,
              width: m.width,
              paddingVertical: m.padY,
              borderRadius: m.radius,
              backgroundColor: colors.card,
              borderWidth: themeMode() === 'dark' ? 1 : 0,
              borderColor: colors.border,
              shadowColor: '#000',
              shadowOpacity: 0.18,
              shadowRadius: 16,
              shadowOffset: { width: 0, height: 6 },
              elevation: 8,
              overflow: 'hidden',
            }}
          >
            {items.map(item => (
              <Pressable
                key={item.key}
                testID={`agent-row-menu-${item.key}`}
                accessibilityRole="menuitem"
                accessibilityLabel={item.label}
                onPress={() => { onClose(); onSelect(item.key, target.alias); }}
                style={({ pressed, hovered }: any) => ({
                  height: m.itemHeight,
                  paddingHorizontal: m.padX,
                  justifyContent: 'center',
                  alignItems: 'flex-start',
                  backgroundColor: pressed || hovered ? colors.rowHover : 'transparent',
                })}
              >
                <Text
                  dense
                  selectable={false}
                  numberOfLines={1}
                  style={{ color: colors.text, fontSize: touch ? 15 : 13, includeFontPadding: false, textAlignVertical: 'center' }}
                >
                  {item.label}
                </Text>
              </Pressable>
            ))}
          </View>
        ) : null}
      </View>
    </Modal>
  );
}
