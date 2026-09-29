import { ownerCounts } from './i18n-task-presentation';
import { t as tr } from './i18n';
import { useTranslation } from './i18n-react';
import { taskText } from './i18n-tasks';
import './i18n-task-tags';
// 桌面工作区在「任务」页时的左栏:原来这里是会话 / Agent 列表(跟任务页无关)。现在是筛选:
// 项目(全部 / 各项目 + 管理项目)、全部 / 我负责的(负责人 = 我)/ 未分配 / 按 Agent(负责 Agent,头像 + 数目),
// 最下面是「派发记录」(Hub 派给节点的任务)。按 Agent / 按节点只列有任务的,其余收进「更多节点」(可搜)——
// owner 0.2.141 截图里这一栏是 ~300 个 0。
// 左栏的每一项只是头部「负责人」筛选的快捷方式 —— 同一份状态(task-board-store),两边永远一致。
import { useState, type ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Text, TextInput } from './ui-text';
import { Ionicons } from './icons';
import AliasAvatar from './AliasAvatar';
import { colors, radius, spacing, type as typeScale, weight } from './theme';
import { personKey } from './requirement-people';
import { activeProjects, applyFilter, NO_PROJECT, ownersForScope, projectCounts, scopeOf, splitByCount, type SidebarScope } from './task-board-model';
import { setManagingProjects, setTaskFilter, setTaskSection, useTaskBoard } from './task-board-store';
import { CONTROL_H, a11yState } from './TaskBoardParts';

