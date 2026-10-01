import { t as tr } from './i18n';
import { useTranslation } from './i18n-react';
import { taskText } from './i18n-tasks';
// 手机任务行 / 看板卡片的左滑(微信 / iOS 列表):往左拉露出「进行中」「完成」「更多」,点了立刻保存(task-quick-status.ts)。
// 横向拖过 SWIPE_SLOP 且明显比竖向多才接管手势(capture),竖着滚列表、长按菜单照旧。同一时间只开一行:open 由父级管。
// 打开时点行本身 = 收回,不进详情。没有可用按钮(只读卡)就不挂手势,原样渲染。
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { PanResponder, Pressable, View, type StyleProp, type ViewStyle } from 'react-native';
import { Text } from './ui-text';
import { colors } from './theme';
import { STATUS_TONE } from './TaskBoardParts';
import { REQ_COLUMN_LABEL } from './requirements-model';
import { SWIPE_ACTION_W, SWIPE_SLOP, swipeFollow, swipeSettle, type SwipeAction } from './task-quick-status';

export default function TaskSwipeRow({ id, actions, open, onOpenChange, onAction, background, style, children }: {
  id: string;
  actions: readonly SwipeAction[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** at = 按下点(「更多」的菜单锚在这)。 */
  onAction: (action: SwipeAction, at: { x: number; y: number }) => void;
  /** 内容层的底色:要不透明,收着的时候把按钮盖住。 */
  background: string;
  /** 外层(圆角、外边距、阴影跟着卡片走)。 */
  style?: StyleProp<ViewStyle>;
  children: ReactNode;
}) {
  useTranslation();
  const width = actions.length * SWIPE_ACTION_W;
  const [x, setX] = useState(0);
  const latest = useRef({ open, width, onOpenChange });
  // web:松手后浏览器还会补一个 click,落到行上就进了详情。刚拖完的这一下在捕获阶段吞掉(原生上手势接管后 Pressable 本来就收不到)。
  const draggedAt = useRef(0);
  const outer = useRef<View>(null);
  useEffect(() => {
    // react-native-web 的 View 不转发 onClickCapture,直接挂 DOM 捕获监听(原生上没有 addEventListener,跳过)。
    const node = outer.current as unknown as { addEventListener?: Function; removeEventListener?: Function } | null;
    if (!node?.addEventListener) return;
    const swallow = (e: Event) => { if (Date.now() - draggedAt.current < 400) { e.stopPropagation(); e.preventDefault(); } };
    node.addEventListener('click', swallow, true);
    return () => node.removeEventListener?.('click', swallow, true);
  }, [actions.length]);
  latest.current = { open, width, onOpenChange };
  useEffect(() => { setX(open ? -width : 0); }, [open, width]);
  const pan = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponderCapture: (_, g) => Math.abs(g.dx) > SWIPE_SLOP && Math.abs(g.dx) > Math.abs(g.dy) * 1.5,
    onPanResponderTerminationRequest: () => false,
    onPanResponderMove: (_, g) => setX(swipeFollow(g.dx, latest.current.open, latest.current.width)),
    onPanResponderRelease: (_, g) => {
      draggedAt.current = Date.now();
      const to = swipeSettle(g.dx, latest.current.open, latest.current.width);
      setX(to);
      latest.current.onOpenChange(to !== 0);
    },
    onPanResponderTerminate: () => setX(latest.current.open ? -latest.current.width : 0),
  }), []);
  if (!actions.length) return <View style={style}>{children}</View>;
  const label = (a: SwipeAction) => (a === 'more' ? tr('quick.more') : taskText(REQ_COLUMN_LABEL[a]));
  const tone = (a: SwipeAction) => (a === 'more' ? colors.textMuted : STATUS_TONE[a]());
  return (
    <View
      style={[style, { overflow: 'hidden' }]}
      testID={`task-swipe-${id}`}
      {...pan.panHandlers}
      ref={outer}
    >
      {x < 0 ? (
        <View style={{ position: 'absolute', top: 0, bottom: 0, right: 0, width, flexDirection: 'row' }} testID={`task-swipe-actions-${id}`}>
          {actions.map(a => (
            <Pressable
              key={a}
              testID={`task-swipe-${a}-${id}`}
              accessibilityRole="button"
              accessibilityLabel={a === 'more' ? tr('quick.more') : tr('quick.moveTo', { v0: label(a) })}
              onPress={e => onAction(a, { x: e.nativeEvent.pageX, y: e.nativeEvent.pageY })}
              style={state => ({ width: SWIPE_ACTION_W, minHeight: 44, alignItems: 'center', justifyContent: 'center', backgroundColor: tone(a), opacity: state.pressed ? 0.8 : 1 })}
            >
              <Text style={{ color: '#fff', fontSize: 14, fontWeight: '600' }} numberOfLines={1}>{label(a)}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
      <View style={{ transform: [{ translateX: x }], backgroundColor: background }}>
        {children}
        {open ? (
          <Pressable
            testID={`task-swipe-close-${id}`}
            accessibilityLabel={tr('quick.close')}
            onPress={() => onOpenChange(false)}
            style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0 }}
          />
        ) : null}
      </View>
    </View>
  );
}
