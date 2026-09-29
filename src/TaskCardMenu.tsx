// 任务卡片的浮动菜单:桌面右键 / 键盘菜单键,手机长按。同一份项目:查看详情 + 移到 需求池/进行中/完成。
// 定位复用会话行菜单的规则(agent-row-menu.ts anchorRowMenu / rowMenuMetrics):一个角贴着按下点,
// 放不下就翻边、夹进屏幕。Modal 是为了安卓返回键(onRequestClose)与 web 的 Esc。
import { useState } from 'react';
import { Modal, Pressable, View, useWindowDimensions } from 'react-native';
import { Text } from './ui-text';
import { Ionicons } from './icons';
import { colors, radius, themeMode } from './theme';
import { elevated } from './elevation';
import { uiScale } from './ui-scale';
import { useModalSafePadding } from './safe-area-runtime';
import { anchorRowMenu, rowMenuHeight, rowMenuMetrics } from './agent-row-menu';
import { REQ_COLUMN_LABEL, REQ_COLUMNS, type ReqColumn } from './requirements-model';

export interface TaskMenuTarget { id: string; title: string; column: ReqColumn; x: number; y: number }

export default function TaskCardMenu({ target, touch, busy, onOpen, onMove, onClose }: {
  target: TaskMenuTarget | null;
  /** 手机长按:44 行高 + 淡遮罩;桌面右键:紧凑行高 + 透明遮罩。 */
  touch: boolean;
  /** 这张卡片的状态正在保存:移动项不可点。 */
  busy: boolean;
  onOpen: (id: string) => void;
  onMove: (id: string, to: ReqColumn) => void;
  onClose: () => void;
}) {
  const win = useWindowDimensions();
  const safe = useModalSafePadding('fullScreen');
  const [area, setArea] = useState<{ width: number; height: number } | null>(null);
  const m = rowMenuMetrics(touch, uiScale().densityFactor, uiScale().denseFontMultiplier);
  const count = 1 + REQ_COLUMNS.length;
  const pos = target ? anchorRowMenu({
    x: target.x, y: target.y,
    menuWidth: m.width, menuHeight: rowMenuHeight(m, count) + 1,
    viewportWidth: area?.width ?? win.width, viewportHeight: area?.height ?? win.height,
    insets: touch ? { top: safe.paddingTop, bottom: safe.paddingBottom, left: safe.paddingLeft, right: safe.paddingRight } : undefined,
  }) : null;
  const scrim = touch ? (themeMode() === 'dark' ? 'rgba(0,0,0,0.45)' : 'rgba(0,0,0,0.18)') : 'transparent';
  const item = (key: string, label: string, onPress: () => void, opts: { disabled?: boolean; checked?: boolean; icon: string }) => (
    <Pressable
      key={key}
      testID={`task-menu-${key}`}
      accessibilityRole="menuitem"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!opts.disabled, checked: opts.checked }}
      disabled={opts.disabled}
      onPress={onPress}
      style={state => ({
        height: m.itemHeight, paddingHorizontal: m.padX, flexDirection: 'row', alignItems: 'center', gap: 10,
        backgroundColor: (state as { hovered?: boolean }).hovered || state.pressed ? colors.rowHover : 'transparent',
        opacity: opts.disabled && !opts.checked ? 0.45 : 1,
      })}
    >
      <Ionicons name={opts.icon as never} size={15} color={opts.checked ? colors.accent : colors.textSecondary} />
      <Text style={{ flex: 1, color: opts.checked ? colors.accent : colors.text, fontSize: m.fontSize }} numberOfLines={1}>{label}</Text>
    </Pressable>
  );

  return (
    <Modal visible={!!target} transparent animationType="fade" onRequestClose={onClose}>
      <View style={{ flex: 1 }} onLayout={e => setArea({ width: e.nativeEvent.layout.width, height: e.nativeEvent.layout.height })}>
        <Pressable
          testID="task-menu-scrim"
          accessibilityLabel="关闭菜单"
          onPress={onClose}
          style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, backgroundColor: scrim }}
          {...({ onContextMenu: (e: { preventDefault?: () => void }) => { e?.preventDefault?.(); onClose(); } } as object)}
        />
        {target && pos ? (
          <View
            testID="task-menu"
            accessibilityRole="menu"
            accessibilityLabel={`${target.title} 的菜单`}
            style={{
              position: 'absolute', left: pos.left, top: pos.top, width: m.width, paddingVertical: m.padY,
              borderRadius: radius.control, backgroundColor: colors.card, overflow: 'hidden',
              ...elevated('floating'),
            }}
          >
            {item('open', '查看详情', () => { onClose(); onOpen(target.id); }, { icon: 'open-outline' })}
            <View style={{ height: 1, marginVertical: 0, backgroundColor: colors.border }} />
            {REQ_COLUMNS.map(col => item(`move-${col}`, col === target.column ? `当前：${REQ_COLUMN_LABEL[col]}` : `移到 ${REQ_COLUMN_LABEL[col]}`, () => { onClose(); onMove(target.id, col); }, {
              disabled: busy || col === target.column, checked: col === target.column, icon: col === target.column ? 'checkmark' : 'arrow-forward',
            }))}
          </View>
        ) : null}
      </View>
    </Modal>
  );
}
