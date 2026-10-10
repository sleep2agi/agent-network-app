import { dueInfo, ownerLabel, participantChip, participantStack, personDisplay, roleAvatars } from './i18n-task-presentation';
import { t as tr } from './i18n';
import { TaskIssueCount } from './TaskIssueBindings';
import { TaskTagChips } from './TaskTags';
import { useTranslation } from './i18n-react';
// 任务看板的共用小件与样式:卡片、优先级点、期限胶囊、负责人、分段控件、筛选胶囊、主按钮。
// 圆角 / 阴影:卡片与列 16、输入与按钮 12、胶囊 999、柔和阴影 —— 都取自全局 token
// (theme.ts radius / elevation.ts);BOARD_RADIUS / softShadow / liftedShadow 只是看板里的别名。
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from './ui-text';
import { Ionicons } from './icons';
import AliasAvatar from './AliasAvatar';
import { colors, onThemeChange, radius, spacing, themeMode, type as typeScale, weight } from './theme';
import { shadowOnly } from './elevation';
import type { ReqPriority, Requirement, RequirementProject } from './requirements-model';
import { PRIORITY_CODE, priorityLabel } from './task-priority';
import type { RequirementPerson } from './requirement-people';
import { type DueTone } from './task-board-model';
import { checklistCounts } from './board-sync';
import { shortIdLabel } from './task-short-id';
import { cardActivity, checklistProgress, checklistProgressA11y, previewText } from './task-card-activity';

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
// 到期提示(#493):逾期 = 危险色(failed),今天 / 明天 = 警示色(blocked);明天只染字、不铺底色(比今天弱一档)。
export const dueColor = (tone: DueTone): string => (tone === 'overdue' ? colors.failed : tone === 'today' || tone === 'tomorrow' ? colors.blocked : colors.textSecondary);
export const dueBg = (tone: DueTone): string => (tone === 'overdue' ? colors.failed + '1a' : tone === 'today' ? colors.blocked + '1a' : colors.subtleFill);

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
  // 「废弃」(#724):桌面收起时是右侧一条窄栏(竖排标签),展开后列头多一个收起按钮;手机是分页胶囊最后一格。
  abandonedRail: { width: 48, flexShrink: 0, alignItems: 'center', gap: spacing.sm, paddingTop: spacing.md, borderRadius: BOARD_RADIUS.card, backgroundColor: columnBg(), borderWidth: 2, borderColor: 'transparent' },
  abandonedRailText: { width: 96, marginVertical: 38, textAlign: 'center', color: colors.textSecondary, fontSize: typeScale.small, fontWeight: weight.medium, transform: [{ rotate: '90deg' }] },
  abandonedCollapse: { marginLeft: 'auto', width: 24, height: 20, borderRadius: radius.item, alignItems: 'center', justifyContent: 'center' },
  abandonedTab: { borderWidth: 1, borderStyle: 'dashed', borderColor: colors.border },
  abandonedToggle: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', minHeight: 36, paddingHorizontal: spacing.xl, paddingVertical: spacing.sm, borderRadius: radius.control },
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
  // 手机快捷改状态后的撤销提示(task-quick-status.ts):底部居中、深色底,5 秒后自己消失。
  undoToast: { position: 'absolute', left: spacing.lg, right: spacing.lg, bottom: spacing.xl, minHeight: 48, paddingLeft: spacing.lg, paddingRight: spacing.xs, borderRadius: BOARD_RADIUS.control, backgroundColor: themeMode() === 'dark' ? colors.rowActive : '#2b2b2b', flexDirection: 'row', alignItems: 'center', gap: spacing.sm, ...softShadow() },
  undoText: { flex: 1, color: '#fff', fontSize: 14 },
  undoAction: { color: colors.accent, fontSize: 14, fontWeight: '600' },
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

