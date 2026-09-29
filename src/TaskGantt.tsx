import { t as tr } from './i18n';
import { useTranslation } from './i18n-react';
import { ownerLabel, personName } from './i18n-task-presentation';
// 任务页的「甘特图」视图(只读,STEP 1)。逻辑在 task-gantt-model.ts。
//
// 桌面(内容宽 ≥ NARROW):左边冻结的一列任务名,右边横向滚动的时间轴;时间轴的日期头吸顶,
//   和下面的条同步横向滚动。按项目 / 负责 Agent 分组,日 / 周两种刻度,一条竖线标今天,
//   点条或名字 = 打开现有的任务详情。没有期限的放在图下面的「未设期限」。
// 手机(< NARROW):不画横向时间轴,改成按期限所在周分组的列表,每行一条七格小条标出这一周里占了哪几天。
//   理由:390 宽减掉名字列只剩 ~150px,日刻度一屏不到五天、名字只能截成三四个字;横向拖动时间轴和竖向滚列表
//   在触屏上是同一个手势方向的两个轴,容易拖错;这里的任务多数是几周长的条,一屏五天看到的大多是「整行都满」。
//   按周列表把「这周要交什么」放在第一眼,名字完整,跨度用「开始 → 期限」文字 + 七格条表达。
//
// 🔴 开始 = 创建时间(Hub 还没有开始字段),工具栏上写明。
import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Text } from './ui-text';
import AliasAvatar from './AliasAvatar';
import { colors, onThemeChange, radius, spacing, themeMode, type as typeScale, weight } from './theme';
import type { Requirement, RequirementProject } from './requirements-model';
import type { RequirementPerson } from './requirement-people';
import { PriorityDot, ProjectChip, Segmented, STATUS_TONE, a11yState, cardBg, softShadow, type TaskStyles } from './TaskBoardParts';
import {
  GANTT_DAY_PX, barGeometry, barOverdue, dayDiff, firstCurrentWeek, ganttGroups, ganttRange, ganttTicks, ganttWeeks, plusDays, todayX, weekStrip,
  type GanttBar, type GanttGroup, type GanttGroupBy, type GanttScale,
} from './task-gantt-model';

const NAME_W = 260;
const HEAD_H = 48;
const GROUP_H = 34;
const ROW_H = 36;
const BAR_H = 20;

// 切到别的视图再回来,分组和刻度保持(本次启动内)。
let lastGroupBy: GanttGroupBy | null = null;
let lastScale: GanttScale = 'day';

const monthDay = (ymd: string) => { const [, m, d] = ymd.split('-').map(Number); return tr('tasks.monthDay', { m, d }); };

type Props = {
  items: readonly Requirement[];
  projects: readonly RequirementProject[] | null;
  people: readonly RequirementPerson[];
  today: string;
  s: TaskStyles;
  onOpen: (id: string) => void;
  selectedId?: string | null;
};

export default function TaskGantt(props: Props & { phone: boolean }) {
  useTranslation();
  return props.phone ? <GanttWeekList {...props} /> : <GanttChart {...props} />;
}