/** onNavigate:在「任务详情」(派发记录的一条)上点左栏时回到任务页。 */
export default function TaskFilterSidebar({ onNavigate }: { onNavigate?: () => void }) {
  useTranslation();
  const styles = makeSidebarStyles();
  const items = useTaskBoard(s => s.items);
  const people = useTaskBoard(s => s.people);
  const meId = useTaskBoard(s => s.meId);
  const filter = useTaskBoard(s => s.filter);
  const section = useTaskBoard(s => s.section);
  const twoRoles = useTaskBoard(s => s.twoRoles === true);
  const projects = useTaskBoard(s => s.projects);
  const [moreOpen, setMoreOpen] = useState(false);
  const [moreQuery, setMoreQuery] = useState('');
  const active = section === 'dispatch' ? null : scopeOf(filter.owners, meId);
  // 人 / 节点的数字按当前项目算(选了 TMAI,「我负责的」就是我在 TMAI 里的)。
  const inProject = applyFilter(items, { owners: [], priorities: [], project: filter.project });
  const counts = ownerCounts(inProject, people);
  const meKey = meId ? personKey({ kind: 'user', id: meId }) : '';
  const countOf = (key: string) => counts.find(c => c.key === key)?.count ?? 0;
  // 按节点:有任务的节点按数目排在前;Hub 成员表里没任务的节点跟在后面(可以先点进去再建)。
  const nodes = [
    ...counts.filter(c => c.ref?.kind === 'node'),
    ...people.filter(p => p.kind === 'node' && !counts.some(c => c.key === personKey(p))).map(p => ({ key: personKey(p), ref: { kind: p.kind, id: p.id }, name: p.name || p.id, count: 0 })),
  ];
  const others = counts.filter(c => c.ref?.kind === 'user' && c.key !== meKey);
  const split = splitByCount(nodes, moreQuery);
  // 选中的节点即使 0 个任务也留在上面(不然点了就「消失」进折叠区)
  const selectedNode = filter.owners.length === 1 && filter.owners[0].startsWith('node:') ? filter.owners[0] : '';
  const shownNodes = selectedNode && !split.shown.some(n => n.key === selectedNode) ? [...split.shown, ...nodes.filter(n => n.key === selectedNode)] : split.shown;
  const moreNodes = split.more.filter(n => n.key !== selectedNode);
  const moreTotal = nodes.filter(n => n.count === 0 && n.key !== selectedNode).length;
  const pCounts = projectCounts(items, filter);
  const pickProject = (id: string) => {
    setTaskSection(section === 'dispatch' ? 'board' : section);
    setTaskFilter({ ...filter, project: id });
    onNavigate?.();
  };
  const projectRow = (id: string, label: string, lead: ReactNode, count: number) => {
    const on = section !== 'dispatch' && (filter.project || '') === id;
    return (
      <Pressable
        key={`p:${id || 'all'}`}
        testID={`task-side-project-${id || 'all'}`}
        accessibilityRole="tab"
        accessibilityLabel={tr('tasks.copy.86', { v0: label })}
        {...a11yState({ selected: on })}
        onPress={() => pickProject(id)}
        style={state => [styles.item, ((state as { hovered?: boolean }).hovered || state.pressed) && { backgroundColor: colors.rowHover }, on && { backgroundColor: colors.rowActive }]}
      >
        <View style={styles.icon}>{lead}</View>
        <Text style={[styles.itemText, { color: on ? colors.text : colors.textSecondary }, on && { fontWeight: weight.strong }]} numberOfLines={1}>{label}</Text>
        <Text style={[styles.count, { color: colors.textMuted }]}>{count}</Text>
      </Pressable>
    );
  };
  const dot = (color: string) => <View style={{ width: 10, height: 10, borderRadius: radius.pill, backgroundColor: color }} />;
  const pick = (scope: SidebarScope) => {
    setTaskSection(section === 'dispatch' ? 'board' : section);
    // 只换负责人,优先级筛选保留(与头部「负责人」筛选同一个动作)。
    setTaskFilter({ ...filter, owners: ownersForScope(scope, meId) });
  };
  const row = (scope: SidebarScope | 'dispatch', label: string, lead: ReactNode, count: number | null, disabled = false) => {
    const on = scope === 'dispatch' ? section === 'dispatch' : active === scope;
    return (
      <Pressable
        key={scope}
        testID={`task-side-${scope}`}
        accessibilityRole="tab"
        accessibilityLabel={label}
        {...a11yState({ selected: on, disabled })}
        disabled={disabled}
        onPress={() => { if (scope === 'dispatch') setTaskSection('dispatch'); else pick(scope); onNavigate?.(); }}
        style={state => [styles.item, ((state as { hovered?: boolean }).hovered || state.pressed) && { backgroundColor: colors.rowHover }, on && { backgroundColor: colors.rowActive }, disabled && { opacity: 0.5 }]}
      >
        <View style={styles.icon}>{lead}</View>
        <Text style={[styles.itemText, { color: on ? colors.text : colors.textSecondary }, on && { fontWeight: weight.strong }]} numberOfLines={1}>{label}</Text>
        {count !== null ? <Text style={[styles.count, { color: colors.textMuted }]}>{count}</Text> : null}
      </Pressable>
    );
  };
  const icon = (name: string, on = false) => <Ionicons name={name as never} size={17} color={on ? colors.accent : colors.textSecondary} />;
  return (
    <View style={[styles.root, { backgroundColor: colors.listBg }]} testID="task-sidebar">
      <View style={styles.head}><Text style={[styles.title, { color: colors.text }]} testID="task-sidebar-title">{tr('tasks.copy.190')}</Text></View>
      <ScrollView contentContainerStyle={styles.body}>
        <Text style={[styles.section, { color: colors.textMuted }]}>{tr('tags.title')}</Text>
        {['', ...new Set(items.flatMap(item => item.tags ?? [])), ...(filter.tag && !items.some(item => item.tags?.includes(filter.tag!)) ? [filter.tag] : [])].map(tag => <Pressable key={`tag:${tag}`} accessibilityRole="button" testID={`task-filter-tag-${tag || 'all'}`} onPress={() => { setTaskFilter({ ...filter, tag }); onNavigate?.(); }} style={[styles.item, filter.tag === tag && { backgroundColor: colors.rowActive }]}><Text numberOfLines={1} style={[styles.itemText, { color: colors.text }]}>{tag || tr('tags.all')}</Text></Pressable>)}
        {projects ? (
          <>
            <Text style={[styles.section, { color: colors.textMuted, paddingTop: 0 }]}>{tr('tasks.copy.30')}</Text>
            {projectRow('', tr('tasks.copy.191'), icon('folder-open-outline'), Array.from(pCounts.values()).reduce((a, b) => a + b, 0))}
            {activeProjects(projects).map(p => projectRow(p.id, p.name, dot(p.color), pCounts.get(p.id) ?? 0))}
            {(pCounts.get(NO_PROJECT) ?? 0) > 0 && activeProjects(projects).length ? projectRow(NO_PROJECT, tr('tasks.copy.31'), icon('remove-circle-outline'), pCounts.get(NO_PROJECT) ?? 0) : null}
            <Pressable accessibilityRole="button" onPress={() => setManagingProjects(true)} style={state => [styles.item, ((state as { hovered?: boolean }).hovered || state.pressed) && { backgroundColor: colors.rowHover }]} testID="task-side-manage-projects">
              <View style={styles.icon}>{icon('settings-outline')}</View>
              <Text style={[styles.itemText, { color: colors.accent }]}>{tr('tasks.copy.64')}</Text>
            </Pressable>
            <View style={[styles.divider, { backgroundColor: colors.border }]} />
          </>
        ) : null}
        {row('all', tr('tasks.copy.192'), icon('albums-outline'), inProject.length)}
        {row('mine', tr('tasks.copy.193'), icon('person-outline'), meKey ? applyFilter(inProject, { owners: [meKey], priorities: [] }).length : null, !meId)}
        {row('unassigned', tr('tasks.copy.6'), icon('help-circle-outline'), countOf('none'))}
        {/* 分两个角色的 Hub:这里按「负责 Agent」筛;旧 Hub 上节点就是唯一的负责人。 */}
        {nodes.length ? <Text style={[styles.section, { color: colors.textMuted }]}>{twoRoles ? tr('tasks.copy.194') : tr('tasks.copy.195')}</Text> : null}
        {shownNodes.map(n => row(n.key as SidebarScope, n.name, <AliasAvatar alias={n.name} size={22} />, n.count))}
        {moreTotal ? (
          <Pressable accessibilityRole="button" {...a11yState({ expanded: moreOpen })} onPress={() => setMoreOpen(o => !o)} style={state => [styles.item, ((state as { hovered?: boolean }).hovered || state.pressed) && { backgroundColor: colors.rowHover }]} testID="task-side-more-nodes">
            <View style={styles.icon}>{icon(moreOpen ? 'chevron-down' : 'chevron-forward')}</View>
            <Text style={[styles.itemText, { color: colors.textSecondary }]}>{twoRoles ? tr('tasks.copy.196') : tr('tasks.copy.197')}</Text>
            <Text style={[styles.count, { color: colors.textMuted }]}>{moreTotal}</Text>
          </Pressable>
        ) : null}
        {moreOpen && moreTotal ? (
          <>
            <TextInput value={moreQuery} onChangeText={setMoreQuery} placeholder={tr('tasks.copy.198')} placeholderTextColor={colors.textMuted} style={[styles.search, { color: colors.text, borderColor: colors.border, backgroundColor: colors.inputBg }]} testID="task-side-more-search" accessibilityLabel={tr('tasks.copy.198')} />
            {moreNodes.slice(0, 50).map(n => row(n.key as SidebarScope, n.name, <AliasAvatar alias={n.name} size={22} />, n.count))}
            {moreNodes.length > 50 ? <Text style={[styles.section, { color: colors.textMuted, paddingTop: spacing.xs }]}>{tr('tasks.copy.199')}{moreNodes.length - 50} {tr('tasks.copy.200')}</Text> : null}
            {!moreNodes.length ? <Text style={[styles.section, { color: colors.textMuted, paddingTop: spacing.xs }]}>{tr('tasks.copy.201')}</Text> : null}
          </>
        ) : null}
        {others.length ? <Text style={[styles.section, { color: colors.textMuted }]}>{twoRoles ? tr('tasks.copy.202') : tr('tasks.copy.203')}</Text> : null}
        {others.map(n => row(n.key as SidebarScope, n.name, <AliasAvatar alias={n.name} size={22} />, n.count))}
        <View style={[styles.divider, { backgroundColor: colors.border }]} />
        {row('dispatch', tr('tasks.copy.28'), icon('paper-plane-outline'), null)}
      </ScrollView>
    </View>
  );
}

