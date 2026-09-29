// 任务看板的共用小件与样式:卡片、优先级点、期限胶囊、负责人、分段控件、筛选胶囊、主按钮。
// 圆角 / 阴影:卡片与列 16、输入与按钮 12、胶囊 999、柔和阴影 —— 都取自全局 token
// (theme.ts radius / elevation.ts);BOARD_RADIUS / softShadow / liftedShadow 只是看板里的别名。
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from './ui-text';
import { Ionicons } from './icons';
import AliasAvatar from './AliasAvatar';
import { colors, onThemeChange, radius, spacing, themeMode, type as typeScale, weight } from './theme';
import { shadowOnly } from './elevation';
import { REQ_PRIORITY_LABEL, type ReqPriority, type Requirement } from './requirements-model';
import type { RequirementPerson } from './requirement-people';
import { dueInfo, ownerLabel, roleAvatars, type DueTone } from './task-board-model';

export const BOARD_RADIUS = {
  card: radius.surface, control: radius.control, pill: radius.pill,
} as const;
/** 头部一行里所有控件的高度:同高 + alignItems center ⇒ 一条中线。 */
export const CONTROL_H = 32;
export const CARD_PAD = 14;

/** 柔和阴影:浅色主题靠阴影浮起,深色主题阴影看不见,改用一条发丝边。 */
// 几何与 #495 原版一致:浅色只有阴影(不加边框,分段选中块和卡片尺寸不变),深色一条发丝边。
export const softShadow = () => (themeMode() === 'dark'
  ? { borderWidth: StyleSheet.hairlineWidth, borderColor: colors.floatingBorder }
  : shadowOnly('raised'));

export const liftedShadow = () => shadowOnly('floating');

/** 列底色和卡片底色要差一档:浅色 = 灰列白卡;深色 = 深列浅卡。 */
export const columnBg = () => (themeMode() === 'dark' ? colors.card : colors.subtleFill);
export const cardBg = () => (themeMode() === 'dark' ? colors.rowActive : colors.card);

export const priorityColor = (p: ReqPriority): string => (p === 'high' ? colors.failed : p === 'normal' ? colors.textSecondary : colors.rest);
export const dueColor = (tone: DueTone): string => (tone === 'overdue' ? colors.failed : tone === 'today' ? colors.blocked : colors.textSecondary);

