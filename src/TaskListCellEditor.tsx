import { t as tr } from './i18n';
import { useTranslation } from './i18n-react';
import { taskText } from './i18n-tasks';
import './i18n-task-fields';
import './i18n-task-tags';
// 列表视图里一格的编辑器(多维表格式就地编辑,只在桌面宽屏表格上;TaskListTable 管选中 / 键盘,这里只画打开后的那一块)。
//   · 优先级 / 状态 / 项目:就是详情里那个下拉浮层(TaskSelectMenu.SelectMenu),锚在格子下面。
//   · 期限:详情里那个月历(TaskDuePicker 的贴格子模式),快捷项 今天 / 明天 / 下周一 + 清除 在面板里。
//   · 负责人 / 参与人 / 标签:同一种浮层,顶上是当前值的胶囊(× 去掉),下面搜索 + 选项(✓ = 已选);
//     标签搜不到时回车 / 点「创建」新建。点一下就保存,浮层不关,Esc / 点外面关。
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Modal, Platform, Pressable, ScrollView, View, useWindowDimensions } from 'react-native';
import { Text, TextInput } from './ui-text';
import { Ionicons } from './icons';
import { colors, radius, spacing } from './theme';
import { elevated } from './elevation';
import { useModalSafePadding } from './safe-area-runtime';
import AliasAvatar from './AliasAvatar';
import { Dot, SelectMenu } from './TaskSelectMenu';
import { PriorityDot, STATUS_TONE, a11yState, useTaskStyles } from './TaskBoardParts';
import { projectOptions } from './TaskFieldPickers';
import TaskDuePicker from './TaskDuePicker';
import { anchorSelectMenu, filterSelectOptions, type SelectAnchor, type SelectOption } from './task-select-model';
import { priorityChoices, priorityLabel } from './task-priority';
import { REQ_COLUMNS, REQ_COLUMN_LABEL, type Requirement, type RequirementProject } from './requirements-model';
import { peopleInNetwork, personKey, type RequirementPerson, type RequirementPersonRef } from './requirement-people';
import { pickOwner, tagAddable, toggleParticipant, toggleTag, type CellEdit } from './task-list-edit-model';

export type CellEditorField = 'owner' | 'priority' | 'due' | 'participants' | 'project' | 'status' | 'tags';

export type CellEditorContext = {
  people: readonly RequirementPerson[];
  peopleLoading: boolean;
  projects: readonly RequirementProject[] | null;
  networkId: string;
  twoRoles: boolean;
  lowestPriority: boolean;
  allowTime: boolean;
  tagChoices: readonly string[];
  tagColors?: Readonly<Record<string, string>>;
};

export function CellEditor({ item, field, anchor, ctx, onEdit, onClose }: {
  item: Requirement;
  field: CellEditorField;
  anchor: SelectAnchor;
  ctx: CellEditorContext;
  onEdit: (edit: CellEdit) => void;
  onClose: () => void;
}) {
  useTranslation();
  const s = useTaskStyles();
  const id = `list-edit-${field}`;
  switch (field) {
    case 'priority':
      return <SelectMenu anchor={anchor} touch={false} title={tr('fields.priority')} searchable={false} selected={item.priority} testID={id} onClose={onClose}
        options={priorityChoices(ctx.lowestPriority, item.priority).map(p => ({ id: p, label: priorityLabel(p), lead: <PriorityDot p={p} s={s} /> }))}
        onPick={p => { if (p) onEdit({ field: 'priority', priority: p as Requirement['priority'] }); onClose(); }} />;
    case 'status':
      return <SelectMenu anchor={anchor} touch={false} title={tr('fields.status')} searchable={false} selected={item.column} testID={id} onClose={onClose}
        options={REQ_COLUMNS.map(c => ({ id: c, label: taskText(REQ_COLUMN_LABEL[c]), color: STATUS_TONE[c]() }))}
        onPick={c => { if (c) onEdit({ field: 'status', column: c as Requirement['column'] }); onClose(); }} />;
    case 'project':
      return <SelectMenu anchor={anchor} touch={false} title={tr('tasks.copy.30')} searchable selected={item.projectId ?? null} testID={id} onClose={onClose}
        options={projectOptions(ctx.projects ?? [], item.projectId ?? null)} noneLabel={tr('tasks.copy.31')}
        onPick={pid => { onEdit({ field: 'project', projectId: pid }); onClose(); }} />;
    case 'due':
      return <TaskDuePicker value={item.due} anchorAt={anchor} onDismiss={onClose} onChange={due => onEdit({ field: 'due', due })} allowTime={ctx.allowTime} pointer sheet={false} idBase={id} />;
    case 'owner': case 'participants': return <PeopleEditor item={item} field={field} anchor={anchor} ctx={ctx} onEdit={onEdit} onClose={onClose} />;
    case 'tags': return <TagEditor item={item} anchor={anchor} ctx={ctx} onEdit={onEdit} onClose={onClose} />;
  }
}