function GanttChart({ items, projects, people, today, s, onOpen, selectedId }: Props) {
  useTranslation();
  const g = useGanttStyles();
  const [groupBy, setGroupByState] = useState<GanttGroupBy>(lastGroupBy ?? (projects ? 'project' : 'agent'));
  const [scale, setScaleState] = useState<GanttScale>(lastScale);
  const setGroupBy = (k: GanttGroupBy) => { lastGroupBy = k; setGroupByState(k); };
  const setScale = (k: GanttScale) => { lastScale = k; setScaleState(k); };
  // 旧 Hub 没有项目:只剩按 Agent 分组。
  const effectiveGroupBy: GanttGroupBy = projects ? groupBy : 'agent';
  const nameOf = (ref: { kind: 'user' | 'node'; id: string }) => personName(ref, people);
  const { groups, undated } = useMemo(
    () => ganttGroups(items, { groupBy: effectiveGroupBy, projects, nameOf }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [items, effectiveGroupBy, projects, people],
  );
  const bars = useMemo(() => groups.flatMap(gr => gr.bars), [groups]);
  const range = useMemo(() => ganttRange(bars, today), [bars, today]);
  const px = GANTT_DAY_PX[scale];
  const ticks = useMemo(() => ganttTicks(range, scale), [range, scale]);
  const totalW = range.days * px;
  const tx = todayX(range, today, px);
  const lines = useMemo(() => groups.flatMap(gr => [{ kind: 'group' as const, group: gr }, ...gr.bars.map(bar => ({ kind: 'bar' as const, bar }))]), [groups]);
  const bodyH = lines.reduce((h, l) => h + (l.kind === 'group' ? GROUP_H : ROW_H), 0);

  const headRef = useRef<ScrollView>(null);
  const bodyRef = useRef<ScrollView>(null);
  const [viewW, setViewW] = useState(0);
  const scrollX = useRef(0);
  const goToday = (animated: boolean) => {
    if (tx === null) return;
    const x = Math.max(0, Math.min(totalW - viewW, tx - viewW * 0.3));
    scrollX.current = x;
    bodyRef.current?.scrollTo({ x, animated });
    headRef.current?.scrollTo({ x, animated });
  };
  // 打开 / 换刻度 / 范围变了:把今天放在可视区左边三分之一处。
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (viewW > 0) { const t = setTimeout(() => goToday(false), 0); return () => clearTimeout(t); } return undefined; }, [viewW > 0, scale, range.start, range.days]);

  const groupLabel = (gr: GanttGroup) => (gr.kind === 'project' ? gr.project?.name ?? tr('tasks.copy.31')
    : gr.kind === 'agent' && gr.agent ? nameOf(gr.agent)
      : effectiveGroupBy === 'project' ? (projects ? tr('tasks.copy.31') : tr('tasks.copy.34')) : tr('gantt.noAgent'));

  const toolbar = (
    <View style={g.toolbar} testID="gantt-toolbar">
      {projects ? (
        <Segmented s={s} items={[{ key: 'project', label: tr('gantt.byProject') }, { key: 'agent', label: tr('gantt.byAgent') }]} value={effectiveGroupBy} onChange={setGroupBy} testID="gantt-group" />
      ) : null}
      <Segmented s={s} items={[{ key: 'day', label: tr('gantt.scaleDay') }, { key: 'week', label: tr('gantt.scaleWeek') }]} value={scale} onChange={setScale} testID="gantt-scale" />
      <Pressable accessibilityRole="button" onPress={() => goToday(true)} style={state => [s.chip, ((state as { hovered?: boolean }).hovered || state.pressed) && { backgroundColor: colors.rowHover }]} testID="gantt-today">
        <Text style={s.chipText}>{tr('gantt.jumpToday')}</Text>
      </Pressable>
      <View style={{ flex: 1, minWidth: spacing.md }} />
      <Text style={s.muted} numberOfLines={1} testID="gantt-start-note">{tr('gantt.startNote')}</Text>
    </View>
  );

  const header = (
    <View style={g.headRow} testID="gantt-head">
      <View style={[g.nameCell, g.headName]}>
        <Text style={g.headText}>{tr('tasks.copy.41')}</Text>
        <View style={s.countPill}><Text style={s.countText}>{bars.length}</Text></View>
      </View>
      <ScrollView ref={headRef} horizontal scrollEnabled={false} showsHorizontalScrollIndicator={false} style={{ flex: 1 }}>
        <View style={{ width: totalW, height: HEAD_H }}>
          {ticks.filter(t => t.monthStart).map(t => (
            <Text key={`m-${t.date}`} style={[g.month, { left: t.x + 6 }]} numberOfLines={1}>{tr('gantt.month', { y: t.year, m: t.month })}</Text>
          ))}
          {ticks.map(t => {
            const isToday = scale === 'day' ? t.date === today : dayDiff(t.date, today) >= 0 && dayDiff(t.date, today) < 7;
            return (
              <View key={t.date} style={[g.tick, { left: t.x, width: scale === 'day' ? px : px * 7 }, scale === 'week' && g.tickWeek]}>
                <Text style={[g.tickText, t.weekend && scale === 'day' && { color: colors.textMuted }, isToday && g.tickToday]} numberOfLines={1}>
                  {scale === 'day' ? String(t.day) : monthDay(t.date)}
                </Text>
              </View>
            );
          })}
        </View>
      </ScrollView>
    </View>
  );

  const nameColumn = (
    <View style={{ width: NAME_W }}>
      {lines.map(l => (l.kind === 'group' ? (
        <View key={`g-${l.group.key}`} style={[g.groupRow, g.nameCell]} testID={`gantt-group-${l.group.key}`}>
          {l.group.kind === 'project' && l.group.project ? <View style={[s.columnDot, { backgroundColor: l.group.project.color }]} />
            : l.group.kind === 'agent' && l.group.agent ? <AliasAvatar alias={nameOf(l.group.agent)} size={18} /> : <View style={[s.columnDot, { backgroundColor: colors.rest }]} />}
          <Text style={g.groupText} numberOfLines={1}>{groupLabel(l.group)}</Text>
          <View style={s.countPill}><Text style={s.countText}>{l.group.bars.length}</Text></View>
        </View>
      ) : (
        <Pressable
          key={`n-${l.bar.item.id}`}
          accessibilityRole="button"
          accessibilityLabel={l.bar.item.name}
          onPress={() => onOpen(l.bar.item.id)}
          style={state => [g.nameRow, g.nameCell, ((state as { hovered?: boolean }).hovered || state.pressed) && { backgroundColor: colors.rowHover }, selectedId === l.bar.item.id && g.rowSelected]}
          testID={`gantt-name-${l.bar.item.id}`}
        >
          <PriorityDot p={l.bar.item.priority} s={s} />
          <Text style={[g.nameText, l.bar.item.column === 'done' && s.cardDone]} numberOfLines={1}>{l.bar.item.name}</Text>
        </Pressable>
      )))}
    </View>
  );

  const timeline = (
    <ScrollView
      ref={bodyRef}
      horizontal
      style={{ flex: 1 }}
      onLayout={e => setViewW(e.nativeEvent.layout.width)}
      onScroll={e => { scrollX.current = e.nativeEvent.contentOffset.x; headRef.current?.scrollTo({ x: scrollX.current, animated: false }); }}
      scrollEventThrottle={16}
      testID="gantt-timeline"
    >
      <View style={{ width: totalW, height: bodyH }}>
        {/* 底纹:日刻度画周末,周刻度画每周一条线。 */}
        {scale === 'day'
          ? ticks.filter(t => t.weekend).map(t => <View key={`w-${t.date}`} style={[g.weekend, { left: t.x, width: px }]} />)
          : ticks.map(t => <View key={`l-${t.date}`} style={[g.weekLine, { left: t.x }]} />)}
        {(() => {
          let y = 0;
          return lines.map(l => {
            const top = y;
            if (l.kind === 'group') { y += GROUP_H; return <View key={`gb-${l.group.key}`} style={[g.groupBand, { top }]} />; }
            y += ROW_H;
            const bar: GanttBar = l.bar;
            const geo = barGeometry(bar, range, px);
            const overdue = barOverdue(bar, today);
            return (
              <Pressable
                key={`b-${bar.item.id}`}
                accessibilityRole="button"
                accessibilityLabel={tr('gantt.barA11y', { name: bar.item.name, start: monthDay(bar.start), end: monthDay(bar.end) })}
                {...a11yState({ selected: selectedId === bar.item.id })}
                onPress={() => onOpen(bar.item.id)}
                style={state => [
                  g.bar,
                  { left: geo.x + 1, width: geo.w - 2, top: top + (ROW_H - BAR_H) / 2, backgroundColor: STATUS_TONE[bar.item.column]() },
                  bar.item.column === 'done' && { opacity: 0.45 },
                  overdue && g.barOverdue,
                  geo.clippedLeft && g.barClipped,
                  ((state as { hovered?: boolean }).hovered || state.pressed) && g.barHover,
                  selectedId === bar.item.id && g.barSelected,
                ]}
                testID={`gantt-bar-${bar.item.id}`}
              />
            );
          });
        })()}
        {tx !== null ? <View pointerEvents="none" style={[g.todayLine, { left: tx - 1 }]} testID="gantt-today-line" /> : null}
      </View>
    </ScrollView>
  );

  return (
    <View style={{ flex: 1 }} testID="gantt">
      {toolbar}
      <View style={g.frame}>
        <ScrollView style={{ flex: 1 }} stickyHeaderIndices={[0]} testID="gantt-scroll">
          {header}
          {lines.length ? (
            <View style={{ flexDirection: 'row' }}>
              {nameColumn}
              {timeline}
            </View>
          ) : (
            <View style={g.empty} testID="gantt-empty"><Text style={s.muted}>{tr('gantt.empty')}</Text></View>
          )}
          {undated.length ? <UndatedList items={undated} projects={projects} people={people} s={s} g={g} onOpen={onOpen} selectedId={selectedId} /> : null}
        </ScrollView>
      </View>
    </View>
  );
}

