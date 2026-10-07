import { t as tr } from './i18n';
import { useTaskBoard } from './task-board-store';
import { statusChoices, supportsAbandoned } from './requirement-columns';
import { useTranslation } from './i18n-react';
import { taskText } from './i18n-tasks';
// 任务卡片的浮动菜单:桌面右键 / 键盘菜单键,手机长按。同一份项目:查看详情 · 指派负责人… · 设置参与人… ·
// 移到 需求池/进行中/完成 + 优先级 P0…P3(桌面,当前那一档打 ✓;审计 M2:以前桌面右键没有改优先级,只有手机能改);
// 手机长按把三个「移到」和四档优先级换成「改状态…」「改优先级…」两个选择器(task-quick-status.ts),
// 参与人的卡只有改状态能点(优先级在桌面也一样灰掉)。指派两项:旧 Hub 的卡不出现;卡对我只读时灰掉(Hub 不许参与人改人,task-assign.ts)。
// 定位复用会话行菜单的规则(agent-row-menu.ts anchorRowMenu / rowMenuMetrics):一个角贴着按下点,
// 放不下就翻边、夹进屏幕。Modal 是为了安卓返回键(onRequestClose)与 web 的 Esc。
import { useState } from 'react';
import { Modal, Pressable, View, useWindowDimensions } from 'react-native';
import { a11yState } from './TaskBoardParts';
import { Text } from './ui-text';
import { Ionicons } from './icons';
import { colors, radius, themeMode } from './theme';
import { elevated } from './elevation';
import { uiScale } from './ui-scale';
import { useModalSafePadding } from './safe-area-runtime';
import { anchorRowMenu, rowMenuHeight, rowMenuMetrics } from './agent-row-menu';
import { REQ_COLUMN_LABEL, type ReqColumn, type ReqPriority } from './requirements-model';
import { priorityLabel } from './task-priority';

export interface TaskMenuTarget {
  id: string; title: string; column: ReqColumn; x: number; y: number; assign: 'on' | 'locked' | 'hidden'; quick: { status: 'on' | 'locked'; priority: 'on' | 'locked' };
  /** 当前优先级与可选档(priorityChoices:旧 Hub 没有 P3,已经是 P3 的卡仍列出来)。桌面菜单直接列这几档。 */
  priority: ReqPriority; priorities: readonly ReqPriority[];
  /** 'archive' = 末尾给「归档」,'hidden' = 不给(旧 Hub 没有归档能力 / 卡对我只读)。看板上的卡都是没归档的。 */
  archive?: 'archive' | 'hidden';
}

