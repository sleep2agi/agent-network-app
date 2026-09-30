import { t as tr } from './i18n';
import { useTranslation } from './i18n-react';
import { ownerLabel } from './i18n-task-presentation';
// 任务页的「日历」视图(只读,STEP 1)。逻辑在 task-calendar-model.ts。
//
// Owner 2026-09-30:「这里面再来个日历视图吧？就是任务里面再来个日历视图。」
// 任务按预计完成落在那天(带时刻的按本地时区,格子里写本地时刻);没有期限的不进日历,列在「未设期限」。
// 桌面:月 / 周两种格子,周一开头;每格列出当天的任务(优先级点 + 时刻 + 标题),放不下收进「+N」→ 当天的浮层;
//   今天高亮,‹ › 翻页,「今天」回来,点任务 = 打开现有详情。
// 手机:仿微信 / 系统日历 —— 上面一张月历(有任务的日子下面一个点),点一天在下面列出那天的任务;
//   横滑或 ‹ › 翻月。桌面那种「格子里写标题」在 390 宽上一格只有 ~50px,一个字都放不下。
import { useEffect, useMemo, useRef, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Text } from './ui-text';
import { Ionicons } from './icons';
import { colors, onThemeChange, radius, spacing, themeMode, type as typeScale, weight } from './theme';
import type { Requirement, RequirementProject } from './requirements-model';
import type { RequirementPerson } from './requirement-people';
import { PriorityDot, ProjectChip, Segmented, a11yState, cardBg, priorityColor, softShadow, type TaskStyles } from './TaskBoardParts';
import {
  calendarBuckets, calendarCells, cellCapacity, cellOverflow, dayDot, entryOverdue, monthAnchorOf, shiftAnchor, swipeDelta,
  type CalendarEntry, type CalendarMode,
} from './task-calendar-model';

const WEEK = ['tasks.copy.167', 'tasks.copy.168', 'tasks.copy.169', 'tasks.copy.170', 'tasks.copy.171', 'tasks.copy.172', 'tasks.copy.173'];
const CELL_HEAD_H = 28;
const ITEM_H = 22;
const PHONE_CELL_H = 46;

// 切到别的视图再回来,月 / 周保持(本次启动内)。
let lastMode: CalendarMode = 'month';