function PeopleEditor({ item, field, anchor, ctx, onEdit, onClose }: { item: Requirement; field: 'owner' | 'participants'; anchor: SelectAnchor; ctx: CellEditorContext; onEdit: (edit: CellEdit) => void; onClose: () => void }) {
  useTranslation();
  const people = peopleInNetwork(ctx.people, ctx.networkId);
  const nameOf = (ref: RequirementPersonRef) => people.find(p => personKey(p) === personKey(ref))?.name || ref.id;
  const chosen: RequirementPersonRef[] = field === 'participants' ? item.participants ?? []
    : [item.owner, ctx.twoRoles ? item.agentOwner : null].filter((r): r is RequirementPersonRef => !!r);
  const on = new Set(chosen.map(personKey));
  const option = (p: RequirementPerson): PickOption => ({
    id: personKey(p), label: p.name || p.id, sub: `${p.kind === 'user' ? tr('tasks.copy.1') : 'Agent'} · ${p.id}${p.unavailable ? tr('tasks.copy.73') : ''}`,
    lead: <AliasAvatar alias={p.name || p.id} size={20} />, checked: on.has(personKey(p)), disabled: !!p.unavailable && !on.has(personKey(p)),
  });
  // 分两个角色的 Hub:负责人只列人类、负责 Agent 只列 Agent,两段;旧 Hub 一个负责人,人和 Agent 一起列。
  const groups: PickGroup[] = field === 'owner' && ctx.twoRoles
    ? [{ title: tr('tasks.copy.15'), options: people.filter(p => p.kind === 'user').map(option) }, { title: tr('tasks.copy.82'), options: people.filter(p => p.kind === 'node').map(option) }]
    : [{ options: people.map(option) }];
  const toggle = (key: string) => {
    const p = people.find(x => personKey(x) === key) ?? chosen.find(x => personKey(x) === key);
    if (!p) return;
    onEdit(field === 'participants' ? toggleParticipant(item, p) : pickOwner(item, p, ctx.twoRoles));
  };
  return <ChipPicker anchor={anchor} testID={`list-edit-${field}`} title={tr(`fields.${field}`)} search={tr('listEdit.searchPeople')}
    chips={chosen.map(r => ({ key: personKey(r), label: nameOf(r), lead: <AliasAvatar alias={nameOf(r)} size={16} /> }))}
    groups={groups} onToggle={toggle} onClose={onClose}
    empty={ctx.peopleLoading ? tr('tasks.copy.101') : tr('tasks.copy.77')} />;
}

function TagEditor({ item, anchor, ctx, onEdit, onClose }: { item: Requirement; anchor: SelectAnchor; ctx: CellEditorContext; onEdit: (edit: CellEdit) => void; onClose: () => void }) {
  useTranslation();
  const tags = item.tags ?? [];
  const [error, setError] = useState(false);
  const all = [...new Set([...tags, ...ctx.tagChoices])];
  const toggle = (tag: string) => {
    if (!tags.includes(tag) && !tagAddable(item, tag)) { setError(true); return; }
    setError(false);
    onEdit(toggleTag(item, tag));
  };
  return <ChipPicker anchor={anchor} testID="list-edit-tags" title={tr('fields.tags')} search={tr('listEdit.searchTags')}
    chips={tags.map(tag => ({ key: tag, label: tag, color: ctx.tagColors?.[tag] }))}
    groups={[{ options: all.map(tag => ({ id: tag, label: tag, color: ctx.tagColors?.[tag] ?? null, checked: tags.includes(tag) })) }]}
    onToggle={toggle} onCreate={toggle} onClose={onClose} error={error ? tr('tags.invalid') : ''} empty="" />;
}

