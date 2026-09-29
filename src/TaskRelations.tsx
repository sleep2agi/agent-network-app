// 任务详情里「这张卡和别的东西的关系」:
//   · 属于:<父需求>(子需求的面包屑,点了打开父需求)
//   · 子需求:直接子需求的列表 + 「＋ 新建子需求」(父需求预填),标题旁是完成进度
//   · 外部链接:同步来源(比如 GitHub issue)—— 「在 GitHub 打开」
// 只在 Hub 支持时出现(行里带 parent_id / external_ref 字段)。
import { Pressable, View } from 'react-native';
import { Text } from './ui-text';
import { Ionicons } from './icons';
import { colors, radius, spacing, type as typeScale } from './theme';
import { REQ_COLUMN_LABEL, type Requirement } from './requirements-model';
import { ancestorsOf, childrenOf, hasSubRequirements, subProgress } from './task-board-model';
import { openExternal } from './open-external';
import { STATUS_TONE, useTaskStyles } from './TaskBoardParts';
import { fieldStyles } from './TaskCreateDialog';

export function ParentBreadcrumb({ item, items, onOpen }: { item: Requirement; items: readonly Requirement[]; onOpen: (id: string) => void }) {
  const s = useTaskStyles();
  if (!item.parentId) return null;
  const chain = ancestorsOf(items, item);
  const parent = chain[0];
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }} testID="req-parent-breadcrumb">
      <Ionicons name="git-branch-outline" size={13} color={colors.textMuted} />
      <Text style={s.muted}>属于：</Text>
      {parent ? (
        <Pressable accessibilityRole="link" accessibilityLabel={`打开父需求 ${parent.name}`} onPress={() => onOpen(parent.id)} testID="req-parent-link">
          <Text style={[s.link, { fontSize: typeScale.small }]} numberOfLines={1}>{parent.name}</Text>
        </Pressable>
      ) : <Text style={s.muted}>（父需求已归档或不在当前列表）</Text>}
    </View>
  );
}

export function SubRequirements({ item, items, onOpen, onCreateChild, canAddLevel }: {
  item: Requirement;
  items: readonly Requirement[];
  onOpen: (id: string) => void;
  onCreateChild: (parent: Requirement) => void;
  /** 再往下还能不能加一层(Hub 最多 5 层)。 */
  canAddLevel: boolean;
}) {
  const s = useTaskStyles();
  const f = fieldStyles();
  if (!hasSubRequirements(item)) return null;
  const kids = childrenOf(items, item.id);
  const p = subProgress(items, item);
  return (
    <View style={{ gap: spacing.sm }} testID="req-subrequirements">
      <View style={[f.row, { justifyContent: 'space-between' }]}>
        <Text style={f.label}>子需求</Text>
        {p.total ? <Text style={s.muted} testID="req-subrequirements-progress">{p.done}/{p.total} 完成</Text> : null}
      </View>
      {kids.map(k => (
        <Pressable
          key={k.id}
          accessibilityRole="button"
          accessibilityLabel={`${k.name}，${REQ_COLUMN_LABEL[k.column]}`}
          onPress={() => onOpen(k.id)}
          style={state => [{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 36, paddingHorizontal: spacing.sm, borderRadius: radius.item }, ((state as { hovered?: boolean }).hovered || state.pressed) && { backgroundColor: colors.rowHover }]}
          testID={`req-child-${k.id}`}
        >
          <View style={{ width: 8, height: 8, borderRadius: radius.pill, backgroundColor: STATUS_TONE[k.column]() }} />
          <Text style={{ flex: 1, color: k.column === 'done' ? colors.textMuted : colors.text, fontSize: typeScale.body, textDecorationLine: k.column === 'done' ? 'line-through' : 'none' }} numberOfLines={1}>{k.name}</Text>
          <Text style={s.metaMuted}>{REQ_COLUMN_LABEL[k.column]}</Text>
          <Ionicons name="chevron-forward" size={14} color={colors.textMuted} />
        </Pressable>
      ))}
      {!kids.length && p.total ? <Text style={s.muted}>子需求不在当前筛选里</Text> : null}
      {canAddLevel ? (
        <Pressable accessibilityRole="button" onPress={() => onCreateChild(item)} style={[f.row, { gap: 6, height: 32 }]} testID="req-new-child">
          <Ionicons name="add" size={16} color={colors.accent} />
          <Text style={s.link}>新建子需求</Text>
        </Pressable>
      ) : <Text style={s.muted}>已经是第 5 层,不能再往下加子需求</Text>}
    </View>
  );
}

export function ExternalLink({ item }: { item: Requirement }) {
  const s = useTaskStyles();
  if (!item.externalUrl && !item.externalRef) return null;
  const github = !!item.externalUrl && /^https?:\/\/(www\.)?github\.com\//i.test(item.externalUrl);
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap' }} testID="req-external">
      <Ionicons name={github ? 'logo-github' : 'link-outline'} size={15} color={colors.textSecondary} />
      {item.externalUrl ? (
        <Pressable accessibilityRole="link" onPress={() => { void openExternal(item.externalUrl!); }} testID="req-external-link">
          <Text style={s.link}>{github ? '在 GitHub 打开' : '打开外部链接'}</Text>
        </Pressable>
      ) : null}
      {item.externalRef ? <Text style={s.metaMuted} numberOfLines={1} testID="req-external-ref">{item.externalRef}</Text> : null}
    </View>
  );
}

/** 这张卡在第几层(顶层 = 1),按当前列表里能找到的父链算。 */
export const levelIn = (items: readonly Requirement[], item: Requirement): number => 1 + ancestorsOf(items, item).length;