const md = (ymd: string) => tr('tasks.monthDay', { m: +ymd.slice(5, 7), d: +ymd.slice(8, 10) });
const weekdayIdx = (ymd: string) => { const [y, m, d] = ymd.split('-').map(Number); return (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7; };
const dayTitle = (ymd: string) => tr('cal.dayTitle', { md: md(ymd), wd: tr(WEEK[weekdayIdx(ymd)]) });
const whenText = (e: CalendarEntry) => e.time ?? tr('tasks.allDay');

type Props = {
  items: readonly Requirement[];
  projects: readonly RequirementProject[] | null;
  people: readonly RequirementPerson[];
  today: string;
  s: TaskStyles;
  onOpen: (id: string) => void;
  selectedId?: string | null;
};

export default function TaskCalendar(props: Props & { phone: boolean }) {
  useTranslation();
  return props.phone ? <CalendarPhone {...props} /> : <CalendarDesktop {...props} />;
}

function CalendarDesktop({ items, today, s, onOpen, selectedId, people }: Props) {
  useTranslation();
  const c = useCalendarStyles();
  const [mode, setModeState] = useState<CalendarMode>(lastMode);
  const setMode = (m: CalendarMode) => { lastMode = m; setModeState(m); };
  const [anchor, setAnchor] = useState(today);
  const { days, undated } = useMemo(() => calendarBuckets(items), [items]);
  const cells = calendarCells(anchor, mode);
  const rows = mode === 'month' ? 6 : 1;
  const [gridH, setGridH] = useState(0);
  const capacity = cellCapacity(gridH / rows, CELL_HEAD_H, ITEM_H);
  const [popover, setPopover] = useState<{ title: string; entries: CalendarEntry[] | null; undated?: Requirement[] } | null>(null);
  const title = mode === 'month'
    ? tr('gantt.month', { y: +anchor.slice(0, 4), m: +anchor.slice(5, 7) })
    : tr('gantt.weekRange', { a: md(cells[0].date), b: md(cells[6].date) });
  const open = (id: string) => { setPopover(null); onOpen(id); };

  const entryRow = (e: CalendarEntry, inPopover = false) => {
    const overdue = entryOverdue(e, today);
    return (
      <Pressable
        key={e.item.id}
        accessibilityRole="button"
        accessibilityLabel={tr('cal.itemA11y', { name: e.item.name, when: whenText(e) })}
        {...a11yState({ selected: selectedId === e.item.id })}
        onPress={() => open(e.item.id)}
        style={state => [inPopover ? c.popRow : c.item, ((state as { hovered?: boolean }).hovered || state.pressed) && { backgroundColor: colors.rowHover }, selectedId === e.item.id && c.itemSelected]}
        testID={inPopover ? `cal-pop-item-${e.item.id}` : `cal-item-${e.item.id}`}
      >
        <View style={[c.dot, { backgroundColor: priorityColor(e.item.priority) }, (e.item.priority === 'low' || e.item.priority === 'lowest') && { backgroundColor: 'transparent', borderWidth: 1.5, borderColor: priorityColor(e.item.priority) }]} />
        {e.time ? <Text style={c.time}>{e.time}</Text> : null}
        <Text style={[c.itemText, overdue && { color: colors.failed }, e.item.column === 'done' && s.cardDone]} numberOfLines={1}>{e.item.name}</Text>
      </Pressable>
    );
  };

  return (
    <View style={{ flex: 1 }} testID="calendar">
      <View style={c.toolbar} testID="cal-toolbar">
        <Segmented s={s} items={[{ key: 'month', label: tr('cal.month') }, { key: 'week', label: tr('cal.week') }]} value={mode} onChange={setMode} testID="cal-mode" />
        <View style={c.nav}>
          <Pressable accessibilityRole="button" accessibilityLabel={tr('cal.prev')} onPress={() => setAnchor(a => shiftAnchor(a, mode, -1))} style={s.iconButton} testID="cal-prev">
            <Ionicons name="chevron-back" size={16} color={colors.textSecondary} />
          </Pressable>
          <Text style={c.title} numberOfLines={1} testID="cal-title">{title}</Text>
          <Pressable accessibilityRole="button" accessibilityLabel={tr('cal.next')} onPress={() => setAnchor(a => shiftAnchor(a, mode, 1))} style={s.iconButton} testID="cal-next">
            <Ionicons name="chevron-forward" size={16} color={colors.textSecondary} />
          </Pressable>
        </View>
        <Pressable accessibilityRole="button" onPress={() => setAnchor(today)} style={state => [s.chip, ((state as { hovered?: boolean }).hovered || state.pressed) && { backgroundColor: colors.rowHover }]} testID="cal-today">
          <Text style={s.chipText}>{tr('gantt.jumpToday')}</Text>
        </Pressable>
        <View style={{ flex: 1 }} />
        {undated.length ? (
          <Pressable accessibilityRole="button" onPress={() => setPopover({ title: tr('gantt.undated'), entries: null, undated })} style={state => [s.chip, ((state as { hovered?: boolean }).hovered || state.pressed) && { backgroundColor: colors.rowHover }]} testID="cal-undated-chip">
            <Text style={s.chipText}>{tr('cal.undatedChip', { n: undated.length })}</Text>
          </Pressable>
        ) : null}
      </View>
      <View style={c.frame}>
        <View style={c.weekHead}>
          {WEEK.map((w, i) => <Text key={w} style={[c.weekDay, i >= 5 && { color: colors.textMuted }]}>{tr(w)}</Text>)}
        </View>
        <View style={{ flex: 1 }} onLayout={e => setGridH(e.nativeEvent.layout.height)} testID="cal-grid">
          {Array.from({ length: rows }, (_, r) => (
            <View key={r} style={c.row}>
              {cells.slice(r * 7, r * 7 + 7).map(cell => {
                const entries = days.get(cell.date) ?? [];
                const { shown, more } = cellOverflow(entries.length, capacity);
                const isToday = cell.date === today;
                const first = cell.date.endsWith('-01');
                return (
                  <View key={cell.date} style={[c.cell, !cell.inMonth && mode === 'month' && c.cellOut, isToday && c.cellToday]} testID={`cal-cell-${cell.date}`}>
                    <View style={c.cellHead}>
                      <Text style={[c.dayNum, !cell.inMonth && mode === 'month' && { color: colors.textMuted }, isToday && c.dayToday]} testID={isToday ? 'cal-today-num' : undefined}>
                        {first || mode === 'week' ? md(cell.date) : String(+cell.date.slice(8))}
                      </Text>
                    </View>
                    {entries.slice(0, shown).map(e => entryRow(e))}
                    {more ? (
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={tr('cal.moreA11y', { n: more })}
                        onPress={() => setPopover({ title: dayTitle(cell.date), entries })}
                        style={state => [c.more, ((state as { hovered?: boolean }).hovered || state.pressed) && { backgroundColor: colors.rowHover }]}
                        testID={`cal-more-${cell.date}`}
                      >
                        <Text style={c.moreText}>{tr('cal.more', { n: more })}</Text>
                      </Pressable>
                    ) : null}
                  </View>
                );
              })}
            </View>
          ))}
        </View>
      </View>
      <Modal visible={!!popover} transparent animationType="fade" onRequestClose={() => setPopover(null)}>
        <View style={c.scrimWrap}>
          <Pressable accessibilityLabel={tr('taskSel.close')} onPress={() => setPopover(null)} style={StyleSheet.absoluteFill} testID="cal-pop-scrim" />
          {popover ? (
            <View style={c.popover} accessibilityViewIsModal testID="cal-popover">
              <View style={c.popHead}>
                <Text style={c.popTitle} numberOfLines={1}>{popover.title}</Text>
                <Pressable accessibilityRole="button" accessibilityLabel={tr('taskSel.close')} onPress={() => setPopover(null)} style={s.iconButton} testID="cal-pop-close">
                  <Ionicons name="close" size={16} color={colors.textSecondary} />
                </Pressable>
              </View>
              <ScrollView style={{ maxHeight: 360 }}>
                {popover.entries ? popover.entries.map(e => entryRow(e, true)) : (popover.undated ?? []).map(item => (
                  <Pressable key={item.id} accessibilityRole="button" accessibilityLabel={item.name} onPress={() => open(item.id)} style={state => [c.popRow, ((state as { hovered?: boolean }).hovered || state.pressed) && { backgroundColor: colors.rowHover }]} testID={`cal-undated-${item.id}`}>
                    <PriorityDot p={item.priority} s={s} />
                    <Text style={[c.itemText, item.column === 'done' && s.cardDone]} numberOfLines={1}>{item.name}</Text>
                    <Text style={[s.muted, { maxWidth: 120 }]} numberOfLines={1}>{ownerLabel(item, people)}</Text>
                  </Pressable>
                ))}
              </ScrollView>
            </View>
          ) : null}
        </View>
      </Modal>
    </View>
  );
}

// 抬手那一下 react-native-web 的 nativeEvent.pageX 取自 touches[0](抬手后已空)→ NaN,横滑永远不翻页。
// 先看 changedTouches(抬起的那根手指),原生上两者都有。
const touchPoint = (ne: any): { x: number; y: number } => { const t = ne?.changedTouches?.[0] ?? ne; return { x: Number(t?.pageX), y: Number(t?.pageY) }; };

// ── 手机:月历 + 选中那天的列表 ──
function CalendarPhone({ items, projects, people, today, s, onOpen }: Props) {
  useTranslation();
  const c = useCalendarStyles();
  const [anchor, setAnchor] = useState(monthAnchorOf(today));
  const [picked, setPicked] = useState(today);
  const { days, undated } = useMemo(() => calendarBuckets(items), [items]);
  const cells = calendarCells(anchor, 'month');
  const projectById = new Map((projects ?? []).map(p => [p.id, p]));
  const month = anchor.slice(0, 7);
  const go = (delta: number) => setAnchor(a => shiftAnchor(a, 'month', delta));
  const pick = (date: string) => { setPicked(date); if (date.slice(0, 7) !== month) setAnchor(monthAnchorOf(date)); };
  const touch = useRef<{ x: number; y: number } | null>(null);
  const list = days.get(picked) ?? [];
  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: spacing.xl }} testID="calendar-phone">
      <View style={c.phoneHead}>
        <Pressable accessibilityRole="button" accessibilityLabel={tr('cal.prev')} onPress={() => go(-1)} style={s.iconButton} testID="cal-prev">
          <Ionicons name="chevron-back" size={18} color={colors.textSecondary} />
        </Pressable>
        <Text style={[c.title, { flex: 1, textAlign: 'center' }]} testID="cal-title">{tr('gantt.month', { y: +anchor.slice(0, 4), m: +anchor.slice(5, 7) })}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel={tr('cal.next')} onPress={() => go(1)} style={s.iconButton} testID="cal-next">
          <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />
        </Pressable>
        <Pressable accessibilityRole="button" onPress={() => { setAnchor(monthAnchorOf(today)); setPicked(today); }} style={[s.chip, { height: 30 }]} testID="cal-today">
          <Text style={s.chipText}>{tr('gantt.jumpToday')}</Text>
        </Pressable>
      </View>
      <View style={c.phoneWeek}>
        {WEEK.map((w, i) => <Text key={w} style={[c.phoneWeekDay, i >= 5 && { color: colors.textMuted }]}>{tr(w)}</Text>)}
      </View>
      <View
        style={c.phoneGrid}
        testID="cal-grid"
        onTouchStart={e => { touch.current = touchPoint(e.nativeEvent); }}
        onTouchEnd={e => {
          const start = touch.current; touch.current = null;
          if (!start) return;
          const end = touchPoint(e.nativeEvent);
          const d = swipeDelta(end.x - start.x, end.y - start.y);
          if (d) go(d);
        }}
      >
        {Array.from({ length: 6 }, (_, r) => (
          <View key={r} style={{ flexDirection: 'row' }}>
            {cells.slice(r * 7, r * 7 + 7).map(cell => {
              const on = cell.date === picked;
              const isToday = cell.date === today;
              const dot = dayDot(days.get(cell.date));
              return (
                <Pressable
                  key={cell.date}
                  accessibilityRole="button"
                  accessibilityLabel={`${dayTitle(cell.date)}${dot ? ` · ${tr('cal.hasTasks', { n: days.get(cell.date)?.length ?? 0 })}` : ''}`}
                  {...a11yState({ selected: on })}
                  onPress={() => pick(cell.date)}
                  style={c.phoneCell}
                  testID={`cal-day-${cell.date}`}
                >
                  <View style={[c.phoneNum, isToday && !on && c.phoneNumToday, on && c.phoneNumOn]}>
                    <Text style={[c.phoneNumText, !cell.inMonth && { color: colors.textMuted }, isToday && { color: colors.accent, fontWeight: weight.strong }, on && { color: colors.onAccent, fontWeight: weight.strong }]}>{+cell.date.slice(8)}</Text>
                  </View>
                  <View style={[c.phoneDot, dot === 'open' && { backgroundColor: on ? colors.accent : colors.textSecondary }, dot === 'done' && { borderWidth: 1, borderColor: colors.textMuted }]} testID={dot ? `cal-dot-${cell.date}` : undefined} />
                </Pressable>
              );
            })}
          </View>
        ))}
      </View>
      <View style={s.groupHead} testID="cal-picked-head">
        <Text style={s.columnName}>{dayTitle(picked)}</Text>
        <View style={s.countPill}><Text style={s.countText}>{list.length}</Text></View>
      </View>
      {list.length ? (
        <View style={s.groupList} testID="cal-picked-list">
          {list.map((e, i) => (
            <Pressable
              key={e.item.id}
              accessibilityRole="button"
              accessibilityLabel={tr('cal.itemA11y', { name: e.item.name, when: whenText(e) })}
              onPress={() => onOpen(e.item.id)}
              style={state => [s.phoneRow, i === list.length - 1 && { borderBottomWidth: 0 }, state.pressed && { backgroundColor: colors.rowHover }]}
              testID={`cal-row-${e.item.id}`}
            >
              {projects && e.item.projectId ? <ProjectChip project={projectById.get(e.item.projectId)} s={s} small /> : null}
              <Text style={[s.cardTitle, e.item.column === 'done' && s.cardDone]} numberOfLines={2}>{e.item.name}</Text>
              <View style={s.meta}>
                <PriorityDot p={e.item.priority} s={s} />
                <Text style={[s.metaText, entryOverdue(e, today) && { color: colors.failed }]} numberOfLines={1}>{whenText(e)}</Text>
                <Text style={s.metaMuted} numberOfLines={1}>{ownerLabel(e.item, people)}</Text>
              </View>
            </Pressable>
          ))}
        </View>
      ) : <Text style={[s.muted, { paddingHorizontal: spacing.lg + spacing.xs }]} testID="cal-picked-empty">{tr('cal.emptyDay')}</Text>}
      {undated.length ? (
        <View testID="cal-undated">
          <View style={s.groupHead}>
            <Text style={s.columnName}>{tr('gantt.undated')}</Text>
            <View style={s.countPill}><Text style={s.countText}>{undated.length}</Text></View>
          </View>
          <View style={s.groupList}>
            {undated.map((item, i) => (
              <Pressable key={item.id} accessibilityRole="button" accessibilityLabel={item.name} onPress={() => onOpen(item.id)} style={state => [s.phoneRow, i === undated.length - 1 && { borderBottomWidth: 0 }, state.pressed && { backgroundColor: colors.rowHover }]} testID={`cal-undated-${item.id}`}>
                <Text style={[s.cardTitle, item.column === 'done' && s.cardDone]} numberOfLines={2}>{item.name}</Text>
                <Text style={s.metaMuted} numberOfLines={1}>{ownerLabel(item, people)}</Text>
              </Pressable>
            ))}
          </View>
        </View>
      ) : null}
    </ScrollView>
  );
}

