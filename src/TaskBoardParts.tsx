import { dueInfo, ownerLabel, participantStack, personDisplay, roleAvatars } from './i18n-task-presentation';
import { t as tr } from './i18n';
import { TaskIssueCount } from './TaskIssueBindings';
import { TaskTagChips } from './TaskTags';
import { useTranslation } from './i18n-react';
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
import type { ReqPriority, Requirement, RequirementProject } from './requirements-model';
import { PRIORITY_CODE, priorityLabel } from './task-priority';
import type { RequirementPerson } from './requirement-people';
import { checklistProgress, type DueTone } from './task-board-model';

/**
 * accessibilityState + 同样的 aria-* 属性。react-native-web 0.21 已经**不读** accessibilityState
 * (只认 aria-checked / aria-selected …),桌面端(Tauri 里的 web)读屏和浏览器就拿不到选中 / 勾选状态;
 * 原生两个都认。任务页的控件都走这里。
 */
export function a11yState(st: { selected?: boolean; checked?: boolean; disabled?: boolean; expanded?: boolean }): object {
  return {
    accessibilityState: st,
    ...(st.selected !== undefined ? { 'aria-selected': st.selected } : {}),
    ...(st.checked !== undefined ? { 'aria-checked': st.checked } : {}),
    ...(st.disabled !== undefined ? { 'aria-disabled': st.disabled } : {}),
    ...(st.expanded !== undefined ? { 'aria-expanded': st.expanded } : {}),
  };
}

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

export const priorityColor = (p: ReqPriority): string => (p === 'high' ? colors.failed : p === 'normal' ? colors.textSecondary : p === 'low' ? colors.rest : colors.textMuted);
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
  // 手机分页看板:一页一列,页宽 / 列宽由 task-board-layout 算成数值。横向 ScrollView 里不写 flex / flexBasis /
  // 百分比 —— 原生 Yoga 上 flex: 1 + flexBasis: 'auto' 的基准是 0,列会塌成 4px(0.2.143 真机)。
  // flexGrow 只作用在页内的竖直主轴(撑满页高)。
  columnPaged: { flexGrow: 1, borderRadius: BOARD_RADIUS.card, backgroundColor: columnBg(), borderWidth: 2, borderColor: 'transparent', overflow: 'hidden' },
  boardPaged: { flexDirection: 'row', paddingTop: spacing.xs, paddingBottom: spacing.lg },
  pager: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs, paddingHorizontal: spacing.lg, paddingBottom: spacing.xs },
  pagerTab: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 30, paddingHorizontal: spacing.md, borderRadius: BOARD_RADIUS.pill },
  pagerTabOn: { backgroundColor: cardBg(), ...softShadow() },
  pagerText: { color: colors.textSecondary, fontSize: typeScale.small, fontWeight: weight.medium },
  pagerTextOn: { color: colors.text, fontWeight: weight.strong },
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
  // 桌面多选:描边画在盒子里面(outlineOffset 负值),不改盒子尺寸、不挤内边距。
  cardSelected: { outlineStyle: 'solid', outlineWidth: 2, outlineColor: colors.accent, outlineOffset: -2, backgroundColor: colors.accent + '0f' } as object,
  cardHover: { backgroundColor: themeMode() === 'dark' ? colors.groupedRowPressed : colors.rowHover },
  cardDragging: { opacity: 0.35 },
  cardTitle: { color: colors.text, fontSize: typeScale.body, fontWeight: weight.medium, lineHeight: 20 },
  cardDone: { color: colors.textMuted, textDecorationLine: 'line-through' },
  meta: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 20 },
  metaText: { color: colors.textSecondary, fontSize: typeScale.small, flexShrink: 1 },
  metaMuted: { color: colors.textMuted, fontSize: typeScale.small },
  prioDot: { width: 8, height: 8, borderRadius: radius.pill },
  // 卡片 / 列表里的「P0」徽标:高 20,和期限胶囊同高,一行里中线对齐。
  prioBadge: { height: 20, minWidth: 26, paddingHorizontal: 6, borderRadius: BOARD_RADIUS.pill, borderWidth: 1, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  prioBadgeText: { fontSize: typeScale.caption, fontWeight: weight.strong, lineHeight: 14 },
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
  colProject: { width: 116 },
  colParticipants: { width: 76, flexDirection: 'row', justifyContent: 'flex-start' },
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
  useTranslation();
  // 低 / 极低画空心圈:灰度之外再用形状区分,色弱也分得清;极低再淡一档。
  const hollow = p === 'low' || p === 'lowest';
  return <View accessible={false} style={[s.prioDot, hollow ? { borderWidth: 1.5, borderColor: priorityColor(p) } : { backgroundColor: priorityColor(p) }, p === 'lowest' && { opacity: 0.6 }]} />;
}