export function DueChip({ item, today, s }: { item: Pick<Requirement, 'due' | 'column' | 'archived'>; today: string; s: TaskStyles }) {
  useTranslation();
  // 已归档的卡和已完成一样:只显示日期,不提示到期 / 逾期。
  const d = dueInfo(item.due, today, item.archived ? 'done' : item.column);
  if (d.tone === 'none') return null;
  const c = dueColor(d.tone);
  return (
    <View
      // 悬停提示完整的本地时刻(到秒):web 上直接写 DOM 的 title(RN-web 不转发 title 属性)。
      ref={(el: any) => { if (el && typeof el.setAttribute === 'function') el.setAttribute('title', d.full); }}
      accessibilityLabel={tr('tasks.copy.81', { v0: d.full })}
      style={[s.due, { flexShrink: 0 }, { backgroundColor: dueBg(d.tone) }]}
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
      {/* 短号靠右、弱化:只在有 seq 的 Hub 上出现(旧 Hub 的卡片一个像素不变)。有期限时期限已经靠右(s.due 的 marginLeft auto),
          短号紧跟在它后面;两个都 auto 会把剩余空间对半分,期限被挤到卡片中间。 */}
      {shortIdLabel(item) ? <Text testID={`req-card-seq-${item.id}`} style={[s.metaMuted, { marginLeft: item.due ? 0 : 'auto', flexShrink: 0, fontVariant: ['tabular-nums'] }]} numberOfLines={1}>{shortIdLabel(item)}</Text> : null}
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

/** 快捷筛选的开关胶囊(#493 我负责 / 我参与 / 已逾期):与 Chip 同高同形,但没有下拉箭头 —— 点一下就开 / 关。 */
export function QuickChip({ label, on, onPress, s, testID, icon, accessibilityLabel }: {
  label: string; on: boolean; onPress: () => void; s: TaskStyles; testID?: string; icon?: keyof typeof Ionicons.glyphMap; accessibilityLabel?: string;
}) {
  useTranslation();
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={accessibilityLabel || label} {...a11yState({ selected: on })} onPress={onPress} style={[s.chip, on && s.chipOn]} testID={testID}>
      {icon ? <Ionicons name={icon} size={14} color={on ? colors.accent : colors.textMuted} /> : null}
      <Text style={[s.chipText, on && s.chipTextOn]} numberOfLines={1}>{label}</Text>
    </Pressable>
  );
}

/** 卡片上的子任务进度:「✓ 3/7」+ 一条细进度条。没有子任务就不画;全勾完 = 绿色实心勾 + 绿条。 */
export function ChecklistProgress({ item, s }: { item: Pick<Requirement, 'checklist' | 'checklistCount'>; s: TaskStyles }) {
  useTranslation();
  // 精简列表的行(board-sync.ts)没有子任务条目,只有 Hub 给的计数。
  const p = checklistProgress(checklistCounts(item));
  if (!p) return null;
  const tone = p.complete ? colors.running : colors.textMuted;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }} testID="task-checklist-progress" accessibilityLabel={checklistProgressA11y(p)} {...({ dataSet: { complete: p.complete ? '1' : '0' } } as object)}>
      <Ionicons name={p.complete ? 'checkmark-circle' : 'checkbox-outline'} size={13} color={tone} />
      <Text style={[s.metaMuted, { fontSize: 11, flexShrink: 0, fontVariant: ['tabular-nums'] }, p.complete && { color: colors.running, fontWeight: weight.medium }]}>{p.done}/{p.total}</Text>
      <View style={{ flex: 1, minWidth: 16, height: 3, borderRadius: radius.pill, backgroundColor: colors.subtleFill, overflow: 'hidden' }}>
        <View style={{ width: `${p.pct}%`, height: 3, backgroundColor: p.complete ? colors.running : colors.accent }} testID="task-checklist-bar" />
      </View>
    </View>
  );
}