function UndatedList({ items, projects, people, s, g, onOpen, selectedId }: { items: readonly Requirement[]; projects: readonly RequirementProject[] | null; people: readonly RequirementPerson[]; s: TaskStyles; g: GanttStyles; onOpen: (id: string) => void; selectedId?: string | null }) {
  useTranslation();
  const projectById = new Map((projects ?? []).map(p => [p.id, p]));
  return (
    <View testID="gantt-undated">
      <View style={g.undatedHead}>
        <Text style={g.groupText}>{tr('gantt.undated')}</Text>
        <View style={s.countPill}><Text style={s.countText}>{items.length}</Text></View>
        <Text style={s.muted} numberOfLines={1}>{tr('gantt.undatedHint')}</Text>
      </View>
      {items.map(item => (
        <Pressable
          key={item.id}
          accessibilityRole="button"
          accessibilityLabel={item.name}
          onPress={() => onOpen(item.id)}
          style={state => [g.undatedRow, ((state as { hovered?: boolean }).hovered || state.pressed) && { backgroundColor: colors.rowHover }, selectedId === item.id && g.rowSelected]}
          testID={`gantt-undated-${item.id}`}
        >
          <PriorityDot p={item.priority} s={s} />
          <Text style={[g.nameText, item.column === 'done' && s.cardDone]} numberOfLines={1}>{item.name}</Text>
          {projects && item.projectId ? <ProjectChip project={projectById.get(item.projectId)} s={s} small /> : null}
          <Text style={[s.muted, { width: 180 }]} numberOfLines={1}>{ownerLabel(item, people)}</Text>
        </Pressable>
      ))}
    </View>
  );
}