export const makeTaskStyles = () => StyleSheet.create({
  // 头部
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.xl, paddingVertical: spacing.md, minHeight: CONTROL_H + spacing.md * 2 },
  headerPhone: { paddingHorizontal: spacing.lg, gap: spacing.sm },
  pageTitle: { color: colors.text, fontSize: typeScale.heading, fontWeight: weight.strong, lineHeight: CONTROL_H },
  spacer: { flex: 1 },
  segment: { flexDirection: 'row', height: CONTROL_H, padding: 3, borderRadius: BOARD_RADIUS.control, backgroundColor: colors.subtleFill, alignItems: 'center' },
  segmentItem: { height: CONTROL_H - 6, paddingHorizontal: spacing.md, borderRadius: radius.item, alignItems: 'center', justifyContent: 'center' },
  segmentItemOn: { backgroundColor: cardBg(), ...softShadow() },
  segmentText: { color: colors.textSecondary, fontSize: typeScale.small, fontWeight: weight.medium },
  segmentTextOn: { color: colors.text, fontWeight: weight.strong },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, height: CONTROL_H, paddingHorizontal: spacing.md, borderRadius: BOARD_RADIUS.pill, borderWidth: 1, borderColor: colors.border, backgroundColor: cardBg() },
  chipOn: { borderColor: colors.accent, backgroundColor: colors.accent + '14' },
  chipText: { color: colors.textSecondary, fontSize: typeScale.small, fontWeight: weight.medium },
  chipTextOn: { color: colors.accent },
  primary: { flexDirection: 'row', alignItems: 'center', gap: 4, height: CONTROL_H, paddingHorizontal: spacing.md + 2, borderRadius: BOARD_RADIUS.control, backgroundColor: colors.accent },
  primaryText: { color: colors.onAccent, fontSize: typeScale.small + 1, fontWeight: weight.strong },
  iconButton: { width: CONTROL_H, height: CONTROL_H, borderRadius: BOARD_RADIUS.control, alignItems: 'center', justifyContent: 'center' },
  filterRowPhone: { flexGrow: 0 },
  filterRowPhoneContent: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.lg, paddingBottom: spacing.sm },
  // 看板
  board: { flex: 1, flexDirection: 'row', gap: spacing.lg, paddingHorizontal: spacing.xl, paddingBottom: spacing.xl, paddingTop: spacing.xs },
  boardNarrow: { gap: spacing.md, paddingHorizontal: spacing.lg },
  column: { flex: 1, flexBasis: 0, minWidth: 0, borderRadius: BOARD_RADIUS.card, backgroundColor: columnBg(), borderWidth: 2, borderColor: 'transparent', overflow: 'hidden' },
  columnOver: { borderColor: colors.accent, backgroundColor: colors.accent + '10' },
  columnHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md + 2, paddingTop: spacing.md, paddingBottom: spacing.sm },
  columnDot: { width: 8, height: 8, borderRadius: radius.pill },
  columnName: { color: colors.text, fontSize: typeScale.body, fontWeight: weight.strong },
  countPill: { minWidth: 22, height: 20, paddingHorizontal: 7, borderRadius: BOARD_RADIUS.pill, backgroundColor: themeMode() === 'dark' ? colors.rowActive : colors.card, alignItems: 'center', justifyContent: 'center' },
  countText: { color: colors.textSecondary, fontSize: typeScale.caption, fontWeight: weight.strong },
  columnBody: { flex: 1 },
  columnBodyContent: { paddingHorizontal: spacing.sm + 2, paddingBottom: spacing.sm, gap: spacing.sm },
  columnEmpty: { alignItems: 'center', justifyContent: 'center', paddingVertical: spacing.xl, borderRadius: radius.control, borderWidth: 1, borderStyle: 'dashed', borderColor: colors.border },
  columnEmptyText: { color: colors.textMuted, fontSize: typeScale.small },
  dropLine: { height: 3, borderRadius: radius.pill, backgroundColor: colors.accent, marginVertical: -1 },
  quickAdd: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 36, marginHorizontal: spacing.sm + 2, marginBottom: spacing.sm + 2, paddingHorizontal: spacing.sm, borderRadius: BOARD_RADIUS.control },
  quickAddText: { color: colors.textSecondary, fontSize: typeScale.small + 1, fontWeight: weight.medium },
  quickAddInput: { marginHorizontal: spacing.sm + 2, marginBottom: spacing.sm + 2, minHeight: 40, paddingHorizontal: spacing.md, borderRadius: BOARD_RADIUS.control, backgroundColor: cardBg(), borderWidth: 1, borderColor: colors.accent, color: colors.text, fontSize: typeScale.body },
  // 卡片
  card: { padding: CARD_PAD, borderRadius: BOARD_RADIUS.card, backgroundColor: cardBg(), gap: 10, ...softShadow() },
  cardHover: { backgroundColor: themeMode() === 'dark' ? colors.groupedRowPressed : colors.rowHover },
  cardDragging: { opacity: 0.35 },
  cardTitle: { color: colors.text, fontSize: typeScale.body, fontWeight: weight.medium, lineHeight: 20 },
  cardDone: { color: colors.textMuted, textDecorationLine: 'line-through' },
  meta: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 20 },
  metaText: { color: colors.textSecondary, fontSize: typeScale.small, flexShrink: 1 },
  metaMuted: { color: colors.textMuted, fontSize: typeScale.small },
  prioDot: { width: 8, height: 8, borderRadius: radius.pill },
  owner: { flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 1, minWidth: 0 },
  due: { marginLeft: 'auto', flexDirection: 'row', alignItems: 'center', gap: 4, height: 20, paddingHorizontal: 7, borderRadius: BOARD_RADIUS.pill },
  dueText: { fontSize: typeScale.caption, fontWeight: weight.medium },
  ghost: { position: 'absolute', zIndex: 50, ...liftedShadow() },
  // 列表(桌面表格)
  table: { flex: 1, marginHorizontal: spacing.xl, marginBottom: spacing.xl, borderRadius: BOARD_RADIUS.card, backgroundColor: cardBg(), overflow: 'hidden', ...softShadow() },
  tableHead: { flexDirection: 'row', alignItems: 'center', height: 40, paddingHorizontal: spacing.lg, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border, gap: spacing.md },
  th: { flexDirection: 'row', alignItems: 'center', gap: 4, height: 40 },
  thText: { color: colors.textMuted, fontSize: typeScale.caption, fontWeight: weight.strong },
  thTextOn: { color: colors.text },
  tr: { flexDirection: 'row', alignItems: 'center', minHeight: 48, paddingHorizontal: spacing.lg, gap: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  trHover: { backgroundColor: colors.rowHover },
  tdTitle: { flex: 1, minWidth: 0, color: colors.text, fontSize: typeScale.body },
  colOwner: { width: 150 },
  colPriority: { width: 76 },
  colDue: { width: 104 },
  colStatus: { width: 84 },
  statusPill: { alignSelf: 'flex-start', height: 22, paddingHorizontal: 9, borderRadius: BOARD_RADIUS.pill, flexDirection: 'row', alignItems: 'center', gap: 5 },
  statusPillText: { fontSize: typeScale.caption, fontWeight: weight.strong },
  // 列表(手机分组)
  groupHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.lg, paddingTop: spacing.lg, paddingBottom: spacing.sm },
  groupList: { marginHorizontal: spacing.lg, borderRadius: BOARD_RADIUS.card, backgroundColor: cardBg(), overflow: 'hidden', ...softShadow() },
  phoneRow: { paddingHorizontal: spacing.lg, paddingVertical: spacing.md, gap: 6, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  // 状态 / 空
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl, gap: spacing.sm },
  muted: { color: colors.textMuted, fontSize: typeScale.small },
  err: { color: colors.failed, fontSize: typeScale.small },
  banner: { marginHorizontal: spacing.xl, marginBottom: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: BOARD_RADIUS.control, backgroundColor: colors.failed + '14', flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  link: { color: colors.accent, fontSize: typeScale.small, fontWeight: weight.medium },
});