const makeSidebarStyles = () => StyleSheet.create({
  root: { flex: 1 },
  // 与右侧任务页头部同高(控件 32 + 上下 12):两边标题落在同一条中线上。
  head: { height: CONTROL_H + 24, justifyContent: 'center', paddingHorizontal: spacing.lg },
  title: { fontSize: typeScale.title, fontWeight: weight.strong },
  body: { paddingHorizontal: spacing.sm, paddingBottom: spacing.lg, gap: 2 },
  item: { height: 38, borderRadius: radius.item, paddingHorizontal: spacing.sm + 2, flexDirection: 'row', alignItems: 'center', gap: spacing.sm + 2 },
  icon: { width: 22, alignItems: 'center' },
  itemText: { flex: 1, fontSize: 13 },
  count: { fontSize: typeScale.caption },
  section: { fontSize: typeScale.caption, paddingHorizontal: spacing.sm + 2, paddingTop: spacing.lg, paddingBottom: spacing.xs },
  search: { height: 32, marginHorizontal: spacing.xs, marginVertical: spacing.xs, paddingHorizontal: spacing.sm, borderWidth: 1, borderRadius: radius.control, fontSize: 13 },
  divider: { height: StyleSheet.hairlineWidth, marginVertical: spacing.md, marginHorizontal: spacing.sm },
});