export default function TaskCardMenu({ target, touch, busy, onOpen, onAssign, onMove, onQuick, onPriority, onArchive, onClose }: {
  target: TaskMenuTarget | null;
  /** 手机长按:44 行高 + 淡遮罩;桌面右键:紧凑行高 + 透明遮罩。 */
  touch: boolean;
  /** 这张卡片的状态正在保存:移动项不可点。 */
  busy: boolean;
  onOpen: (id: string) => void;
  onAssign: (id: string, mode: 'owner' | 'participants') => void;
  onMove: (id: string, to: ReqColumn) => void;
  /** 手机:「改状态…」/「改优先级…」→ 父级弹选择器(锚在按下点)。 */
  onQuick: (id: string, kind: 'status' | 'priority', at: { x: number; y: number }) => void;
  /** 桌面:菜单里直接点某一档优先级(和列表单元格同一条 PATCH:editCell priority)。 */
  onPriority: (id: string, priority: ReqPriority) => void;
  /** 「归档」(可撤销,不再确认;看板随后给一条带「撤销」的提示)。 */
  onArchive?: (id: string) => void;
  onClose: () => void;
}) {
  useTranslation();
  // 「废弃」只在认识它的 Hub 上给(旧 Hub 写它会 400)。
  const columns = statusChoices(useTaskBoard(st => supportsAbandoned(st.capabilities)));
  const win = useWindowDimensions();
  const safe = useModalSafePadding('fullScreen');
  const [area, setArea] = useState<{ width: number; height: number } | null>(null);
  const m = rowMenuMetrics(touch, uiScale().densityFactor, uiScale().denseFontMultiplier);
  const assignRows = target && target.assign !== 'hidden' ? 2 : 0;
  const priorityRows = target && !touch ? target.priorities.length : 0;
  const archiveRow = target?.archive === 'archive' && onArchive ? 1 : 0;
  const count = 1 + assignRows + (touch ? 2 : columns.length) + priorityRows + archiveRow;
  const pos = target ? anchorRowMenu({
    x: target.x, y: target.y,
    menuWidth: m.width, menuHeight: rowMenuHeight(m, count) + 1 + (priorityRows ? 1 : 0),
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
      {...a11yState({ disabled: !!opts.disabled, checked: opts.checked })}
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
          accessibilityLabel={tr('tasks.copy.88')}
          onPress={onClose}
          style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, backgroundColor: scrim }}
          {...({ onContextMenu: (e: { preventDefault?: () => void }) => { e?.preventDefault?.(); onClose(); } } as object)}
        />
        {target && pos ? (
          <View
            testID="task-menu"
            accessibilityRole="menu"
            accessibilityLabel={tr('tasks.copy.89', { v0: target.title })}
            style={{
              position: 'absolute', left: pos.left, top: pos.top, width: m.width, paddingVertical: m.padY,
              borderRadius: radius.control, backgroundColor: colors.card, overflow: 'hidden',
              ...elevated('floating'),
            }}
          >
            {item('open', tr('tasks.copy.90'), () => { onClose(); onOpen(target.id); }, { icon: 'open-outline' })}
            {target.assign !== 'hidden' ? (['owner', 'participants'] as const).map(mode => item(
              `assign-${mode}`,
              tr(mode === 'owner' ? 'assign.owner' : 'assign.participants'),
              () => { onClose(); onAssign(target.id, mode); },
              { icon: mode === 'owner' ? 'person-outline' : 'people-outline', disabled: target.assign === 'locked' },
            )) : null}
            <View style={{ height: 1, marginVertical: 0, backgroundColor: colors.border }} />
            {touch ? (['status', 'priority'] as const).map(kind => item(
              kind,
              tr(kind === 'status' ? 'quick.status' : 'quick.priority'),
              () => { onClose(); onQuick(target.id, kind, { x: target.x, y: target.y }); },
              { icon: kind === 'status' ? 'swap-horizontal-outline' : 'flag-outline', disabled: busy || target.quick[kind] === 'locked' },
            )) : columns.map(col => item(`move-${col}`, col === target.column ? tr('tasks.copy.91', { v0: taskText(REQ_COLUMN_LABEL[col]) }) : tr('tasks.copy.92', { v0: taskText(REQ_COLUMN_LABEL[col]) }), () => { onClose(); onMove(target.id, col); }, {
              disabled: busy || col === target.column, checked: col === target.column, icon: col === target.column ? 'checkmark' : 'arrow-forward',
            }))}
            {!touch ? <View style={{ height: 1, backgroundColor: colors.border }} /> : null}
            {!touch ? target.priorities.map(p => item(`priority-${p}`, priorityLabel(p), () => { onClose(); onPriority(target.id, p); }, {
              disabled: target.quick.priority === 'locked' || p === target.priority, checked: p === target.priority, icon: p === target.priority ? 'checkmark' : 'flag-outline',
            })) : null}
            {archiveRow ? <View style={{ height: 1, marginVertical: 0, backgroundColor: colors.border }} /> : null}
            {archiveRow ? item('archive', tr('archive.action'), () => { onClose(); onArchive!(target.id); }, { icon: 'archive-outline', disabled: busy }) : null}
          </View>
        ) : null}
      </View>
    </Modal>
  );
}