/** 卡片 / 列表里的紧凑徽标「P0」…「P3」。P0 实底红、P1 灰底、P2 描边、P3 虚线描边 + 最淡的字。 */
export function PriorityBadge({ p, s, testID = 'task-prio-badge' }: { p: ReqPriority; s: TaskStyles; testID?: string }) {
  useTranslation();
  const c = priorityColor(p);
  const tone = p === 'high' ? { backgroundColor: c + '1a', borderColor: 'transparent' }
    : p === 'normal' ? { backgroundColor: colors.subtleFill, borderColor: 'transparent' }
    : p === 'low' ? { borderColor: c }
    : { borderColor: c, borderStyle: 'dashed' as const };
  return (
    <View style={[s.prioBadge, tone]} accessibilityLabel={tr('tasks.copy.84', { v0: priorityLabel(p) })} testID={testID}>
      <Text style={[s.prioBadgeText, { color: c }]} numberOfLines={1}>{PRIORITY_CODE[p]}</Text>
    </View>
  );
}

export function DueChip({ item, today, s }: { item: Pick<Requirement, 'due' | 'column'>; today: string; s: TaskStyles }) {
  useTranslation();
  const d = dueInfo(item.due, today, item.column);
  if (d.tone === 'none') return null;
  const c = dueColor(d.tone);
  return (
    <View
      // 悬停提示完整的本地时刻(到秒):web 上直接写 DOM 的 title(RN-web 不转发 title 属性)。
      ref={(el: any) => { if (el && typeof el.setAttribute === 'function') el.setAttribute('title', d.full); }}
      accessibilityLabel={tr('tasks.copy.81', { v0: d.full })}
      style={[s.due, { flexShrink: 0 }, { backgroundColor: d.tone === 'overdue' ? colors.failed + '1a' : d.tone === 'today' ? colors.blocked + '1a' : colors.subtleFill }]}
      testID="task-due"
    >
      <Ionicons name={d.tone === 'overdue' ? 'alert-circle-outline' : 'calendar-outline'} size={11} color={c} />
      <Text style={[s.dueText, { color: c }]} numberOfLines={1}>{d.label}</Text>
    </View>
  );
}

export function OwnerBadge({ item, people, s, size = 18, avatarOnly = false }: { item: Requirement; people: readonly RequirementPerson[]; s: TaskStyles; size?: number; avatarOnly?: boolean }) {
  useTranslation();
  const label = ownerLabel(item, people);
  // 分两个角色时:人类负责人在前、负责 Agent 在后,两个头像;旧 Hub 只有一个负责人。
  const avatars = roleAvatars(item, people);
  const legacyText = item.owner === undefined && !!item.assignee;
  const a11y = avatars.length ? avatars.map(a => `${a.role === 'agent' ? tr('tasks.copy.82') : tr('tasks.copy.15')} ${a.name}`).join('，') : tr('tasks.copy.83', { v0: label });
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
  useTranslation();
  return (
    <View style={{ gap: 6 }}><View style={s.meta}>
      {/* 优先级徽标不缩(prioBadge flexShrink 0):窄列里让负责人名字去截断。 */}
      <PriorityBadge p={item.priority} s={s} />
      <OwnerBadge item={item} people={people} s={s} avatarOnly={compact} />
      <DueChip item={item} today={today} s={s} />
      <TaskIssueCount item={item} />
    </View><TaskTagChips tags={item.tags} /></View>
  );
}

export function Segmented<K extends string>({ items, value, onChange, s, testID }: {
  items: readonly { key: K; label: string }[]; value: K; onChange: (k: K) => void; s: TaskStyles; testID?: string;
}) {
  useTranslation();
  return (
    <View style={s.segment} accessibilityRole="tablist" testID={testID}>
      {items.map(it => {
        const on = it.key === value;
        return (
          <Pressable key={it.key} accessibilityRole="tab" {...a11yState({ selected: on })} onPress={() => onChange(it.key)} style={[s.segmentItem, on && s.segmentItemOn]} testID={`${testID}-${it.key}`}>
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
  useTranslation();
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={accessibilityLabel || label} {...a11yState({ selected: on })} onPress={onPress} style={[s.chip, on && s.chipOn]} testID={testID}>
      {leading}
      <Text style={[s.chipText, on && s.chipTextOn]} numberOfLines={1}>{label}</Text>
      <Ionicons name="chevron-down" size={12} color={on ? colors.accent : colors.textMuted} />
    </Pressable>
  );
}

/** 卡片上的子任务进度:「✓ 3/7」+ 一条细进度条。没有子任务就不画。 */
export function ChecklistProgress({ item, s }: { item: Pick<Requirement, 'checklist'>; s: TaskStyles }) {
  useTranslation();
  const p = checklistProgress(item.checklist);
  if (!p.total) return null;
  const complete = p.done === p.total;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }} testID="task-checklist-progress" accessibilityLabel={tr('tasks.copy.85', { v0: p.done, v1: p.total })}>
      <Ionicons name={complete ? 'checkmark-circle' : 'checkbox-outline'} size={13} color={complete ? colors.running : colors.textMuted} />
      <Text style={[s.metaMuted, { fontSize: 11, flexShrink: 0 }]}>{p.done}/{p.total}</Text>
      <View style={{ flex: 1, minWidth: 16, height: 3, borderRadius: radius.pill, backgroundColor: colors.subtleFill, overflow: 'hidden' }}>
        <View style={{ width: `${Math.round(p.ratio * 100)}%`, height: 3, backgroundColor: complete ? colors.running : colors.accent }} testID="task-checklist-bar" />
      </View>
    </View>
  );
}

/** 项目标签:彩色圆点 + 名字,底色是项目色的淡色。归档的项目名字变灰。 */
export function ProjectChip({ project, s, small = false }: { project: RequirementProject | undefined; s: TaskStyles; small?: boolean }) {
  useTranslation();
  if (!project) return null;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, alignSelf: 'flex-start', maxWidth: '100%', height: small ? 18 : 22, paddingHorizontal: small ? 6 : 8, borderRadius: radius.pill, backgroundColor: project.color + '1f' }} testID="task-project-chip" accessibilityLabel={tr('tasks.copy.86', { v0: project.name })}>
      <View style={{ width: 7, height: 7, borderRadius: radius.pill, backgroundColor: project.color }} />
      <Text style={[s.metaText, { fontSize: small ? 11 : 12, color: project.archived ? colors.textMuted : colors.text }]} numberOfLines={1}>{project.name}</Text>
    </View>
  );
}