/** 列表行上的紧凑进度(#506):图标 +「3/5」,不画进度条;和优先级徽标 / 期限胶囊同高(20),一行里中线对齐。 */
export function ChecklistCompact({ item, s, testID = 'task-checklist-compact' }: { item: Pick<Requirement, 'checklist' | 'checklistCount'>; s: TaskStyles; testID?: string }) {
  useTranslation();
  const p = checklistProgress(checklistCounts(item));
  if (!p) return null;
  const tone = p.complete ? colors.running : colors.textSecondary;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3, height: 20, paddingHorizontal: 6, borderRadius: BOARD_RADIUS.pill, backgroundColor: p.complete ? colors.running + '1a' : colors.subtleFill, flexShrink: 0 }} testID={testID} accessibilityLabel={checklistProgressA11y(p)} {...({ dataSet: { complete: p.complete ? '1' : '0' } } as object)}>
      <Ionicons name={p.complete ? 'checkmark-circle' : 'checkbox-outline'} size={11} color={tone} />
      <Text style={[s.dueText, { color: tone, fontVariant: ['tabular-nums'] }]} numberOfLines={1}>{p.done}/{p.total}</Text>
    </View>
  );
}

// 卡片上的相对时间:整个看板共用一个每分钟一跳的时钟(500 张卡不各开一个定时器)。
let minuteNow = Date.now();
const minuteListeners = new Set<(n: number) => void>();
let minuteTimer: ReturnType<typeof setInterval> | null = null;
export function useMinuteNow(): number {
  const [now, setNow] = useState(() => (minuteListeners.size ? minuteNow : (minuteNow = Date.now())));
  useEffect(() => {
    minuteListeners.add(setNow);
    if (!minuteTimer) minuteTimer = setInterval(() => { minuteNow = Date.now(); minuteListeners.forEach(f => f(minuteNow)); }, 30_000);
    return () => { minuteListeners.delete(setNow); if (!minuteListeners.size && minuteTimer) { clearInterval(minuteTimer); minuteTimer = null; } };
  }, []);
  return now;
}

/**
 * 卡片 / 手机列表行最下面一行弱化的「2 小时前 · 张三把状态改成「进行中」」(#506)。Hub 给 last_event 就说干了什么(含评论),
 * 不给(旧 Hub)按 updatedAt 说「更新」。Agent 名字前一个芯片图标;名字太长只截名字,时间和动词不截。
 * preview(桌面端):评论的正文跟在动词后面,一行、放不下就截,截它先于截名字。手机不画(列表行窄,点开看)。
 * Hub 不给 updatedAt(更旧的 Hub)就不画。
 */
