// 项目 / 标签行的菜单(#760):桌面右键左栏的行 → 锚在鼠标处;手机长按筛选里的行 → 同一份菜单(触屏行高 + 遮罩)。
// 项:改名 / 颜色 / 归档(项目)或 删除(标签,确认文案同「管理标签」)。没权限 = 菜单根本不开(task-side-menu sideItemActions)。
// 改名:桌面交给左栏把那一行变成输入框(onInlineRename);手机打开管理对话框,直接进那一项的改名页。
import { useState } from 'react';
import { Modal, Pressable, View, useWindowDimensions } from 'react-native';
import { Text } from './ui-text';
import { Ionicons } from './icons';
import { t as tr } from './i18n';
import { useTranslation } from './i18n-react';
import './i18n-task-tags';
import { colors, radius, themeMode } from './theme';
import { elevated } from './elevation';
import { uiScale } from './ui-scale';
import { anchorRowMenu, rowMenuHeight, rowMenuMetrics } from './agent-row-menu';
import { useModalSafePadding } from './safe-area-runtime';
import { setManagingProjects, setManagingTags, setSideMenu, useTaskBoard } from './task-board-store';
import { canManageTags, TAG_COLORS } from './task-tag-catalog';
import { canEditProject, runSideAction, sideItemActions, type SideAction } from './task-side-menu';

const ICON: Record<SideAction, string> = { rename: 'create-outline', color: 'color-palette-outline', archive: 'archive-outline', delete: 'trash-outline' };

export default function TaskSideItemMenu({ onInlineRename }: { onInlineRename?: (kind: 'project' | 'tag', key: string) => void }) {
  useTranslation();
  const target = useTaskBoard(s => s.sideMenu);
  const ops = useTaskBoard(s => s.managerOps);
  const projects = useTaskBoard(s => s.projects);
  const catalog = useTaskBoard(s => s.tagCatalog);
  const manageTags = useTaskBoard(s => canManageTags(s.capabilities, s.tagCatalog));
  const win = useWindowDimensions();
  const safe = useModalSafePadding('fullScreen');
  const [view, setView] = useState<'menu' | 'color' | 'delete'>('menu');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  if (!target) return null;
  const project = target.kind === 'project' ? projects?.find(p => p.id === target.key) : undefined;
  const actions = sideItemActions(target.kind, target.kind === 'project' ? canEditProject(project) : manageTags, ops);
  const close = () => { setView('menu'); setError(''); setSideMenu(null); };
  if (!actions.length || !ops) return null;
  const count = catalog?.counts[target.key] ?? 0;
  const run = async (fn: () => Promise<string | null>) => {
    if (busy) return;
    setBusy(true);
    setError('');
    const failed = await fn();
    setBusy(false);
    if (failed) setError(target.kind === 'tag' ? tr(failed) : failed); else close();
  };
  const act = (a: SideAction) => {
    if (a === 'rename') {
      close();
      if (!target.touch && onInlineRename) onInlineRename(target.kind, target.key);
      else if (target.kind === 'project') setManagingProjects(true, target.key);
      else setManagingTags(true, target.key);
    } else if (a === 'delete') setView('delete');
    else if (a === 'color' && target.kind === 'tag') setView('color');
    else void run(() => runSideAction(target.kind, target.key, a, ops, { projectColor: project?.color }));
  };
  const label = (a: SideAction) => (a === 'archive' ? tr('tasks.copy.209') : tr(`tags.${a}`));
  const m = rowMenuMetrics(target.touch, uiScale().densityFactor, uiScale().denseFontMultiplier);
  const width = view === 'menu' ? m.width : Math.max(m.width, 240);
  const pos = anchorRowMenu({ x: target.x, y: target.y, menuWidth: width, menuHeight: rowMenuHeight(m, view === 'menu' ? actions.length : 3), viewportWidth: win.width, viewportHeight: win.height,
    insets: target.touch ? { top: safe.paddingTop, bottom: safe.paddingBottom, left: safe.paddingLeft, right: safe.paddingRight } : undefined });
  const row = (key: string, text: string, onPress: () => void, icon?: string, danger = false) => (
    <Pressable key={key} testID={`side-menu-${key}`} accessibilityRole="menuitem" accessibilityLabel={text} disabled={busy} onPress={onPress}
      style={state => ({ minHeight: m.itemHeight, paddingHorizontal: m.padX, flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: (state as { hovered?: boolean }).hovered || state.pressed ? colors.rowHover : 'transparent' })}>
      {icon ? <Ionicons name={icon as never} size={15} color={danger ? colors.failed : colors.textSecondary} /> : null}
      <Text style={{ flex: 1, color: danger ? colors.failed : colors.text, fontSize: m.fontSize }} numberOfLines={2}>{text}</Text>
    </Pressable>
  );
  return (
    <Modal visible transparent animationType="fade" onRequestClose={close}>
      <Pressable testID="side-menu-scrim" accessibilityLabel={tr('tags.cancel')} onPress={close}
        style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, backgroundColor: target.touch ? (themeMode() === 'dark' ? 'rgba(0,0,0,0.45)' : 'rgba(0,0,0,0.18)') : 'transparent' }}
        {...({ onContextMenu: (e: { preventDefault?: () => void }) => { e?.preventDefault?.(); close(); } } as object)} />
      <View testID="side-menu" accessibilityRole="menu" style={{ position: 'absolute', left: pos.left, top: pos.top, width, paddingVertical: m.padY, borderRadius: radius.control, backgroundColor: colors.card, overflow: 'hidden', ...elevated('floating') }}>
        {view === 'menu' ? actions.map(a => row(a, label(a), () => act(a), ICON[a], a === 'delete')) : null}
        {view === 'delete' ? (
          <>
            <Text style={{ paddingHorizontal: m.padX, paddingVertical: m.padY, color: colors.text, fontSize: m.fontSize }}>{tr('tags.deleteTitle', { tag: target.key })}{'\n'}{tr('tags.deleteBody', { n: count })}</Text>
            {row('delete-go', tr('tags.deleteConfirm', { n: count }), () => { void run(() => runSideAction('tag', target.key, 'delete', ops, {})); }, undefined, true)}
            {row('delete-cancel', tr('tags.cancel'), close)}
          </>
        ) : null}
        {view === 'color' ? (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4, paddingHorizontal: m.padX - 6 }} testID="side-menu-palette">
            {[...TAG_COLORS, null].map(c => (
              <Pressable key={c ?? 'none'} accessibilityRole="radio" accessibilityLabel={c ?? tr('tags.colorNone')} disabled={busy} onPress={() => { void run(() => runSideAction('tag', target.key, 'color', ops, { tagColor: c })); }}
                style={{ width: 32, height: 32, alignItems: 'center', justifyContent: 'center' }} testID={`side-menu-color-${c ? c.slice(1) : 'none'}`}>
                <View style={{ width: 18, height: 18, borderRadius: radius.pill, backgroundColor: c ?? 'transparent', borderWidth: c ? 0 : 1.5, borderColor: colors.textMuted }} />
              </Pressable>
            ))}
          </View>
        ) : null}
        {error ? <Text style={{ paddingHorizontal: m.padX, paddingVertical: 4, color: colors.failed, fontSize: m.fontSize - 1 }} accessibilityRole="alert" testID="side-menu-error">{error}</Text> : null}
      </View>
    </Modal>
  );
}