/**
 * 参与人头像叠放:最多 3 个 + 「+N」。桌面悬停出全部名单(DOM title),手机长按展开名单。
 * 认不出的成员画占位头像,不显示裸 id。
 */
export function ParticipantStack({ item, people, s, touch, size = 20 }: { item: Pick<Requirement, 'participants'>; people: readonly RequirementPerson[]; s: TaskStyles; touch: boolean; size?: number }) {
  useTranslation();
  const [open, setOpen] = useState(false);
  const st = participantStack(item.participants, people);
  if (!st.shown.length) return null;
  return (
    <View style={{ alignItems: 'flex-end', gap: 4 }}>
      <Pressable
        onLongPress={touch ? () => setOpen(v => !v) : undefined}
        accessibilityLabel={tr('tasks.copy.87', { v0: st.all })}
        ref={(el: any) => { if (el && typeof el.setAttribute === 'function') el.setAttribute('title', tr('tasks.copy.87', { v0: st.all })); }}
        style={{ flexDirection: 'row', alignItems: 'center' }}
        testID="task-participants"
      >
        {st.shown.map((p, i) => (
          <View key={p.key} style={{ marginLeft: i ? -6 : 0, borderRadius: radius.pill, borderWidth: 1.5, borderColor: cardBg() }} testID="task-participant-avatar">
            {p.known ? <AliasAvatar alias={p.name} size={size} /> : <View style={{ width: size, height: size, borderRadius: radius.pill, backgroundColor: colors.subtleFill, alignItems: 'center', justifyContent: 'center' }}><Ionicons name="help" size={size * 0.6} color={colors.textMuted} /></View>}
          </View>
        ))}
        {st.more ? <Text style={[s.metaMuted, { marginLeft: 4, fontSize: 11 }]} testID="task-participants-more">+{st.more}</Text> : null}
      </Pressable>
      {open ? <Text style={[s.metaMuted, { fontSize: 11 }]} testID="task-participants-all">{st.all}</Text> : null}
    </View>
  );
}

/** 详情里的参与人:头像 + 名字的胶囊,人类和 Agent 一样;认不出的是占位头像 +「未知成员」。 */
export function PersonChips({ refs, people, s, testID }: { refs: readonly { kind: 'user' | 'node'; id: string }[]; people: readonly RequirementPerson[]; s: TaskStyles; testID?: string }) {
  useTranslation();
  if (!refs.length) return <Text style={s.muted} testID={testID}>{tr('tasks.copy.8')}</Text>;
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }} testID={testID}>
      {refs.map(r => {
        const d = personDisplay(r, people);
        return (
          <View key={`${r.kind}:${r.id}`} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, height: 28, paddingLeft: 3, paddingRight: 10, borderRadius: radius.pill, backgroundColor: colors.subtleFill }} testID="person-chip">
            {d.known ? <AliasAvatar alias={d.name} size={22} /> : <View style={{ width: 22, height: 22, borderRadius: radius.pill, backgroundColor: colors.border, alignItems: 'center', justifyContent: 'center' }}><Ionicons name="help" size={13} color={colors.textMuted} /></View>}
            <Text style={{ color: d.known ? colors.text : colors.textMuted, fontSize: 13 }} numberOfLines={1}>{d.name}</Text>
            <Text style={s.metaMuted}>{r.kind === 'user' ? tr('tasks.copy.1') : 'Agent'}</Text>
          </View>
        );
      })}
    </View>
  );
}

export const STATUS_TONE = { pool: () => colors.rest, doing: () => colors.accent, done: () => colors.running } as const;
