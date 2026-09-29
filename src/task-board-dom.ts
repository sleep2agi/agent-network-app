// 桌面(鼠标 + 键盘)的看板交互,直接挂在 DOM 上:拖动换列、右键菜单、键盘换列 / 菜单键。
// 只在 pointerUi() 为真时启用 —— 手机和安卓双栏是手指,没有拖动(owner:「Windows / Mac 跟安卓版
// 肯定是不一样的」),换列走长按菜单或详情里的状态。
//
// 卡片 / 列靠 RN-web 的 dataSet 标出来:data-task-card=<id>、data-task-from=<列>、data-task-column=<列>。
// 监听挂在 document 捕获阶段:RN-web 的 Pressable 会在自己的处理里 stopPropagation(ChatScreen 同样的做法)。
import { useEffect, useRef } from 'react';
import { REQ_COLUMNS, type ReqColumn } from './requirements-model';
import type { DragEvent } from './task-board-model';

export interface CardDomHandlers {
  onDrag: (ev: DragEvent, grab?: { dx: number; dy: number; w: number }) => void;
  onContextMenu: (id: string, x: number, y: number) => void;
  onKeyMove: (id: string, dir: -1 | 1) => void;
  /** 当前是否在拖(松手 / Esc 用)。 */
  dragging: () => boolean;
}

type El = { closest?: (sel: string) => El | null; getAttribute?: (n: string) => string | null; getBoundingClientRect?: () => { left: number; top: number; width: number; height: number } };

const asColumn = (v: string | null | undefined): ReqColumn | null => (REQ_COLUMNS.includes(v as ReqColumn) ? v as ReqColumn : null);

/** 指针下面是哪一列(拖动中的卡片自己 pointer-events: none,不会挡住)。 */
export function columnAtPoint(doc: { elementsFromPoint?: (x: number, y: number) => El[] }, x: number, y: number): ReqColumn | null {
  const hits = doc.elementsFromPoint?.(x, y) ?? [];
  for (const el of hits) {
    const col = el.closest?.('[data-task-column]')?.getAttribute?.('data-task-column');
    if (col) return asColumn(col);
  }
  return null;
}

export function useTaskCardDom(enabled: boolean, handlers: CardDomHandlers): void {
  const h = useRef(handlers);
  h.current = handlers;
  useEffect(() => {
    const doc = (globalThis as { document?: any }).document;
    if (!enabled || !doc?.addEventListener) return;
    const cardOf = (t: El | null) => t?.closest?.('[data-task-card]') ?? null;
    const down = (e: any) => {
      if (e.button !== 0 || e.ctrlKey || e.metaKey) return;
      const card = cardOf(e.target);
      if (!card || e.target?.closest?.('[data-no-drag]')) return;
      const id = card.getAttribute?.('data-task-card');
      const from = asColumn(card.getAttribute?.('data-task-from'));
      if (!id || !from) return;
      const r = card.getBoundingClientRect?.();
      h.current.onDrag({ type: 'down', id, from, x: e.clientX, y: e.clientY }, r ? { dx: e.clientX - r.left, dy: e.clientY - r.top, w: r.width } : undefined);
    };
    const move = (e: any) => h.current.onDrag({ type: 'move', x: e.clientX, y: e.clientY, over: columnAtPoint(doc, e.clientX, e.clientY) });
    const up = (e: any) => h.current.onDrag({ type: 'up', over: columnAtPoint(doc, e.clientX, e.clientY) });
    const cancel = () => h.current.onDrag({ type: 'cancel' });
    const context = (e: any) => {
      const card = cardOf(e.target);
      const id = card?.getAttribute?.('data-task-card');
      if (!id) return;
      e.preventDefault?.();
      e.stopPropagation?.();
      h.current.onContextMenu(id, e.clientX, e.clientY);
    };
    const key = (e: any) => {
      if (e.key === 'Escape' && h.current.dragging()) { e.preventDefault?.(); cancel(); return; }
      const card = cardOf(doc.activeElement);
      const id = card?.getAttribute?.('data-task-card');
      if (!id || e.isComposing) return;
      if (e.shiftKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
        e.preventDefault?.();
        h.current.onKeyMove(id, e.key === 'ArrowLeft' ? -1 : 1);
      } else if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) {
        e.preventDefault?.();
        const r = card?.getBoundingClientRect?.();
        h.current.onContextMenu(id, r ? r.left + 16 : 0, r ? r.top + r.height : 0);
      }
    };
    doc.addEventListener('pointerdown', down, true);
    doc.addEventListener('pointermove', move, true);
    doc.addEventListener('pointerup', up, true);
    doc.addEventListener('pointercancel', cancel, true);
    doc.addEventListener('contextmenu', context, true);
    doc.addEventListener('keydown', key, true);
    return () => {
      doc.removeEventListener('pointerdown', down, true);
      doc.removeEventListener('pointermove', move, true);
      doc.removeEventListener('pointerup', up, true);
      doc.removeEventListener('pointercancel', cancel, true);
      doc.removeEventListener('contextmenu', context, true);
      doc.removeEventListener('keydown', key, true);
    };
  }, [enabled]);
}

/** 拖动中:禁止选中文字、光标变成抓手(松手恢复)。 */
export function setDraggingCursor(on: boolean): void {
  const body = (globalThis as { document?: any }).document?.body;
  if (!body?.style) return;
  body.style.userSelect = on ? 'none' : '';
  body.style.cursor = on ? 'grabbing' : '';
}