export function CardActivityLine({ item, people, s, preview = false }: { item: Pick<Requirement, 'id' | 'updatedAt' | 'updatedBy' | 'createdAt' | 'lastEvent'>; people: readonly RequirementPerson[]; s: TaskStyles; preview?: boolean }) {
  const { language } = useTranslation();
  const now = useMinuteNow();
  const a = cardActivity(item, people, now);
  if (!a) return null;
  const text = [s.metaMuted, { fontSize: 11, lineHeight: 16 }];
  const showPreview = preview && !!a.preview;
  const dataSet = { actor: a.actor ? (a.actor.agent ? 'agent' : 'user') : 'none', verb: a.verb, source: a.source, field: a.field ?? '' };
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', minHeight: 16, minWidth: 0 }} testID="task-card-activity" accessibilityLabel={a.a11y} {...({ dataSet } as object)}>
      {a.actor ? <>
        <Text style={[text, { flexShrink: 0 }]} numberOfLines={1} testID="task-card-activity-ago">{a.ago}{' ·\u00a0'}</Text>
        {a.actor.agent ? <Ionicons name="hardware-chip-outline" size={11} color={colors.textMuted} style={{ marginRight: 2 }} testID="task-card-activity-agent" /> : null}
        <Text style={[text, { flexShrink: 1, minWidth: 0 }]} numberOfLines={1} testID="task-card-activity-name">{a.actor.name}</Text>
        <Text style={[text, { flexShrink: 0 }]} numberOfLines={1} testID="task-card-activity-verb">{language === 'zh' ? '' : '\u00a0'}{a.verbText}</Text>
      </> : a.source === 'event'
        ? <Text style={[text, { flexShrink: 0 }]} numberOfLines={1} testID="task-card-activity-verb">{a.ago}{' ·\u00a0'}{a.verbText}</Text>
        : <Text style={[text, { flexShrink: 1 }]} numberOfLines={1}>{a.text}</Text>}
      {/* 预览 flex:1 + 基准 0:只吃剩下的宽度,永远不会挤得名字被截(flexShrink 再大,名字也会被挤掉零点几像素出省略号)。 */}
      {showPreview ? <Text style={[text, { flex: 1, flexBasis: 0, minWidth: 0 }]} numberOfLines={1} testID="task-card-activity-preview">{previewText(a.preview!)}</Text> : null}
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
/** onPress:看板卡片上点头像 = 设置参与人(能改时)或打开详情(task-assign.ts);列表表格里不给,点了没有动作。 */
/** meKey:我参与时我的头像排第一、描强调色边(描边宽度不变 → 卡片不长高),名单里标「我」。 */
export function ParticipantStack({ item, people, s, touch, size = 20, onPress, pressLabel, meKey }: { item: Pick<Requirement, 'participants'>; people: readonly RequirementPerson[]; s: TaskStyles; touch: boolean; size?: number; onPress?: (stack: any) => void; pressLabel?: 'assign' | 'open'; meKey?: string | null }) {
  useTranslation();
  const [open, setOpen] = useState(false);
  // 头像组本身:点开参与人选择器时把它交出去,桌面把下拉锚在它下面(measureAnchor)。
  const stackEl = useRef<any>(null);
  const st = participantStack(item.participants, people, 3, meKey);
  if (!st.shown.length) return null;
  return (
    <View style={{ alignItems: 'flex-end', gap: 4 }}>
      <Pressable
        onPress={onPress ? () => onPress(stackEl.current) : undefined}
        // 头像只有 20 高:点的范围上下各放 10(手指 ≥ 40)。
        hitSlop={onPress ? { top: 10, bottom: 10, left: 6, right: 6 } : undefined}
        onLongPress={touch ? () => setOpen(v => !v) : undefined}
        accessibilityRole={onPress ? 'button' : undefined}
        accessibilityLabel={onPress ? tr(pressLabel === 'open' ? 'assign.participantsOpenA11y' : 'assign.participantsA11y', { v0: st.all }) : tr('tasks.copy.87', { v0: st.all })}
        ref={(el: any) => { stackEl.current = el; if (el && typeof el.setAttribute === 'function') el.setAttribute('title', tr('tasks.copy.87', { v0: st.all })); }}
        style={{ flexDirection: 'row', alignItems: 'center' }}
        testID="task-participants"
      >
        {st.shown.map((p, i) => (
          <View key={p.key} style={{ marginLeft: i ? -6 : 0, borderRadius: radius.pill, borderWidth: 1.5, borderColor: p.me ? colors.accent : cardBg(), zIndex: p.me ? 1 : 0 }} testID="task-participant-avatar" {...(p.me ? { dataSet: { participantMe: '1' } } : null) as object}>
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
        // Agent 参与人:浅蓝底 +「名字 · Agent」(品牌蓝),和人类的灰底「名字 人类」一眼分开。
        const d = participantChip(r, people);
        const agent = d.agent;
        return (
          <View key={`${r.kind}:${r.id}`} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, height: 28, paddingLeft: 3, paddingRight: 10, borderRadius: radius.pill, backgroundColor: agent ? colors.tonalBg : colors.subtleFill }} testID={agent ? 'person-chip-agent' : 'person-chip'}>
            {d.known ? <AliasAvatar alias={d.name} size={22} /> : <View style={{ width: 22, height: 22, borderRadius: radius.pill, backgroundColor: colors.border, alignItems: 'center', justifyContent: 'center' }}><Ionicons name="help" size={13} color={colors.textMuted} /></View>}
            <Text style={{ color: d.known ? colors.text : colors.textMuted, fontSize: 13, flexShrink: 1 }} numberOfLines={1}>{d.name}</Text>
            {agent
              ? <Text style={{ color: colors.accent, fontSize: 12, fontWeight: '600' }} testID="person-chip-kind">{d.kindLabel}</Text>
              : <Text style={s.metaMuted} testID="person-chip-kind">{d.kindLabel}</Text>}
          </View>
        );
      })}
    </View>
  );
}

export const STATUS_TONE = { pool: () => colors.rest, doing: () => colors.accent, done: () => colors.running, abandoned: () => colors.textMuted } as const;