export type TaskStyles = ReturnType<typeof makeTaskStyles>;

/** 样式随主题 / 字号密度重建(restyleAll 走 onThemeChange)。 */
export function useTaskStyles(): TaskStyles {
  const [v, setV] = useState(0);
  useEffect(() => onThemeChange(() => setV(n => n + 1)), []);
  return useMemo(makeTaskStyles, [v]);
}

export function PriorityDot({ p, s }: { p: ReqPriority; s: TaskStyles }) {
  // 低优先级画空心圈:三种灰度之外再用形状区分,色弱也分得清。
  const low = p === 'low';
  return <View accessible={false} style={[s.prioDot, low ? { borderWidth: 1.5, borderColor: priorityColor(p) } : { backgroundColor: priorityColor(p) }]} />;
}

export function DueChip({ item, today, s }: { item: Pick<Requirement, 'due' | 'column'>; today: string; s: TaskStyles }) {
  const d = dueInfo(item.due, today, item.column);
  if (d.tone === 'none') return null;
  const c = dueColor(d.tone);
  return (
    <View style={[s.due, { flexShrink: 0 }, { backgroundColor: d.tone === 'overdue' ? colors.failed + '1a' : d.tone === 'today' ? colors.blocked + '1a' : colors.subtleFill }]} testID="task-due">
      <Ionicons name={d.tone === 'overdue' ? 'alert-circle-outline' : 'calendar-outline'} size={11} color={c} />
      <Text style={[s.dueText, { color: c }]} numberOfLines={1}>{d.label}</Text>
    </View>
  );
}

