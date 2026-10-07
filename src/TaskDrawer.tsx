// 看板 #701 —— 任务详情的右侧抽屉外框(桌面):默认 560 宽,左沿拖动改宽(本机记住),Esc 由详情自己处理。
// 可复用:给一个任务 id 就能开 —— 任务页里点卡片 / 列表行,或任何地方 openTaskDrawer(id)(task-drawer-model.ts,
// #700 的深链会用它)。内容(TaskDetailPanel mode="drawer")由调用方给,外框只管位置、宽度和拖动。
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { t as tr } from './i18n';
import { BOARD_RADIUS, liftedShadow } from './TaskBoardParts';
import { clampDrawerWidth, dragDrawerWidth, drawerTokens, loadDrawerWidth, saveDrawerWidth } from './task-drawer-model';

type PointerLike = { nativeEvent: { clientX: number; pointerId?: number }; currentTarget: unknown };

/** 抽屉当前宽度(本机记住的,夹在看板宽度里)+ 改宽。 */
export function useDrawerWidth(boardWidth: number): [number, (w: number, persist?: boolean) => void] {
  const [raw, setRaw] = useState(loadDrawerWidth);
  const set = (w: number, persist = false) => { setRaw(w); if (persist) saveDrawerWidth(w); };
  return [clampDrawerWidth(raw, boardWidth), set];
}

export default function TaskDrawer({ taskId, top, width, boardWidth, onWidth, children }: {
  /** 打开的任务;null = 不画。 */
  taskId: string | null;
  /** 抽屉上沿 = 页面头部下沿。 */
  top: number;
  width: number;
  boardWidth: number;
  onWidth: (w: number, persist?: boolean) => void;
  children: ReactNode;
}) {
  const tokens = drawerTokens();
  const drag = useRef<{ x: number; start: number; last: number } | null>(null);
  const [resizing, setResizing] = useState(false);
  const cursor = (value: string) => { const body = (globalThis as any).document?.body; if (body) { body.style.cursor = value; body.style.userSelect = value ? 'none' : ''; } };
  useEffect(() => () => cursor(''), []);
  if (!taskId) return null;
  const handle = {
    onPointerDown: (e: PointerLike) => {
      (e.currentTarget as HTMLElement).setPointerCapture?.(e.nativeEvent.pointerId as number);
      drag.current = { x: e.nativeEvent.clientX, start: width, last: width };
      setResizing(true); cursor('col-resize');
    },
    onPointerMove: (e: PointerLike) => {
      const d = drag.current; if (!d) return;
      d.last = dragDrawerWidth(d.start, e.nativeEvent.clientX - d.x, boardWidth);
      onWidth(d.last);
    },
    onPointerUp: () => { const d = drag.current; drag.current = null; setResizing(false); cursor(''); if (d) onWidth(d.last, true); },
    onPointerCancel: () => { drag.current = null; setResizing(false); cursor(''); },
    onKeyDown: (e: { nativeEvent: { key: string }; preventDefault: () => void }) => {
      const step = e.nativeEvent.key === 'ArrowLeft' ? 24 : e.nativeEvent.key === 'ArrowRight' ? -24 : 0;
      if (!step) return;
      e.preventDefault();
      onWidth(clampDrawerWidth(width + step, boardWidth), true);
    },
  };
  return (
    <View
      style={[styles.drawer, { top, width, backgroundColor: tokens.bg, borderLeftColor: tokens.border }, liftedShadow()]}
      testID="task-drawer"
      {...({ dataSet: { taskDrawer: taskId } } as object)}
    >
      <View
        accessibilityRole="adjustable"
        accessibilityLabel={tr('taskDrawer.resize')}
        focusable
        style={[styles.handle, resizing && { backgroundColor: tokens.handleActive }]}
        testID="task-drawer-resize"
        {...(handle as object)}
      />
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  drawer: { position: 'absolute', right: 0, bottom: 0, maxWidth: '100%', borderLeftWidth: StyleSheet.hairlineWidth, borderTopLeftRadius: BOARD_RADIUS.card, zIndex: 20, overflow: 'hidden' },
  handle: { position: 'absolute', left: 0, top: 0, bottom: 0, width: 6, zIndex: 2, cursor: 'col-resize' } as object,
});
