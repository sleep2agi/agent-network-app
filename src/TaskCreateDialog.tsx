import { personName } from './i18n-task-presentation';
import { t as tr } from './i18n';
import { validationText } from './i18n-task-presentation';
import { useTranslation } from './i18n-react';
import { taskText } from './i18n-tasks';
// 新建任务:桌面是居中的小对话框,手机是从底部升起的面板。字段:标题(自动聚焦)、负责人(头像选择器,
// 复用 RequirementPeoplePicker —— 只存稳定身份 {kind,id})、优先级、预计完成。
import { useState, type ReactNode } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Text, TextInput } from './ui-text';
import { Ionicons } from './icons';
import AliasAvatar from './AliasAvatar';
import RequirementPeoplePicker from './RequirementPeoplePicker';
import TaskDuePicker from './TaskDuePicker';
import { useModalSafePadding } from './safe-area-runtime';
import { withBasePadding } from './modal-safe-area';
import { colors, radius, spacing, themeMode, type as typeScale, weight } from './theme';
import { REQ_COLUMN_LABEL, REQ_PRIORITIES, REQ_PRIORITY_LABEL, type ReqPriority, type RequirementProject } from './requirements-model';
import type { RequirementPerson, RequirementPersonRef } from './requirement-people';
import { activeProjects, checkDraft, createInput, roleKinds, type CreateDraft } from './task-board-model';
import { BOARD_RADIUS, CONTROL_H, liftedShadow, PriorityDot, useTaskStyles, a11yState } from './TaskBoardParts';

export { dueShortcuts } from './due-time';