type PickOption = SelectOption & { checked: boolean };
type PickGroup = { title?: string; options: PickOption[] };

/** 胶囊 + 搜索 + 选项的浮层(多维表格的人员 / 多选格编辑器)。键盘:↑↓ 走、回车选 / 建、退格删最后一个胶囊、Esc 关。 */
function ChipPicker({ anchor, testID, title, search, chips, groups, onToggle, onCreate, onClose, empty, error = '' }: {
  anchor: SelectAnchor; testID: string; title: string; search: string;
  chips: { key: string; label: string; lead?: ReactNode; color?: string }[];
  groups: PickGroup[];
  onToggle: (id: string) => void;
  /** 有这个 = 搜不到时可以新建(标签)。 */
  onCreate?: (text: string) => void;
  onClose: () => void;
  empty: string;
  error?: string;
}) {
  useTranslation();
  const s = useTaskStyles();
  const win = useWindowDimensions();
  const safe = useModalSafePadding('fullScreen');
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const shown = useMemo(() => groups.map(g => ({ ...g, options: filterSelectOptions(g.options, query) as PickOption[] })), [groups, query]);
  const flat = shown.flatMap(g => g.options);
  const q = query.trim();
  const creatable = !!onCreate && !!q && !groups.some(g => g.options.some(o => o.label === q));
  const rows = flat.length + (creatable ? 1 : 0);
  const choose = (i: number) => {
    if (i < flat.length) { const o = flat[i]; if (!o.disabled) onToggle(o.id); return; }
    if (creatable) { onCreate!(q); setQuery(''); setActive(0); }
  };
  const keys = useRef({ rows, active, choose, onClose, chips, onToggle, query });
  keys.current = { rows, active, choose, onClose, chips, onToggle, query };
  useEffect(() => {
    const doc = (globalThis as any).document;
    if (!doc?.addEventListener) return;
    const onKey = (e: any) => {
      const k = keys.current;
      if (e.isComposing) return;
      if (e.key === 'ArrowDown') { e.preventDefault(); setActive(i => Math.min(k.rows - 1, i + 1)); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(i => Math.max(0, i - 1)); }
      else if (e.key === 'Enter') { e.preventDefault(); k.choose(k.active); }
      else if (e.key === 'Backspace' && !k.query && k.chips.length) { e.preventDefault(); k.onToggle(k.chips[k.chips.length - 1].key); }
      else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); k.onClose(); }
    };
    doc.addEventListener('keydown', onKey, true);
    return () => doc.removeEventListener('keydown', onKey, true);
  }, []);
  const rowH = 34;
  const headers = shown.filter(g => g.title).length;
  const pos = anchorSelectMenu(anchor, { width: win.width, height: win.height }, { rows: Math.max(1, rows) + headers + 1 + Math.ceil(chips.length / 3), rowH, search: true });
  let index = -1;
  const line = (o: PickOption) => {
    const i = ++index;
    return (
      <Pressable key={o.id} testID={`${testID}-opt-${o.id}`} accessibilityRole="menuitem" {...a11yState({ selected: o.checked, disabled: !!o.disabled })} disabled={o.disabled}
        onPress={() => choose(i)} onHoverIn={() => setActive(i)}
        style={state => ({ minHeight: rowH, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: spacing.md, borderRadius: radius.item, opacity: o.disabled ? 0.45 : 1,
          backgroundColor: (state as { hovered?: boolean }).hovered || state.pressed || i === active ? colors.rowHover : 'transparent' })}>
        {o.lead ?? <Dot color={o.color} />}
        <View style={{ flex: 1, minWidth: 0, paddingVertical: 4 }}>
          <Text style={{ color: colors.text, fontSize: 13 }} numberOfLines={1}>{o.label}</Text>
          {o.sub ? <Text style={s.metaMuted} numberOfLines={1}>{o.sub}</Text> : null}
        </View>
        {o.checked ? <Ionicons name="checkmark" size={16} color={colors.accent} /> : null}
      </Pressable>
    );
  };
  return (
    <Modal visible transparent animationType="none" onRequestClose={onClose}>
      <Pressable style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0 }} onPress={onClose} accessibilityLabel={tr('taskSel.close')} testID={`${testID}-scrim`} />
      <View style={{ position: 'absolute', left: Math.max(pos.left, safe.paddingLeft + 8), top: Math.max(pos.top, safe.paddingTop + 8), width: pos.width, maxHeight: pos.maxHeight, padding: 6, borderRadius: radius.control, backgroundColor: colors.card, ...elevated('floating') }}
        testID={testID} accessibilityRole="menu" accessibilityLabel={title}>
        {/* 当前值 + 搜索框在同一个框里(多维表格的样子):胶囊 × 去掉,后面接着打字搜索。 */}
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 4, minHeight: 34, paddingHorizontal: 6, paddingVertical: 4, marginBottom: 4, borderRadius: radius.control, borderWidth: 1, borderColor: colors.accent, backgroundColor: colors.inputBg }} testID={`${testID}-chips`}>
          {chips.map(c => (
            <View key={c.key} style={{ flexDirection: 'row', alignItems: 'center', gap: 4, maxWidth: '100%', height: 24, paddingLeft: c.lead ? 3 : 8, paddingRight: 2, borderRadius: radius.control, backgroundColor: colors.subtleFill }} testID={`${testID}-chip-${c.key}`}>
              {c.lead ?? (c.color ? <Dot color={c.color} size={6} /> : null)}
              <Text style={{ color: colors.text, fontSize: 12, flexShrink: 1 }} numberOfLines={1}>{c.label}</Text>
              <Pressable accessibilityRole="button" accessibilityLabel={tr('listEdit.remove', { name: c.label })} onPress={() => onToggle(c.key)} hitSlop={4} testID={`${testID}-chip-x-${c.key}`} style={{ width: 18, height: 18, alignItems: 'center', justifyContent: 'center' }}>
                <Ionicons name="close" size={12} color={colors.textMuted} />
              </Pressable>
            </View>
          ))}
          <TextInput autoFocus value={query} onChangeText={v => { setQuery(v); setActive(0); }} placeholder={chips.length ? '' : search} placeholderTextColor={colors.textMuted}
            style={{ flex: 1, minWidth: 80, height: 24, color: colors.text, fontSize: 13, ...(Platform.OS === 'web' ? { outlineStyle: 'none' } : null) } as object}
            accessibilityLabel={search} testID={`${testID}-search`} />
        </View>
        <ScrollView style={{ flexGrow: 0 }} keyboardShouldPersistTaps="handled">
          {shown.map((g, gi) => (
            <View key={g.title ?? gi}>
              {g.title ? <Text style={[s.metaMuted, { paddingHorizontal: spacing.md, paddingTop: gi ? 8 : 2, paddingBottom: 2, fontSize: 11 }]} testID={`${testID}-group-${gi}`}>{g.title}</Text> : null}
              {g.options.map(line)}
            </View>
          ))}
          {creatable ? (
            <Pressable testID={`${testID}-create`} accessibilityRole="menuitem" onPress={() => choose(flat.length)} onHoverIn={() => setActive(flat.length)}
              style={state => ({ minHeight: rowH, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: spacing.md, borderRadius: radius.item, backgroundColor: (state as { hovered?: boolean }).hovered || active === flat.length ? colors.rowHover : 'transparent' })}>
              <Ionicons name="add" size={14} color={colors.accent} />
              <Text style={{ color: colors.accent, fontSize: 13, flex: 1 }} numberOfLines={1}>{tr('listEdit.create', { tag: q })}</Text>
            </Pressable>
          ) : null}
          {!rows && empty ? <Text style={[s.muted, { padding: spacing.md }]}>{q ? tr('taskSel.noMatch') : empty}</Text> : null}
        </ScrollView>
        {error ? <Text style={[s.err, { paddingHorizontal: spacing.md, paddingTop: 4 }]} accessibilityRole="alert" testID={`${testID}-error`}>{error}</Text> : null}
      </View>
    </Modal>
  );
}