const makeCalendarStyles = () => StyleSheet.create({
  toolbar: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.xl, paddingBottom: spacing.md, paddingTop: spacing.xs },
  nav: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  title: { color: colors.text, fontSize: typeScale.body, fontWeight: weight.strong, minWidth: 96, textAlign: 'center' },
  frame: { flex: 1, marginHorizontal: spacing.xl, marginBottom: spacing.xl, borderRadius: radius.surface, backgroundColor: cardBg(), overflow: 'hidden', ...softShadow() },
  weekHead: { flexDirection: 'row', height: 32, alignItems: 'center', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  weekDay: { flex: 1, textAlign: 'center', color: colors.textSecondary, fontSize: typeScale.caption, fontWeight: weight.strong },
  row: { flex: 1, flexDirection: 'row', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  // 每格都带同样的右边线(最后一列的被圆角框裁掉):只给前六列画线会让第七列宽出一条线。
  cell: { flex: 1, flexBasis: 0, minWidth: 0, overflow: 'hidden', paddingHorizontal: 4, paddingBottom: 2, borderRightWidth: StyleSheet.hairlineWidth, borderRightColor: colors.border },
  cellOut: { backgroundColor: themeMode() === 'dark' ? colors.card : colors.subtleFill },
  cellToday: { backgroundColor: colors.accent + '0f' },
  cellHead: { height: CELL_HEAD_H, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 2 },
  dayNum: { color: colors.text, fontSize: typeScale.small, fontWeight: weight.medium, paddingHorizontal: 6, lineHeight: 20, borderRadius: radius.pill, overflow: 'hidden' },
  dayToday: { color: colors.onAccent, backgroundColor: colors.accent, fontWeight: weight.strong },
  item: { flexDirection: 'row', alignItems: 'center', gap: 5, height: ITEM_H, paddingHorizontal: 4, borderRadius: radius.mark },
  itemSelected: { backgroundColor: colors.accent + '1f' },
  dot: { width: 7, height: 7, borderRadius: radius.pill, flexShrink: 0 },
  time: { color: colors.textMuted, fontSize: typeScale.caption, flexShrink: 0 },
  itemText: { flex: 1, minWidth: 0, color: colors.text, fontSize: typeScale.caption + 1 },
  more: { height: ITEM_H, justifyContent: 'center', paddingHorizontal: 4, borderRadius: radius.mark },
  moreText: { color: colors.textSecondary, fontSize: typeScale.caption, fontWeight: weight.strong },
  scrimWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.18)' },
  popover: { width: 340, maxWidth: '92%', padding: spacing.md, borderRadius: radius.surface, backgroundColor: colors.card, borderWidth: themeMode() === 'dark' ? 1 : 0, borderColor: colors.border, ...softShadow() },
  popHead: { flexDirection: 'row', alignItems: 'center', paddingLeft: spacing.sm, marginBottom: spacing.xs },
  popTitle: { flex: 1, color: colors.text, fontSize: typeScale.body, fontWeight: weight.strong },
  popRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 36, paddingHorizontal: spacing.sm, borderRadius: radius.item },
  // 手机
  phoneHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, paddingHorizontal: spacing.lg, paddingTop: spacing.xs, paddingBottom: spacing.sm },
  phoneWeek: { flexDirection: 'row', paddingHorizontal: spacing.lg, paddingBottom: spacing.xs },
  phoneWeekDay: { flex: 1, textAlign: 'center', color: colors.textSecondary, fontSize: typeScale.caption, fontWeight: weight.medium },
  phoneGrid: { paddingHorizontal: spacing.lg },
  phoneCell: { flex: 1, height: PHONE_CELL_H, alignItems: 'center', justifyContent: 'center', gap: 3 },
  phoneNum: { width: 32, height: 32, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  phoneNumToday: { borderWidth: 1.5, borderColor: colors.accent },
  phoneNumOn: { backgroundColor: colors.accent },
  phoneNumText: { color: colors.text, fontSize: typeScale.body },
  phoneDot: { width: 5, height: 5, borderRadius: radius.pill },
});
type CalendarStyles = ReturnType<typeof makeCalendarStyles>;

function useCalendarStyles(): CalendarStyles {
  const [v, setV] = useState(0);
  useEffect(() => onThemeChange(() => setV(n => n + 1)), []);
  return useMemo(makeCalendarStyles, [v]);
}
