// 「项目文件夹」右侧的文件树(IDE 资源管理器那样)。只负责画和交互;
// 状态(展开 / 缓存 / 按需列 / 祖先展开 / 刷新作废)在 node-files-tree.ts,由 NodeFilesSection 持有。
//
// 两种挂法:
//  - docked:宽窗里并排挂在查看器右边,始终可见,左缘可拖拽改宽(web)。
//  - drawer:窄窗 / 安卓双栏右栏里,工具条上一个「目录」按钮,点开从右侧滑出一层抽屉。
// 键盘(web):↑/↓ 移动,→ 展开 / 进子项,← 收起 / 回父目录,Enter 打开文件或展开收起目录。

import { Ionicons } from './icons';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Modal, Platform, Pressable, ScrollView, View, useWindowDimensions } from 'react-native';
import { Text } from './ui-text';

import { entryIcon } from './node-files';
import { arrowIntent, clampTreeWidth, FILES_TREE_DEFAULT_WIDTH, moveFocus, type TreeRow } from './node-files-tree';
import { colors, radius, spacing, type } from './theme';

const MONO = Platform.OS === 'ios' ? 'Menlo' : 'monospace';
const WEB = Platform.OS === 'web';
const ROW_H = 26;
const INDENT = 14;
const WIDTH_KEY = 'node_files_tree_width_v1';

type EntryRow = Extract<TreeRow, { kind: 'entry' }>;

export type NodeFilesTreeProps = {
  rows: TreeRow[];
  /** 当前打开的文件(或列表视图里当前目录)—— 高亮那一行。 */
  selected: string | null;
  onToggle: (path: string) => void;
  onOpen: (path: string, name: string, secret: boolean) => void;
  /** 点到不能打开的行(依赖目录 / 外部链接…):说一句为什么,和列表视图同一句。 */
  onNote: (text: string) => void;
  onRetry: (dir: string) => void;
};

