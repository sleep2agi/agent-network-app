import { useEffect, useRef, useState } from 'react';
import { TaskTagChips } from './TaskTags';
import { Pressable, ScrollView, View } from 'react-native';
import { Text } from './ui-text';
import { Ionicons } from './icons';
import { colors, spacing } from './theme';
import { t } from './i18n';
import { useTranslation } from './i18n-react';
import { taskText } from './i18n-tasks';
import './i18n-task-fields';
import { TaskIssueCount } from './TaskIssueBindings';
import { REQ_COLUMN_LABEL, type Requirement, type RequirementProject } from './requirements-model';
import type { RequirementPerson } from './requirement-people';
import { nextSort, type SortKey, type SortSpec } from './task-board-model';
import { DueChip, OwnerBadge, ParticipantStack, PriorityBadge, ProjectChip, STATUS_TONE, a11yState, type TaskStyles } from './TaskBoardParts';
import TaskListFields from './TaskListFields';
import TaskTimeCell from './TaskTimeCell';
import { fieldWidth, loadFields, resetFieldWidth, saveFields, setFieldWidth, type FieldId, type FieldPref } from './task-list-fields';
import { ParentLine, ProjectSelect } from './TaskFieldPickers';
import { shortIdLabel } from './task-short-id';

const CHECK_W = 20;
const HANDLE = 8, KEY_STEP = 16;
type PointerLike = { nativeEvent: { clientX: number; pointerId: number }; currentTarget: unknown };
export default function TaskListTable({ rows, people, projects, sort, setSort, s, today, selectedId, onOpen, filtered, needsUpdateUpgrade, touch, onMenu, items, selection, onProject, seqCapable = false }: {
  rows: Requirement[]; people: RequirementPerson[]; projects: RequirementProject[] | null;
  sort: SortSpec; setSort: (next: SortSpec) => void; s: TaskStyles; today: string;
  selectedId: string | null; onOpen: (id: string) => void; filtered: boolean; needsUpdateUpgrade: boolean;
  touch: boolean; onMenu: (item: Requirement, x: number, y: number) => void;
  /** 全部任务(标题下的「↳ 母任务」找母任务用)。 */
  items?: readonly Requirement[];
  /** 桌面多选:行首悬停勾选框 + Ctrl/⌘ / Shift 单击(RequirementBoard 管状态,task-select-model.ts)。 */
  selection?: { ids: readonly string[]; onToggle: (id: string) => void; onPress: (id: string, e: unknown) => void };
  /** 项目格就地改(owner 09-29:13 个没项目的任务一张张开详情太慢)。 */
  onProject?: (id: string, projectId: string | null) => void;
  /** Hub 有任务短号(capabilities.requirement_seq):才有「ID」列。旧 Hub 上这一列不出现,字段配置里也没有。 */
  seqCapable?: boolean;
}) {
  useTranslation();
  const [fields, setFields] = useState(loadFields);
  const [now, setNow] = useState(Date.now);
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 30000); return () => clearInterval(timer); }, []);
  const [hover, setHover] = useState<FieldId | null>(null);
  const [resizing, setResizing] = useState<FieldId | null>(null);
  const latest = useRef(fields); latest.current = fields;
  const drag = useRef<{ id: FieldId; x: number; start: number; moved: boolean } | null>(null);
  const commit = (next: FieldPref[]) => { saveFields(next); setFields(next); };
  const visible = fields.filter(f => f.visible && (projects || f.id !== 'project') && (seqCapable || f.id !== 'seq'));
  // Title fills spare card width until the user drags it; after that every column is
  // exactly its stored width and the table scrolls sideways inside its card (Feishu/Notion).
  const cellStyle = (f: FieldPref) => ({ width: fieldWidth(f), minWidth: fieldWidth(f), flexShrink: 0, ...(f.id === 'title' && f.width === undefined ? { flexGrow: 1 } : {}) });
  const cursor = (value: string) => { const body = globalThis.document?.body; if (body) { body.style.cursor = value; body.style.userSelect = value ? 'none' : ''; } };
  // Resize from the rendered width: a stretched title is wider than its stored width.
  const rendered = (handleEl: unknown, id: FieldId) => (handleEl as HTMLElement).parentElement?.getBoundingClientRect().width ?? fieldWidth(latest.current.find(f => f.id === id)!);
  const handle = (id: FieldId) => ({
    onPointerDown: (e: PointerLike) => {
      (e.currentTarget as HTMLElement).setPointerCapture?.(e.nativeEvent.pointerId);
      drag.current = { id, x: e.nativeEvent.clientX, start: rendered(e.currentTarget, id), moved: false };
      setResizing(id); cursor('col-resize');
    },
    onPointerMove: (e: PointerLike) => {
      const d = drag.current; if (!d) return;
      const dx = e.nativeEvent.clientX - d.x;
      if (!d.moved && Math.abs(dx) < 1) return;
      d.moved = true; setFields(setFieldWidth(latest.current, id, d.start + dx));
    },
    onPointerUp: () => { const d = drag.current; drag.current = null; setResizing(null); cursor(''); if (d?.moved) commit(latest.current); },
    onPointerCancel: () => { drag.current = null; setResizing(null); cursor(''); },
    onPointerEnter: () => setHover(id),
    onPointerLeave: () => setHover(h => h === id ? null : h),
    // RN Web View forwards onClick but not onDoubleClick; detail===2 is the second click.
    onClick: (e: { detail?: number; nativeEvent?: { detail?: number } }) => { if ((e.detail ?? e.nativeEvent?.detail) === 2) commit(resetFieldWidth(latest.current, id)); },
    onKeyDown: (e: { nativeEvent: { key: string }; preventDefault: () => void; currentTarget: unknown }) => {
      const step = e.nativeEvent.key === 'ArrowRight' ? KEY_STEP : e.nativeEvent.key === 'ArrowLeft' ? -KEY_STEP : 0;
      if (!step) return;
      e.preventDefault();
      commit(setFieldWidth(latest.current, id, rendered(e.currentTarget, id) + step));
    },
  });
  const content = (item: Requirement, id: FieldId) => {
    switch (id) {
      case 'created': case 'updated': {
        const by = id === 'updated' && item.updatedBy ? people.find(p => p.kind === item.updatedBy!.kind && p.id === item.updatedBy!.id)?.name ?? item.updatedBy.id : undefined;
        return <TaskTimeCell id={`task-time-${item.id}-${id}`} raw={id === 'created' ? item.createdAt : item.updatedAt} now={now} by={by} />;
      }
      case 'title': return <View style={{ flex: 1, minWidth: 0, gap: 4 }}><Text style={[s.tdTitle, item.column === 'done' && s.cardDone]} numberOfLines={1}>{item.name}</Text>{items ? <ParentLine item={item} items={items} /> : null}<TaskTagChips tags={item.tags} /></View>;
      case 'owner': return <OwnerBadge item={item} people={people} s={s} />;
      case 'priority': return <View style={s.owner}><PriorityBadge p={item.priority} s={s} /></View>;
      case 'due': return item.due ? <DueChip item={item} today={today} s={s} /> : <Text style={s.metaMuted}>—</Text>;
      case 'participants': return <ParticipantStack item={item} people={people} s={s} touch={touch} size={18} />;
      case 'project':
        if (onProject && projects && item.projectId !== undefined) return <ProjectSelect compact label={false} value={item.projectId ?? null} projects={projects} onChange={pid => onProject(item.id, pid)} touch={touch} idBase={`req-row-project-${item.id}`} />;
        return item.projectId ? <ProjectChip project={projects?.find(p => p.id === item.projectId)} s={s} small /> : <Text style={s.metaMuted}>—</Text>;
      case 'issues': return <TaskIssueCount item={item} />;
      case 'seq': return <Text testID={`task-seq-${item.id}`} style={[s.metaMuted, { fontVariant: ['tabular-nums'] }]} numberOfLines={1}>{shortIdLabel(item) ?? '—'}</Text>;
      case 'status': return <View style={[s.statusPill, { backgroundColor: STATUS_TONE[item.column]() + '1f' }]}><View style={[s.prioDot, { width: 6, height: 6, backgroundColor: STATUS_TONE[item.column]() }]} /><Text style={[s.statusPillText, { color: STATUS_TONE[item.column]() }]}>{taskText(REQ_COLUMN_LABEL[item.column])}</Text></View>;
    }
  };
  return <View style={{ flex: 1 }}>
    <View style={{ flexDirection: 'row', justifyContent: 'flex-end', paddingHorizontal: spacing.xl, paddingBottom: 10 }}><TaskListFields fields={fields} touch={touch} projects={projects !== null} seqCapable={seqCapable} needsUpdateUpgrade={needsUpdateUpgrade} onChange={commit} /></View>
    <View style={s.table} testID="req-list">
      <ScrollView horizontal contentContainerStyle={{ minWidth: '100%', flexGrow: 1 }}>
        <View style={{ flex: 1, minWidth: visible.reduce((n, f) => n + fieldWidth(f), 0) + spacing.md * (visible.length - 1) + spacing.lg * 2 + (selection ? CHECK_W + spacing.md : 0) }}>
          <View style={s.tableHead}>
            {selection ? <View style={{ width: CHECK_W }} /> : null}
            {visible.map(f => {
              const { id } = f;
              const sortable = id !== 'participants' && id !== 'issues';
              const on = sort.key === id;
              const line = resizing === id ? colors.accent : hover === id ? colors.border : 'transparent';
              return <View key={id} testID={`task-column-${id}`} style={cellStyle(f)}>
                <View style={{ overflow: 'hidden' }}>{sortable ? <Pressable testID={`req-sort-${id}`} accessibilityRole="button" accessibilityLabel={t('tasks.copy.50', { v0: t(`fields.${id}`) })} {...a11yState({ selected: on })} style={s.th} onPress={() => setSort(nextSort(sort, id as SortKey))}><Text style={[s.thText, on && s.thTextOn]} numberOfLines={1}>{t(`fields.${id}`)}</Text>{on ? <Ionicons name={sort.dir === 'asc' ? 'arrow-up' : 'arrow-down'} size={11} color={colors.text} /> : null}</Pressable> : <Text style={s.thText} numberOfLines={1}>{t(`fields.${id}`)}</Text>}</View>
                {!touch ? <View testID={`task-col-resize-${id}`} focusable accessibilityRole="adjustable" accessibilityLabel={t('fields.resize', { name: t(`fields.${id}`) })} {...(handle(id) as object)} style={[{ position: 'absolute', top: 0, bottom: 0, right: -(spacing.md + HANDLE) / 2, width: HANDLE, zIndex: 2, alignItems: 'center' }, { cursor: 'col-resize', touchAction: 'none', userSelect: 'none' } as object]}><View style={{ width: 2, height: '100%', backgroundColor: line }} /></View> : null}
              </View>;
            })}
          </View>
          <ScrollView style={{ flex: 1 }}>
            {!rows.length ? <View style={[s.center, { paddingVertical: spacing.xl * 2 }]}><Text style={s.muted}>{t(filtered ? 'tasks.copy.46' : 'tasks.copy.55')}</Text></View> : null}
            {rows.map(item => {
              const picked = !!selection?.ids.includes(item.id);
              return <Pressable key={item.id} testID={`req-row-${item.id}`} accessibilityRole="button" accessibilityLabel={item.name} {...a11yState({ selected: picked })} onPress={e => (selection ? selection.onPress(item.id, e) : onOpen(item.id))} onLongPress={touch ? e => onMenu(item, e.nativeEvent.pageX, e.nativeEvent.pageY) : undefined} style={state => [s.tr, ((state as { hovered?: boolean }).hovered || state.pressed || item.id === selectedId) && s.trHover, picked && { backgroundColor: colors.accent + '14' }]} {...({ dataSet: { taskCard: item.id, taskFrom: item.column } } as object)}>
                {(state: any) => <>
                  {selection ? (
                    // 行首勾选框:悬停 / 已选 / 正在多选时出现;一直留出这一格宽,标题不跳。
                    <View style={{ width: CHECK_W, alignItems: 'center' }}>
                      {state.hovered || picked || selection.ids.length ? (
                        <Pressable accessibilityRole="checkbox" accessibilityLabel={t('taskSel.selectRow', { name: item.name })} {...a11yState({ checked: picked })} onPress={() => selection.onToggle(item.id)} hitSlop={6} testID={`req-row-check-${item.id}`}>
                          <Ionicons name={picked ? 'checkbox' : 'square-outline'} size={16} color={picked ? colors.accent : colors.textMuted} />
                        </Pressable>
                      ) : null}
                    </View>
                  ) : null}
                  {visible.map(f => <View key={f.id} testID={`task-cell-${item.id}-${f.id}`} style={[cellStyle(f), { flexDirection: 'row', alignItems: 'center', overflow: 'hidden' }]}>{content(item, f.id)}</View>)}
                </>}
              </Pressable>;
            })}
          </ScrollView>
        </View>
      </ScrollView>
    </View>
  </View>;
}
