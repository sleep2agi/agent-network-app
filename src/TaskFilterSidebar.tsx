// 桌面工作区在「任务」页时的左栏:原来这里是会话 / Agent 列表(跟任务页无关)。现在是筛选:
// 全部 / 我负责的 / 未分配 / 按节点(头像 + 数目),最下面是「派发记录」(Hub 派给节点的任务)。
// 左栏的每一项只是头部「负责人」筛选的快捷方式 —— 同一份状态(task-board-store),两边永远一致。
import type { ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Text } from './ui-text';
import { Ionicons } from './icons';
import AliasAvatar from './AliasAvatar';
import { colors, radius, spacing, type as typeScale, weight } from './theme';
import { personKey } from './requirement-people';
import { applyFilter, ownerCounts, ownersForScope, scopeOf, type SidebarScope } from './task-board-model';
import { setTaskFilter, setTaskSection, useTaskBoard } from './task-board-store';
import { CONTROL_H } from './TaskBoardParts';

/** onNavigate:在「任务详情」(派发记录的一条)上点左栏时回到任务页。 */
export default function TaskFilterSidebar({ onNavigate }: { onNavigate?: () => void }) {
  const styles = makeSidebarStyles();
  const items = useTaskBoard(s => s.items);
  const people = useTaskBoard(s => s.people);
  const meId = useTaskBoard(s => s.meId);
  const filter = useTaskBoard(s => s.filter);
  const section = useTaskBoard(s => s.section);
  const active = section === 'dispatch' ? null : scopeOf(filter.owners, meId);
  const counts = ownerCounts(items, people);
  const meKey = meId ? personKey({ kind: 'user', id: meId }) : '';
  const countOf = (key: string) => counts.find(c => c.key === key)?.count ?? 0;
  // 按节点:有任务的节点按数目排在前;Hub 成员表里没任务的节点跟在后面(可以先点进去再建)。
  const nodes = [
    ...counts.filter(c => c.ref?.kind === 'node'),
    ...people.filter(p => p.kind === 'node' && !counts.some(c => c.key === personKey(p))).map(p => ({ key: personKey(p), ref: { kind: p.kind, id: p.id }, name: p.name || p.id, count: 0 })),
  ];
  const others = counts.filter(c => c.ref?.kind === 'user' && c.key !== meKey);
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
        accessibilityState={{ selected: on, disabled }}
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
      <View style={styles.head}><Text style={[styles.title, { color: colors.text }]} testID="task-sidebar-title">视图</Text></View>
      <ScrollView contentContainerStyle={styles.body}>
        {row('all', '全部任务', icon('albums-outline'), items.length)}
        {row('mine', '我负责的', icon('person-outline'), meKey ? applyFilter(items, { owners: [meKey], priorities: [] }).length : null, !meId)}
        {row('unassigned', '未分配', icon('help-circle-outline'), countOf('none'))}
        {nodes.length ? <Text style={[styles.section, { color: colors.textMuted }]}>按节点</Text> : null}
        {nodes.map(n => row(n.key as SidebarScope, n.name, <AliasAvatar alias={n.name} size={22} />, n.count))}
        {others.length ? <Text style={[styles.section, { color: colors.textMuted }]}>其他成员</Text> : null}
        {others.map(n => row(n.key as SidebarScope, n.name, <AliasAvatar alias={n.name} size={22} />, n.count))}
        <View style={[styles.divider, { backgroundColor: colors.border }]} />
        {row('dispatch', '派发记录', icon('paper-plane-outline'), null)}
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
  divider: { height: StyleSheet.hairlineWidth, marginVertical: spacing.md, marginHorizontal: spacing.sm },
});