/** 树本体:一行行 + 键盘。docked 和 drawer 共用。 */
function TreeBody({ rows, selected, onToggle, onOpen, onNote, onRetry, afterOpen }: NodeFilesTreeProps & { afterOpen?: () => void }) {
  const [focused, setFocused] = useState<string | null>(null);
  const hostRef = useRef<any>(null);
  const rowsRef = useRef(rows); rowsRef.current = rows;
  const focusedRef = useRef(focused); focusedRef.current = focused;
  const selectedRef = useRef(selected); selectedRef.current = selected;

  const activate = useCallback((r: EntryRow) => {
    setFocused(r.path);
    const a = r.action;
    if (a.kind === 'descend') onToggle(r.path);
    else if (a.kind === 'open') { onOpen(a.path, r.name, false); afterOpen?.(); }
    else if (a.kind === 'secret') { onOpen(a.path, r.name, true); afterOpen?.(); }
    else onNote(`${r.name}:${a.reason}`);
  }, [onToggle, onOpen, onNote, afterOpen]);
  const activateRef = useRef(activate); activateRef.current = activate;
  const toggleRef = useRef(onToggle); toggleRef.current = onToggle;

  // 键盘只在 web 上接(桌面端);原生端没有物理方向键的场景。
  useEffect(() => {
    if (!WEB) return;
    const el: HTMLElement | null = hostRef.current;
    if (!el || typeof el.addEventListener !== 'function') return;
    const onKey = (e: KeyboardEvent) => {
      const rs = rowsRef.current;
      const cur = focusedRef.current;
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        setFocused(moveFocus(rs, cur, e.key === 'ArrowDown' ? 1 : -1, selectedRef.current));
      } else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        e.preventDefault();
        const it = arrowIntent(rs, cur, e.key === 'ArrowRight' ? 'right' : 'left');
        if (it.kind === 'expand' || it.kind === 'collapse') toggleRef.current(it.path);
        else if (it.kind === 'focus') setFocused(it.path);
      } else if ((e.key === 'Enter' || e.key === ' ') && e.target === el) {
        // 焦点在某一行上时 Enter 由那一行自己的 Pressable 处理(下面把 DOM 焦点跟着移过去);
        // 这里只管焦点还停在树容器上(Tab 进来还没按方向键)的情况。
        const r = rs.find((x): x is EntryRow => x.kind === 'entry' && x.path === cur);
        if (r) { e.preventDefault(); activateRef.current(r); }
      }
    };
    el.addEventListener('keydown', onKey);
    return () => el.removeEventListener('keydown', onKey);
  }, []);

  // 键盘移动时把焦点行滚进视野。
  useEffect(() => {
    if (!WEB || !focused || !hostRef.current) return;
    const nodes = hostRef.current.querySelectorAll?.('[data-tree-path]') as NodeListOf<HTMLElement> | undefined;
    // DOM 焦点跟着移过去:Enter / 空格就由那一行的 Pressable 原生处理,不会和这里重复触发。
    nodes?.forEach(n => { if (n.dataset.treePath === focused) { if (hostRef.current.contains(n.ownerDocument.activeElement)) n.focus?.({ preventScroll: true }); n.scrollIntoView?.({ block: 'nearest' }); } });
  }, [focused]);

  return (
    <View ref={hostRef} testID="node-files-tree" accessibilityRole={'tree' as any} accessibilityLabel="项目目录树"
      {...(WEB ? ({ tabIndex: 0 } as any) : {})}
      style={[{ paddingVertical: 2 }, WEB ? ({ outlineStyle: 'none' } as any) : null]}>
      {rows.length === 0 ? (
        <View style={{ height: ROW_H, justifyContent: 'center', paddingHorizontal: spacing.sm }}>
          <ActivityIndicator size="small" color={colors.textMuted} />
        </View>
      ) : rows.map(r => {
        const pad = spacing.xs + r.depth * INDENT;
        if (r.kind !== 'entry') {
          const text = r.kind === 'loading' ? '' : r.kind === 'empty' ? '空目录' : r.kind === 'truncated' ? `只显示前 ${r.shown} 项(共 ${r.total} 项)` : r.message;
          const dirOf = r.path.slice(0, r.path.indexOf('\0'));
          return (
            <Pressable key={r.path} disabled={r.kind !== 'error'} onPress={() => onRetry(dirOf)} accessibilityLabel={r.kind === 'error' ? `${text},点一下重试` : undefined}
              style={{ minHeight: ROW_H, flexDirection: 'row', alignItems: 'center', gap: 6, paddingLeft: pad + 14 + 4, paddingRight: spacing.sm }}>
              {r.kind === 'loading' ? <ActivityIndicator size="small" color={colors.textMuted} style={{ transform: [{ scale: 0.7 }] }} /> : null}
              {text ? <Text numberOfLines={2} style={{ flexShrink: 1, color: r.kind === 'error' ? colors.failed : colors.textMuted, fontSize: 11.5 }}>{text}{r.kind === 'error' ? ' · 重试' : ''}</Text> : null}
            </Pressable>
          );
        }
        const isSel = r.path === selected;
        const isFoc = r.path === focused;
        const muted = r.action.kind === 'none';
        const tag = r.entry.hidden_reason === 'skipped' ? '不展开' : r.entry.type === 'symlink' && r.entry.link_type === null ? '外部链接' : '';
        return (
          <Pressable key={r.path} onPress={() => activate(r)} accessibilityRole={'treeitem' as any}
            accessibilityLabel={r.name} {...({ 'aria-selected': isSel, ...(r.dirLike ? { 'aria-expanded': r.expanded } : {}) } as any)}
            {...({ dataSet: { treePath: r.path } } as any)} {...(WEB ? ({ tabIndex: -1 } as any) : {})}
            style={(st: any) => [{ height: ROW_H, flexDirection: 'row', alignItems: 'center', gap: 4, paddingLeft: pad, paddingRight: spacing.sm, borderRadius: 5 },
              isSel ? { backgroundColor: colors.railActiveBg } : st.hovered ? { backgroundColor: colors.rowHover } : null,
              isFoc ? ({ outlineStyle: 'solid', outlineWidth: 1, outlineColor: colors.accent, outlineOffset: -1 } as any) : null]}>
            <View style={{ width: 14, alignItems: 'center' }}>
              {r.loading ? <ActivityIndicator size="small" color={colors.textMuted} style={{ transform: [{ scale: 0.6 }] }} />
                : r.dirLike ? <Ionicons name={r.expanded ? 'chevron-down' : 'chevron-forward'} size={12} color={colors.textMuted} /> : null}
            </View>
            <Ionicons name={(r.dirLike && r.expanded && r.entry.type === 'dir' ? 'folder-open-outline' : entryIcon(r.entry)) as any} size={14}
              color={r.dirLike ? colors.accent : colors.textMuted} />
            <Text numberOfLines={1} style={{ flexShrink: 1, fontSize: 12.5, fontFamily: MONO, color: isSel ? colors.accent : muted ? colors.textMuted : colors.text, fontWeight: isSel ? '600' : '400' }}>{r.name}</Text>
            {tag ? <Text numberOfLines={1} style={{ color: colors.textMuted, fontSize: 10.5 }}>{tag}</Text> : null}
          </Pressable>
        );
      })}
    </View>
  );
}

/** 上次拖出来的宽度(每个查看者自己的便利设置;读不到就用默认宽)。 */
export const readTreeWidth = (): number => {
  try {
    const v = Number(globalThis.localStorage?.getItem(WIDTH_KEY));
    return v > 0 ? clampTreeWidth(v) : FILES_TREE_DEFAULT_WIDTH;
  } catch { return FILES_TREE_DEFAULT_WIDTH; }
};