export function PriorityPicker({ value, onChange, testPrefix }: { value: ReqPriority; onChange: (p: ReqPriority) => void; testPrefix: string }) {
  useTranslation();
  const s = useTaskStyles();
  return (
    <View style={[s.segment, { alignSelf: 'flex-start' }]} accessibilityRole="radiogroup">
      {REQ_PRIORITIES.map(p => {
        const on = p === value;
        return (
          <Pressable key={p} accessibilityRole="radio" {...a11yState({ checked: on })} onPress={() => onChange(p)} style={[s.segmentItem, { flexDirection: 'row', gap: 6 }, on && s.segmentItemOn]} testID={`${testPrefix}-${p}`}>
            <PriorityDot p={p} s={s} />
            <Text style={[s.segmentText, on && s.segmentTextOn]}>{taskText(REQ_PRIORITY_LABEL[p])}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** 预计完成:月历选择器(桌面弹层 / 手机底部面板)+ 快捷项。allowTime = Hub 能存到秒。 */
export function DueField({ value, onChange, error, idBase, allowTime = false, pointer = false, sheet = false }: {
  value: string; onChange: (v: string) => void; error?: string; idBase: string; allowTime?: boolean; pointer?: boolean; sheet?: boolean;
}) {
  useTranslation();
  return <TaskDuePicker value={value} onChange={onChange} error={error} idBase={idBase} allowTime={allowTime} pointer={pointer} sheet={sheet} />;
}

export function OwnerField({ value, people, onPress, disabled, loading, idBase, role = 'any' }: {
  value: RequirementPersonRef | null; people: readonly RequirementPerson[]; onPress: () => void; disabled?: boolean; loading?: boolean; idBase: string;
  /** 'human' = 负责人(只能人类),'agent' = 负责 Agent,'any' = 旧 Hub 的单一负责人。 */
  role?: 'human' | 'agent' | 'any';
}) {
  useTranslation();
  const testID = idBase;
  const f = fieldStyles();
  const name = value ? personName(value, people) : '';
  return (
    <Pressable testID={testID} accessibilityRole="button" accessibilityLabel={value ? tr('tasks.copy.99', { v0: role === 'agent' ? tr('tasks.copy.82') : tr('tasks.copy.15'), v1: name }) : role === 'agent' ? tr('tasks.copy.100') : tr('tasks.copy.65')} disabled={disabled} onPress={onPress} style={[f.input, f.row]}>
      {value ? <AliasAvatar alias={name} size={22} /> : <Ionicons name={role === 'agent' ? 'hardware-chip-outline' : 'person-add-outline'} size={16} color={colors.textMuted} />}
      <Text style={{ flex: 1, color: value ? colors.text : colors.textMuted, fontSize: typeScale.body }} numberOfLines={1}>
        {loading ? tr('tasks.copy.101') : value ? `${name}（${value.kind === 'user' ? tr('tasks.copy.1') : 'Agent'}）`
          : role === 'human' ? tr('tasks.copy.102') : role === 'agent' ? tr('tasks.copy.103') : tr('tasks.copy.104')}
      </Text>
      <Ionicons name="chevron-down" size={14} color={colors.textMuted} />
    </Pressable>
  );
}

export const fieldStyles = () => StyleSheet.create({
  label: { color: colors.textSecondary, fontSize: typeScale.small, fontWeight: weight.medium },
  input: { minHeight: 40, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: BOARD_RADIUS.control, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.inputBg, color: colors.text, fontSize: typeScale.body },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
});

/**
 * 负责人 / 负责 Agent 两个选择器(分两个角色的 Hub),或旧 Hub 的单一负责人。
 * 负责人只列人类、负责 Agent 只列节点(RequirementPeoplePicker 的 kinds 过滤);存的永远是 {kind,id}。
 */
export function RoleFields({ twoRoles, owner, agentOwner, people, peopleLoading, peopleError, networkId, onLoadPeople, onChange, idBase, ownerLocked }: {
  twoRoles: boolean;
  owner: RequirementPersonRef | null;
  agentOwner: RequirementPersonRef | null;
  people: readonly RequirementPerson[];
  peopleLoading: boolean;
  peopleError?: string;
  networkId: string;
  onLoadPeople: () => Promise<boolean>;
  onChange: (patch: { owner?: RequirementPersonRef | null; agentOwner?: RequirementPersonRef | null }) => void;
  /** 负责人的 testID 前缀(新建 = req-assignee,详情 = req-edit-owner);负责 Agent = 前缀 + '-agent'。 */
  idBase: string;
  /** 旧 Hub 的旧卡(没有稳定负责人):负责人一栏只读,由调用方自己画。 */
  ownerLocked?: ReactNode;
}) {
  useTranslation();
  const s = useTaskStyles();
  const f = fieldStyles();
  const [picker, setPicker] = useState<'owner' | 'agent' | null>(null);
  const open = async (role: 'owner' | 'agent') => { if (await onLoadPeople()) setPicker(role); };
  const kinds = picker ? roleKinds(picker, twoRoles) : undefined;
  return (
    <>
      <View style={{ gap: spacing.sm }}>
        <Text style={f.label}>{tr('tasks.copy.15')}</Text>
        {ownerLocked ?? <OwnerField value={owner} people={people} role={twoRoles ? 'human' : 'any'} onPress={() => { void open('owner'); }} loading={peopleLoading} disabled={peopleLoading} idBase={idBase} />}
        {twoRoles ? <Text style={s.muted}>{tr('tasks.copy.105')}</Text> : null}
      </View>
      {twoRoles ? (
        <View style={{ gap: spacing.sm }}>
          <Text style={f.label}>{tr('tasks.copy.82')}</Text>
          <OwnerField value={agentOwner} people={people} role="agent" onPress={() => { void open('agent'); }} loading={peopleLoading} disabled={peopleLoading} idBase={`${idBase}-agent`} />
          <Text style={s.muted}>{tr('tasks.copy.106')}</Text>
        </View>
      ) : null}
      {peopleError ? <Text style={s.err} testID="req-people-error">{peopleError}{tr('tasks.copy.107')}</Text> : null}
      {picker ? (
        <RequirementPeoplePicker
          networkId={networkId}
          mode="owner"
          kinds={kinds}
          title={picker === 'agent' ? tr('tasks.copy.100') : tr('tasks.copy.65')}
          hint={picker === 'agent' ? tr('tasks.copy.108') : twoRoles ? tr('tasks.copy.109') : undefined}
          people={people}
          selected={picker === 'agent' ? (agentOwner ? [agentOwner] : []) : owner ? [owner] : []}
          onClose={() => setPicker(null)}
          onConfirm={sel => { onChange(picker === 'agent' ? { agentOwner: sel[0] || null } : { owner: sel[0] || null }); setPicker(null); }}
        />
      ) : null}
    </>
  );
}

/** 项目:无项目 + 各个未归档项目(彩色圆点)。一排可换行的胶囊,单选。 */
export function ProjectPicker({ value, projects, onChange, idBase }: { value: string | null; projects: readonly RequirementProject[]; onChange: (id: string | null) => void; idBase: string }) {
  useTranslation();
  const s = useTaskStyles();
  const f = fieldStyles();
  const list = activeProjects(projects);
  const archivedCurrent = value ? projects.find(p => p.id === value && p.archived) : undefined;
  const chip = (id: string | null, label: string, color?: string) => {
    const on = (value ?? null) === id;
    return (
      <Pressable key={id ?? 'none'} accessibilityRole="radio" {...a11yState({ checked: on })} onPress={() => onChange(id)} style={[s.chip, { height: 30 }, on && s.chipOn]} testID={`${idBase}-${id ?? 'none'}`}>
        {color ? <View style={{ width: 8, height: 8, borderRadius: radius.pill, backgroundColor: color }} /> : null}
        <Text style={[s.chipText, on && s.chipTextOn]} numberOfLines={1}>{label}</Text>
      </Pressable>
    );
  };
  return (
    <View style={{ gap: spacing.sm }}>
      <Text style={f.label}>{tr('tasks.copy.30')}</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }} accessibilityRole="radiogroup">
        {chip(null, tr('tasks.copy.31'))}
        {list.map(p => chip(p.id, p.name, p.color))}
        {archivedCurrent ? chip(archivedCurrent.id, tr('tasks.copy.110', { v0: archivedCurrent.name }), archivedCurrent.color) : null}
      </View>
      {!list.length ? <Text style={s.muted}>{tr('tasks.copy.111')}</Text> : null}
    </View>
  );
}

export default function TaskCreateDialog({ draft, sheet, twoRoles, parentName, projects, dueDatetime, pointer, networkId, people, peopleLoading, peopleError, onLoadPeople, onChange, onSubmit, onClose }: {
  draft: CreateDraft | null;
  /** Hub 分不分「负责人(人类)/ 负责 Agent」。不分就是旧的单一负责人。 */
  twoRoles: boolean;
  /** 项目列表;null = Hub 没有项目,不显示。 */
  projects: readonly RequirementProject[] | null;
  /** 建子需求时父需求的名字(显示「属于:…」)。 */
  parentName?: string | null;
  /** Hub 能把预计完成存到秒(capabilities.due_datetime)。 */
  dueDatetime: boolean;
  pointer: boolean;
  /** true = 手机底部面板;false = 居中对话框。 */
  sheet: boolean;
  networkId: string;
  people: readonly RequirementPerson[];
  peopleLoading: boolean;
  peopleError: string;
  onLoadPeople: () => Promise<boolean>;
  onChange: (d: CreateDraft) => void;
  onSubmit: () => Promise<string | null>;
  onClose: () => void;
}) {
  useTranslation();
  const s = useTaskStyles();
  const f = fieldStyles();
  const safe = useModalSafePadding(sheet ? 'fullScreen' : 'overlay');
  const [error, setError] = useState<{ field: 'name' | 'due' | 'submit'; message: string } | null>(null);
  const [saving, setSaving] = useState(false);
  if (!draft) return null;
  const submit = async () => {
    if (saving) return;
    const c = checkDraft(draft);
    if (!c.ok) { setError({ field: c.field, message: validationText(c.message) }); return; }
    if (!createInput(draft, twoRoles)) return;
    setSaving(true);
    setError(null);
    const failed = await onSubmit();
    setSaving(false);
    if (failed) setError({ field: 'submit', message: failed });
  };
  const set = (patch: Partial<CreateDraft>) => { onChange({ ...draft, ...patch }); if (error && error.field !== 'submit') setError(null); };
  const panel = {
    backgroundColor: colors.card,
    gap: spacing.lg,
    padding: spacing.xl,
    ...(sheet
      ? { borderTopLeftRadius: BOARD_RADIUS.card, borderTopRightRadius: BOARD_RADIUS.card, paddingBottom: spacing.xl + safe.paddingBottom }
      : { width: '100%' as const, maxWidth: 480, borderRadius: BOARD_RADIUS.card, borderWidth: themeMode() === 'dark' ? 1 : 0, borderColor: colors.border }),
    ...liftedShadow(),
  };
  return (
    <Modal visible transparent animationType={sheet ? 'slide' : 'fade'} onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <View style={[{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)' }, sheet ? { justifyContent: 'flex-end' } : [{ alignItems: 'center', justifyContent: 'center' }, withBasePadding(safe, spacing.lg)]]}>
          <Pressable accessibilityLabel={tr('tasks.copy.112')} onPress={onClose} style={StyleSheet.absoluteFill} testID="req-create-backdrop" />
          <View style={panel} accessibilityViewIsModal testID="req-create">
            <View style={[f.row, { justifyContent: 'space-between' }]}>
              <Text style={{ color: colors.text, fontSize: typeScale.title + 1, fontWeight: weight.strong }}>{draft.parentId ? tr('tasks.copy.113') : tr('tasks.copy.39')}</Text>
              <Pressable accessibilityRole="button" accessibilityLabel={tr('tasks.copy.114')} onPress={onClose} style={s.iconButton} testID="req-create-close">
                <Ionicons name="close" size={18} color={colors.textSecondary} />
              </Pressable>
            </View>
            <ScrollView keyboardShouldPersistTaps="handled" style={{ flexGrow: 0 }} contentContainerStyle={{ gap: spacing.lg }}>
              {draft.parentId ? (
                <View style={[f.row, { gap: 6 }]} testID="req-create-parent">
                  <Ionicons name="git-branch-outline" size={13} color={colors.textMuted} />
                  <Text style={s.muted} numberOfLines={1}>{tr('tasks.copy.115')}{parentName || tr('tasks.copy.116')}</Text>
                </View>
              ) : null}
              <TextInput
                autoFocus
                value={draft.name}
                onChangeText={name => set({ name })}
                onSubmitEditing={() => { void submit(); }}
                placeholder={tr('tasks.copy.117')}
                placeholderTextColor={colors.textMuted}
                style={[f.input, { fontSize: typeScale.title, minHeight: 44 }, error?.field === 'name' ? { borderColor: colors.failed } : null]}
                testID="req-name"
                accessibilityLabel={tr('tasks.copy.118')}
                maxLength={120}
              />
              {error?.field === 'name' ? <Text style={s.err} accessibilityRole="alert" testID="req-error">{error.message}</Text> : null}
              <RoleFields
                twoRoles={twoRoles}
                owner={draft.owner}
                agentOwner={draft.agentOwner}
                people={people}
                peopleLoading={peopleLoading}
                peopleError={peopleError}
                networkId={networkId}
                onLoadPeople={onLoadPeople}
                onChange={set}
                idBase="req-assignee"
              />
              {projects ? <ProjectPicker value={draft.projectId} projects={projects} onChange={projectId => set({ projectId })} idBase="req-project" /> : null}
              <View style={{ gap: spacing.sm }}>
                <Text style={f.label}>{tr('tasks.copy.32')}</Text>
                <PriorityPicker value={draft.priority} onChange={priority => set({ priority })} testPrefix="req-priority" />
              </View>
              <View style={{ gap: spacing.sm }}>
                <Text style={f.label}>{tr('tasks.copy.119')}</Text>
                <DueField value={draft.due} onChange={due => set({ due })} error={error?.field === 'due' ? error.message : undefined} idBase="req-due" allowTime={dueDatetime} pointer={pointer} sheet={sheet} />
              </View>
            </ScrollView>
            {error?.field === 'submit' ? <Text style={s.err} accessibilityRole="alert" testID="req-error">{error.message}</Text> : null}
            <View style={[f.row, { justifyContent: 'space-between' }]}>
              <Text style={s.muted}>{tr('tasks.addTo', { column: taskText(REQ_COLUMN_LABEL[draft.column]) })}</Text>
              <View style={[f.row, { gap: spacing.sm }]}>
                <Pressable accessibilityRole="button" onPress={onClose} style={[s.primary, { backgroundColor: colors.subtleFill }]} testID="req-create-cancel">
                  <Text style={[s.primaryText, { color: colors.text }]}>{tr('tasks.copy.79')}</Text>
                </Pressable>
                <Pressable accessibilityRole="button" {...a11yState({ disabled: saving || !draft.name.trim() })} disabled={saving} onPress={() => { void submit(); }} style={[s.primary, { minWidth: 72, justifyContent: 'center', height: CONTROL_H + 4 }, (saving || !draft.name.trim()) && { opacity: 0.5 }]} testID="req-add">
                  <Text style={s.primaryText}>{saving ? tr('tasks.copy.121') : tr('tasks.copy.122')}</Text>
                </Pressable>
              </View>
            </View>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