export function OwnerBadge({ item, people, s, size = 18, avatarOnly = false }: { item: Requirement; people: readonly RequirementPerson[]; s: TaskStyles; size?: number; avatarOnly?: boolean }) {
  const label = ownerLabel(item, people);
  // 分两个角色时:人类负责人在前、负责 Agent 在后,两个头像;旧 Hub 只有一个负责人。
  const avatars = roleAvatars(item, people);
  const legacyText = item.owner === undefined && !!item.assignee;
  const a11y = avatars.length ? avatars.map(a => `${a.role === 'agent' ? '负责 Agent' : '负责人'} ${a.name}`).join('，') : `负责人 ${label}`;
  return (
    <View style={s.owner} accessibilityLabel={a11y} testID="task-owner">
      {avatars.length ? (
        <View style={{ flexDirection: 'row', gap: 3 }}>
          {avatars.map(a => <View key={a.role} testID={`task-avatar-${a.role}`}><AliasAvatar alias={a.name} size={size} /></View>)}
        </View>
      ) : legacyText ? <AliasAvatar alias={label} size={size} /> : <Ionicons name="person-circle-outline" size={size} color={colors.textMuted} />}
      {avatarOnly && (avatars.length || legacyText) ? null : <Text style={avatars.length || legacyText ? s.metaText : s.metaMuted} numberOfLines={1}>{label}</Text>}
    </View>
  );
}

/** compact:列窄(< 260)时负责人只显示头像 —— 名字截成「d..」比不显示更难读。 */
export function CardMeta({ item, people, today, s, compact = false }: { item: Requirement; people: readonly RequirementPerson[]; today: string; s: TaskStyles; compact?: boolean }) {
  return (
    <View style={s.meta}>
      {/* 优先级不缩:窄列(桌面 1000 宽 ≈ 212px)里让负责人名字去截断,别把「普通」挤成竖排。 */}
      <View style={[s.owner, { flexShrink: 0 }]} accessibilityLabel={`优先级 ${REQ_PRIORITY_LABEL[item.priority]}`}>
        <PriorityDot p={item.priority} s={s} />
        <Text style={[s.metaText, { flexShrink: 0 }]} numberOfLines={1} testID="task-prio-label">{REQ_PRIORITY_LABEL[item.priority]}</Text>
      </View>
      <OwnerBadge item={item} people={people} s={s} avatarOnly={compact} />
      <DueChip item={item} today={today} s={s} />
    </View>
  );
}

export function Segmented<K extends string>({ items, value, onChange, s, testID }: {
  items: readonly { key: K; label: string }[]; value: K; onChange: (k: K) => void; s: TaskStyles; testID?: string;
}) {
  return (
    <View style={s.segment} accessibilityRole="tablist" testID={testID}>
      {items.map(it => {
        const on = it.key === value;
        return (
          <Pressable key={it.key} accessibilityRole="tab" accessibilityState={{ selected: on }} onPress={() => onChange(it.key)} style={[s.segmentItem, on && s.segmentItemOn]} testID={`${testID}-${it.key}`}>
            <Text style={[s.segmentText, on && s.segmentTextOn]}>{it.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function Chip({ label, on, onPress, s, testID, leading, accessibilityLabel }: {
  label: string; on: boolean; onPress: () => void; s: TaskStyles; testID?: string; leading?: ReactNode; accessibilityLabel?: string;
}) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={accessibilityLabel || label} accessibilityState={{ selected: on }} onPress={onPress} style={[s.chip, on && s.chipOn]} testID={testID}>
      {leading}
      <Text style={[s.chipText, on && s.chipTextOn]} numberOfLines={1}>{label}</Text>
      <Ionicons name="chevron-down" size={12} color={on ? colors.accent : colors.textMuted} />
    </Pressable>
  );
}

export const STATUS_TONE = { pool: () => colors.rest, doing: () => colors.accent, done: () => colors.running } as const;