/** 宽窗:并排挂在查看器右边,贴着滚动区顶部(web sticky),左缘可拖拽改宽。 */
export function NodeFilesTreeDocked(props: NodeFilesTreeProps & { width: number; onWidth: (w: number) => void }) {
  const { height } = useWindowDimensions();
  const handleRef = useRef<any>(null);
  const widthRef = useRef(props.width); widthRef.current = props.width;
  const onWidthRef = useRef(props.onWidth); onWidthRef.current = props.onWidth;
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    if (!WEB) return;
    const el: HTMLElement | null = handleRef.current;
    if (!el || typeof el.addEventListener !== 'function') return;
    const onDown = (e: MouseEvent) => {
      e.preventDefault();
      const startX = e.clientX; const startW = widthRef.current;
      setDragging(true);
      const doc = el.ownerDocument;
      // 手柄在树的左缘:往左拖 = 树变宽。
      const onMove = (m: MouseEvent) => onWidthRef.current(clampTreeWidth(startW + (startX - m.clientX)));
      const onUp = () => {
        setDragging(false);
        doc.removeEventListener('mousemove', onMove); doc.removeEventListener('mouseup', onUp);
        try { globalThis.localStorage?.setItem(WIDTH_KEY, String(widthRef.current)); } catch { /* 存不了就只在这次会话里有效 */ }
      };
      doc.addEventListener('mousemove', onMove); doc.addEventListener('mouseup', onUp);
    };
    el.addEventListener('mousedown', onDown);
    return () => el.removeEventListener('mousedown', onDown);
  }, []);

  return (
    <View testID="node-files-tree-docked"
      style={[{ width: props.width, flexShrink: 0, alignSelf: 'flex-start', backgroundColor: colors.card, borderRadius: radius.lg, paddingVertical: spacing.sm },
        WEB ? ({ position: 'sticky', top: 0 } as any) : null]}>
      <View ref={handleRef} accessibilityLabel="拖动调整目录树宽度"
        style={[{ position: 'absolute', left: -9, top: 0, bottom: 0, width: 7, zIndex: 2, borderRadius: 3 },
          dragging ? { backgroundColor: colors.accent, opacity: 0.35 } : null,
          WEB ? ({ cursor: 'col-resize' } as any) : null]} />
      <TreeHeader />
      <ScrollView style={{ maxHeight: Math.max(240, height - 190) }} contentContainerStyle={{ paddingHorizontal: spacing.xs }}>
        <TreeBody {...props} />
      </ScrollView>
    </View>
  );
}

/** 窄窗:工具条上的「目录」按钮。 */
export function NodeFilesTreeButton({ open, onPress }: { open: boolean; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel="目录树" accessibilityState={{ expanded: open }} onPress={onPress} testID="node-files-tree-toggle"
      style={(st: any) => [{ height: 30, flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: spacing.sm + 2, borderRadius: 6, borderWidth: 1, borderColor: colors.border },
        open ? { backgroundColor: colors.railActiveBg } : st.hovered ? { backgroundColor: colors.rowHover } : null,
        st.focused ? ({ outlineStyle: 'solid', outlineWidth: 2, outlineColor: colors.accent, outlineOffset: 1 } as any) : null]}>
      <Ionicons name="git-network-outline" size={14} color={open ? colors.accent : colors.textSecondary} />
      <Text style={{ color: open ? colors.accent : colors.textSecondary, fontSize: 12 }}>目录</Text>
    </Pressable>
  );
}

/** 窄窗:从右侧滑出的抽屉。点文件打开后自动收起;点遮罩 / Esc / × 关闭。 */
export function NodeFilesTreeDrawer(props: NodeFilesTreeProps & { visible: boolean; onClose: () => void }) {
  const { width } = useWindowDimensions();
  const w = Math.min(320, Math.round(width * 0.86));
  return (
    <Modal transparent visible={props.visible} onRequestClose={props.onClose} animationType="fade">
      <View style={{ flex: 1, flexDirection: 'row' }}>
        <Pressable accessibilityLabel="关闭目录树" onPress={props.onClose} style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.35)' }} />
        <View testID="node-files-tree-drawer" style={{ width: w, backgroundColor: colors.card, borderLeftWidth: 1, borderLeftColor: colors.border, paddingVertical: spacing.sm }}>
          <TreeHeader onClose={props.onClose} />
          <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: spacing.xs, paddingBottom: spacing.lg }}>
            <TreeBody {...props} afterOpen={props.onClose} />
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

function TreeHeader({ onClose }: { onClose?: () => void }) {
  return (
    <View testID="screen-header" style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: spacing.sm + 2, paddingBottom: 6, marginBottom: 2, borderBottomWidth: 1, borderBottomColor: colors.border, minHeight: 28 }}>
      <Text style={{ flex: 1, color: colors.textSecondary, fontSize: type.small - 1, fontWeight: '600', letterSpacing: 0.3 }}>目录</Text>
      {onClose ? (
        <Pressable accessibilityRole="button" accessibilityLabel="关闭" onPress={onClose} hitSlop={8}
          style={(st: any) => [{ padding: 3, borderRadius: 5 }, st.hovered ? { backgroundColor: colors.rowHover } : null]}>
          <Ionicons name="close" size={16} color={colors.textMuted} />
        </Pressable>
      ) : null}
    </View>
  );
}
