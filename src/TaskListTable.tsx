import { useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { Text } from './ui-text';
import { Ionicons } from './icons';
import { colors, spacing } from './theme';
import { t } from './i18n';
import { useTranslation } from './i18n-react';
import { taskText } from './i18n-tasks';
import './i18n-task-fields';
import { TaskIssueCount } from './TaskIssueBindings';
import { REQ_COLUMN_LABEL, REQ_PRIORITY_LABEL, type Requirement, type RequirementProject } from './requirements-model';
import type { RequirementPerson } from './requirement-people';
import { nextSort, type SortKey, type SortSpec } from './task-board-model';
import { DueChip, OwnerBadge, ParticipantStack, PriorityDot, ProjectChip, STATUS_TONE, a11yState, type TaskStyles } from './TaskBoardParts';
import TaskListFields from './TaskListFields';
import { loadFields, saveFields, type FieldId } from './task-list-fields';

const widths: Record<FieldId, number> = { title: 220, owner: 150, priority: 90, due: 110, participants: 115, project: 116, status: 110, issues: 108 };
export default function TaskListTable({ rows, people, projects, sort, setSort, s, today, selectedId, onOpen, filtered }: {
  rows: Requirement[]; people: RequirementPerson[]; projects: RequirementProject[] | null;
  sort: SortSpec; setSort: (next: SortSpec) => void; s: TaskStyles; today: string;
  selectedId: string | null; onOpen: (id: string) => void; filtered: boolean;
}) {
  useTranslation();
  const [fields, setFields] = useState(loadFields);
  const visible = fields.filter(f => f.visible && (projects || f.id !== 'project'));
  const cellStyle = (id: FieldId) => ({ width: widths[id], minWidth: widths[id], flexShrink: 0, ...(id === 'title' ? { flexGrow: 1 } : {}) });
  const content = (item: Requirement, id: FieldId) => {
    switch (id) {
      case 'title': return <Text style={[s.tdTitle, item.column === 'done' && s.cardDone]} numberOfLines={1}>{item.name}</Text>;
      case 'owner': return <OwnerBadge item={item} people={people} s={s} />;
      case 'priority': return <View style={s.owner}><PriorityDot p={item.priority} s={s} /><Text style={s.metaText}>{taskText(REQ_PRIORITY_LABEL[item.priority])}</Text></View>;
      case 'due': return item.due ? <DueChip item={item} today={today} s={s} /> : <Text style={s.metaMuted}>—</Text>;
      case 'participants': return <ParticipantStack item={item} people={people} s={s} touch={false} size={18} />;
      case 'project': return item.projectId ? <ProjectChip project={projects?.find(p => p.id === item.projectId)} s={s} small /> : <Text style={s.metaMuted}>—</Text>;
      case 'issues': return <TaskIssueCount item={item} />;
      case 'status': return <View style={[s.statusPill, { backgroundColor: STATUS_TONE[item.column]() + '1f' }]}><View style={[s.prioDot, { width: 6, height: 6, backgroundColor: STATUS_TONE[item.column]() }]} /><Text style={[s.statusPillText, { color: STATUS_TONE[item.column]() }]}>{taskText(REQ_COLUMN_LABEL[item.column])}</Text></View>;
    }
  };
  return <View style={{ flex: 1 }}>
    <View style={{ flexDirection: 'row', justifyContent: 'flex-end', paddingHorizontal: spacing.xl, paddingBottom: 10 }}><TaskListFields fields={fields} projects={projects !== null} onChange={next => { saveFields(next); setFields(next); }} /></View>
    <View style={s.table} testID="req-list">
      <ScrollView horizontal contentContainerStyle={{ minWidth: '100%', flexGrow: 1 }}>
        <View style={{ flex: 1, minWidth: visible.reduce((n, f) => n + widths[f.id], 0) + spacing.md * (visible.length - 1) + spacing.lg * 2 }}>
          <View style={s.tableHead}>
            {visible.map(({ id }) => {
              const sortable = id !== 'participants' && id !== 'issues';
              const on = sort.key === id;
              return <View key={id} testID={`task-column-${id}`} style={cellStyle(id)}>{sortable ? <Pressable testID={`req-sort-${id}`} accessibilityRole="button" accessibilityLabel={t('tasks.copy.50', { v0: t(`fields.${id}`) })} {...a11yState({ selected: on })} style={s.th} onPress={() => setSort(nextSort(sort, id as SortKey))}><Text style={[s.thText, on && s.thTextOn]}>{t(`fields.${id}`)}</Text>{on ? <Ionicons name={sort.dir === 'asc' ? 'arrow-up' : 'arrow-down'} size={11} color={colors.text} /> : null}</Pressable> : <Text style={s.thText}>{t(`fields.${id}`)}</Text>}</View>;
            })}
          </View>
          <ScrollView style={{ flex: 1 }}>
            {!rows.length ? <View style={[s.center, { paddingVertical: spacing.xl * 2 }]}><Text style={s.muted}>{t(filtered ? 'tasks.copy.46' : 'tasks.copy.55')}</Text></View> : null}
            {rows.map(item => <Pressable key={item.id} testID={`req-row-${item.id}`} accessibilityRole="button" accessibilityLabel={item.name} onPress={() => onOpen(item.id)} style={state => [s.tr, ((state as { hovered?: boolean }).hovered || state.pressed || item.id === selectedId) && s.trHover]} {...({ dataSet: { taskCard: item.id, taskFrom: item.column } } as object)}>
              {visible.map(({ id }) => <View key={id} testID={`task-cell-${item.id}-${id}`} style={[cellStyle(id), { flexDirection: 'row', alignItems: 'center' }]}>{content(item, id)}</View>)}
            </Pressable>)}
          </ScrollView>
        </View>
      </ScrollView>
    </View>
  </View>;
}
