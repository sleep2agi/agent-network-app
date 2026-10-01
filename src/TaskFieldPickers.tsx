import { t as tr } from './i18n';
import { useTranslation } from './i18n-react';
import { taskText } from './i18n-tasks';
// 任务的「项目」「母任务」两个字段:和负责人 / 负责 Agent 同一种下拉按钮(TaskSelectMenu.SelectField)。
//   · 项目:无项目 + 未归档项目(彩色圆点);当前项目已归档时它也在列表里(标「已归档」),不会悄悄丢掉。
//   · 母任务:同一网络里的任务,可搜索;不含它自己和它的后代(成环),超过 5 层的灰掉;选「无」= 顶层。
//     Hub 没有 parent_id(旧 Hub,生产 .66 升级前)时不给选,只说「升级 Hub 后可用」。
import { View } from 'react-native';
import { Text } from './ui-text';
import { Ionicons } from './icons';
import { colors, spacing } from './theme';
import { REQ_COLUMN_LABEL, type Requirement, type RequirementProject } from './requirements-model';
import { activeProjects, pickableProjects } from './task-board-model';
import { parentCandidates } from './task-select-model';
import { SelectField, type SelectOption } from './TaskSelectMenu';
import { STATUS_TONE, useTaskStyles } from './TaskBoardParts';
import { fieldStyles } from './TaskCreateDialog';

export function projectOptions(projects: readonly RequirementProject[], current: string | null): SelectOption[] {
  const list: SelectOption[] = pickableProjects(projects).map(p => ({ id: p.id, label: p.name, color: p.color }));
  const cur = current ? projects.find(p => p.id === current) : undefined;
  if (cur?.archived) list.push({ id: cur.id, label: tr('tasks.copy.110', { v0: cur.name }), color: cur.color, disabled: true });
  else if (cur && cur.canEdit === false) list.push({ id: cur.id, label: tr('tasks.projectNotEditable', { v0: cur.name }), color: cur.color, disabled: true });
  return list;
}

/** 项目下拉。compact = 列表行里的就地选择。 */
export function ProjectSelect({ value, projects, onChange, touch, idBase, compact = false, label = true, disabled = false }: {
  value: string | null;
  projects: readonly RequirementProject[];
  onChange: (id: string | null) => void;
  touch: boolean;
  idBase: string;
  compact?: boolean;
  /** 上面画不画「项目」标签(列表行里不画)。 */
  label?: boolean;
  disabled?: boolean;
}) {
  useTranslation();
  const s = useTaskStyles();
  const f = fieldStyles();
  const options = projectOptions(projects, value);
  const field = (
    <SelectField
      value={value}
      options={options}
      noneLabel={tr('tasks.copy.31')}
      placeholder={compact ? '—' : tr('tasks.copy.31')}
      onPick={onChange}
      touch={touch}
      title={tr('tasks.copy.30')}
      compact={compact}
      disabled={disabled}
      testID={idBase}
      lead={compact ? null : <Ionicons name="folder-outline" size={16} color={colors.textMuted} />}
    />
  );
  if (!label) return field;
  return (
    <View style={{ gap: spacing.sm }} testID={`${idBase}-field`}>
      <Text style={f.label}>{tr('tasks.copy.30')}</Text>
      {field}
      {!activeProjects(projects).length ? <Text style={s.muted}>{tr('tasks.copy.111')}</Text>
        : !pickableProjects(projects).length ? <Text style={s.muted} testID={`${idBase}-none-editable`}>{tr('tasks.projectNoneEditable')}</Text> : null}
    </View>
  );
}

export function parentOptions(items: readonly Requirement[], item: Requirement): SelectOption[] {
  const byId = new Map(items.map(i => [i.id, i]));
  return parentCandidates(items, item).map(({ task, tooDeep }) => {
    const up = task.parentId ? byId.get(task.parentId) : undefined;
    const status = taskText(REQ_COLUMN_LABEL[task.column]);
    return {
      id: task.id,
      label: tooDeep ? tr('taskSel.parentTooDeep', { name: task.name }) : task.name,
      sub: up ? `${status} · ${tr('taskSel.parentOf', { name: up.name })}` : status,
      color: STATUS_TONE[task.column](),
      disabled: tooDeep,
      keywords: task.externalRef ?? '',
    };
  });
}

/**
 * 母任务。supported = Hub 行里带 parent_id;不支持时只显示一行说明。
 * error = Hub 拒绝(成环 / 超过 5 层 / 不存在)时的原因,就地显示。
 */
export function ParentSelect({ item, items, value, onChange, touch, idBase, error }: {
  item: Requirement;
  items: readonly Requirement[];
  value: string | null;
  onChange: (id: string | null) => void;
  touch: boolean;
  idBase: string;
  error?: string;
}) {
  useTranslation();
  const s = useTaskStyles();
  const f = fieldStyles();
  const supported = item.parentId !== undefined;
  return (
    <View style={{ gap: spacing.sm }} testID={`${idBase}-field`}>
      <Text style={f.label}>{tr('taskSel.parent')}</Text>
      {supported ? (
        <SelectField
          value={value}
          options={parentOptions(items, item)}
          noneLabel={tr('taskSel.parentNone')}
          placeholder={tr('taskSel.parentNone')}
          onPick={onChange}
          touch={touch}
          title={tr('taskSel.parent')}
          searchable
          testID={idBase}
          lead={<Ionicons name="git-branch-outline" size={16} color={colors.textMuted} />}
        />
      ) : <Text style={s.muted} testID={`${idBase}-upgrade`}>{tr('taskSel.parentUpgrade')}</Text>}
      {supported && error ? <Text style={s.err} accessibilityRole="alert" testID={`${idBase}-error`}>{error}</Text> : null}
    </View>
  );
}

/** 卡片 / 列表行上的「↳ 母任务名」:母任务在当前列表里才画(归档或被筛掉了就不画,免得一行空名字)。 */
export function ParentLine({ item, items }: { item: Requirement; items: readonly Requirement[] }) {
  useTranslation();
  const s = useTaskStyles();
  if (!item.parentId) return null;
  const parent = items.find(i => i.id === item.parentId);
  if (!parent) return null;
  return (
    <Text style={[s.metaMuted, { fontSize: 11 }]} numberOfLines={1} testID="task-card-parent" accessibilityLabel={tr('taskSel.parentOfA11y', { name: parent.name })}>
      {tr('taskSel.parentOf', { name: parent.name })}
    </Text>
  );
}