// ── 手机:按周分组的列表 ──
function GanttWeekList({ items, projects, people, today, s, onOpen }: Props) {
  useTranslation();
  const g = useGanttStyles();
  const { weeks, undated } = useMemo(() => ganttWeeks(items, today), [items, today]);
  const projectById = new Map((projects ?? []).map(p => [p.id, p]));
  const scrollRef = useRef<ScrollView>(null);
  const target = firstCurrentWeek(weeks);
  const scrolled = useRef(false);
  const weekTitle = (offset: number, monday: string) => (offset === 0 ? tr('gantt.thisWeek') : offset === -1 ? tr('gantt.lastWeek') : offset === 1 ? tr('gantt.nextWeek')
    : tr('gantt.weekRange', { a: monthDay(monday), b: monthDay(plusDays(monday, 6)) }));
  return (
    <ScrollView ref={scrollRef} style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: spacing.xl }} testID="gantt-weeks">
      <Text style={[s.muted, { paddingHorizontal: spacing.lg, paddingTop: spacing.xs }]} testID="gantt-start-note">{tr('gantt.startNote')}</Text>
      {weeks.length === 0 ? <View style={g.empty} testID="gantt-empty"><Text style={s.muted}>{tr('gantt.empty')}</Text></View> : null}
      {weeks.map((w, wi) => (
        <View
          key={w.monday}
          testID={`gantt-week-${w.monday}`}
          onLayout={wi === target ? e => { if (!scrolled.current && wi > 0) { scrolled.current = true; scrollRef.current?.scrollTo({ y: e.nativeEvent.layout.y, animated: false }); } } : undefined}
        >
          <View style={s.groupHead}>
            <Text style={[s.columnName, w.offset < 0 && { color: colors.textSecondary }]}>{weekTitle(w.offset, w.monday)}</Text>
            {Math.abs(w.offset) <= 1 ? <Text style={s.muted}>{tr('gantt.weekRange', { a: monthDay(w.monday), b: monthDay(plusDays(w.monday, 6)) })}</Text> : null}
            <View style={s.countPill}><Text style={s.countText}>{w.bars.length}</Text></View>
          </View>
          <View style={s.groupList}>
            {w.bars.map((bar, i) => {
              const strip = weekStrip(bar, w.monday);
              const todayIdx = dayDiff(w.monday, today);
              const overdue = barOverdue(bar, today);
              return (
                <Pressable
                  key={bar.item.id}
                  accessibilityRole="button"
                  accessibilityLabel={tr('gantt.barA11y', { name: bar.item.name, start: monthDay(bar.start), end: monthDay(bar.end) })}
                  onPress={() => onOpen(bar.item.id)}
                  style={state => [s.phoneRow, i === w.bars.length - 1 && { borderBottomWidth: 0 }, state.pressed && { backgroundColor: colors.rowHover }]}
                  testID={`gantt-week-row-${bar.item.id}`}
                >
                  {projects && bar.item.projectId ? <ProjectChip project={projectById.get(bar.item.projectId)} s={s} small /> : null}
                  <Text style={[s.cardTitle, bar.item.column === 'done' && s.cardDone]} numberOfLines={2}>{bar.item.name}</Text>
                  <View style={s.meta}>
                    <PriorityDot p={bar.item.priority} s={s} />
                    <Text style={[s.metaText, overdue && { color: colors.failed }]} numberOfLines={1}>
                      {bar.start === bar.end ? monthDay(bar.end) : tr('gantt.span', { a: monthDay(bar.start), b: monthDay(bar.end) })}
                    </Text>
                    <Text style={s.metaMuted} numberOfLines={1}>{ownerLabel(bar.item, people)}</Text>
                  </View>
                  <View style={g.strip} testID={`gantt-strip-${bar.item.id}`}>
                    {strip.map((on, d) => (
                      <View key={d} style={[g.stripCell, on && { backgroundColor: STATUS_TONE[bar.item.column](), opacity: bar.item.column === 'done' ? 0.45 : 1 }, d === todayIdx && g.stripToday]} />
                    ))}
                  </View>
                </Pressable>
              );
            })}
          </View>
        </View>
      ))}
      {undated.length ? (
        <View testID="gantt-undated">
          <View style={s.groupHead}>
            <Text style={s.columnName}>{tr('gantt.undated')}</Text>
            <View style={s.countPill}><Text style={s.countText}>{undated.length}</Text></View>
          </View>
          <View style={s.groupList}>
            {undated.map((item, i) => (
              <Pressable
                key={item.id}
                accessibilityRole="button"
                accessibilityLabel={item.name}
                onPress={() => onOpen(item.id)}
                style={state => [s.phoneRow, i === undated.length - 1 && { borderBottomWidth: 0 }, state.pressed && { backgroundColor: colors.rowHover }]}
                testID={`gantt-undated-${item.id}`}
              >
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

const bandBg = () => (themeMode() === 'dark' ? colors.card : colors.subtleFill);

const makeGanttStyles = () => StyleSheet.create({
  toolbar: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.xl, paddingBottom: spacing.md, paddingTop: spacing.xs },
  frame: { flex: 1, marginHorizontal: spacing.xl, marginBottom: spacing.xl, borderRadius: radius.surface, backgroundColor: cardBg(), overflow: 'hidden', ...softShadow() },
  headRow: { flexDirection: 'row', height: HEAD_H, backgroundColor: cardBg(), borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  nameCell: { width: NAME_W, paddingHorizontal: spacing.lg, borderRightWidth: StyleSheet.hairlineWidth, borderRightColor: colors.border },
  headName: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, height: HEAD_H },
  headText: { color: colors.textMuted, fontSize: typeScale.caption, fontWeight: weight.strong },
  month: { position: 'absolute', top: 5, color: colors.textSecondary, fontSize: typeScale.caption, fontWeight: weight.strong },
  tick: { position: 'absolute', top: 24, height: 20, alignItems: 'center', justifyContent: 'center' },
  tickWeek: { alignItems: 'flex-start', paddingLeft: 6, borderLeftWidth: StyleSheet.hairlineWidth, borderLeftColor: colors.border },
  tickText: { color: colors.textSecondary, fontSize: typeScale.caption, fontWeight: weight.medium },
  tickToday: { color: colors.onAccent, backgroundColor: colors.accent, borderRadius: radius.pill, paddingHorizontal: 5, overflow: 'hidden', fontWeight: weight.strong },
  // 组行的底色要和图的底色(cardBg)差一档:深色的 cardBg 就是 rowActive,所以深色往暗里退一档(= 看板列底)。
  groupRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, height: GROUP_H, backgroundColor: bandBg() },
  groupText: { color: colors.text, fontSize: typeScale.small, fontWeight: weight.strong, flexShrink: 1 },
  groupBand: { position: 'absolute', left: 0, right: 0, height: GROUP_H, backgroundColor: bandBg() },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, height: ROW_H },
  nameText: { flex: 1, minWidth: 0, color: colors.text, fontSize: typeScale.small + 1 },
  rowSelected: { backgroundColor: colors.accent + '14' },
  weekend: { position: 'absolute', top: 0, bottom: 0, backgroundColor: themeMode() === 'dark' ? '#ffffff08' : '#0000000a' },
  weekLine: { position: 'absolute', top: 0, bottom: 0, width: StyleSheet.hairlineWidth, backgroundColor: colors.border },
  bar: { position: 'absolute', height: BAR_H, borderRadius: radius.pill },
  barOverdue: { borderWidth: 2, borderColor: colors.failed },
  // 开始早于左边界:左端几乎是方的,读作「从更早接过来」。
  barClipped: { borderTopLeftRadius: radius.inline, borderBottomLeftRadius: radius.inline },
  barHover: { opacity: 0.8 },
  barSelected: { outlineStyle: 'solid', outlineWidth: 2, outlineColor: colors.text, outlineOffset: 1 } as object,
  todayLine: { position: 'absolute', top: 0, bottom: 0, width: 2, backgroundColor: colors.failed },
  empty: { alignItems: 'center', justifyContent: 'center', paddingVertical: spacing.xl * 2 },
  undatedHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, height: GROUP_H + 6, paddingHorizontal: spacing.lg, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, backgroundColor: bandBg() },
  undatedRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, height: ROW_H, paddingHorizontal: spacing.lg, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  strip: { flexDirection: 'row', gap: 3, height: 6 },
  // 每格都带同样粗的边(平时透明):只给今天那格加边会让它比别的格宽 3px(flex: 1 的基准是 0,边框另算)。
  stripCell: { flex: 1, borderRadius: radius.pill, borderWidth: 1.5, borderColor: 'transparent', backgroundColor: bandBg() },
  stripToday: { borderColor: colors.failed },
});
type GanttStyles = ReturnType<typeof makeGanttStyles>;

function useGanttStyles(): GanttStyles {
  const [v, setV] = useState(0);
  useEffect(() => onThemeChange(() => setV(n => n + 1)), []);
  return useMemo(makeGanttStyles, [v]);
}
