import { personName } from './i18n-task-presentation';
import { t as tr } from './i18n';
import { validationText } from './i18n-task-presentation';
import { useTranslation } from './i18n-react';
import { taskText } from './i18n-tasks';
// 新建任务:桌面是居中的小对话框,手机是从底部升起的面板。字段:标题(自动聚焦)、负责人(头像选择器,
// 复用 RequirementPeoplePicker —— 只存稳定身份 {kind,id})、参与人(同一个选择器多选,只列人类)、优先级、预计完成。
import { useState, type ReactNode } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import ModalKeyboardAvoider from './ModalKeyboardAvoider';
import { Text, TextInput } from './ui-text';
import { Ionicons } from './icons';
import AliasAvatar from './AliasAvatar';
import RequirementPeoplePicker from './RequirementPeoplePicker';
import TaskDuePicker from './TaskDuePicker';
import { useModalSafePadding } from './safe-area-runtime';
import { withBasePadding } from './modal-safe-area';
import { colors, radius, spacing, themeMode, type as typeScale, weight } from './theme';
import { personKey } from './requirement-people';
import { REQ_COLUMN_LABEL, type ReqPriority, type RequirementProject } from './requirements-model';
import { priorityLabel } from './task-priority';
import type { RequirementPerson, RequirementPersonRef } from './requirement-people';
import { activeProjects, checkDraft, createInput, roleKinds, type CreateDraft } from './task-board-model';
import { BOARD_RADIUS, CONTROL_H, liftedShadow, PriorityDot, useTaskStyles, a11yState } from './TaskBoardParts';
import './i18n-task-tags';
import { ProjectSelect } from './TaskFieldPickers';
import { TagInputField, useTagChoices } from './TaskTags';
import { normalizeTags } from './requirement-tags';

export { dueShortcuts } from './due-time';

/** choices:Hub 收得下的几档(task-priority.ts priorityChoices);旧 Hub 没有 P3。 */
export function PriorityPicker({ value, onChange, testPrefix, choices }: { value: ReqPriority; onChange: (p: ReqPriority) => void; testPrefix: string; choices: readonly ReqPriority[] }) {
  useTranslation();
  const s = useTaskStyles();
  return (
    <View style={[s.segment, { alignSelf: 'flex-start', flexWrap: 'wrap' }]} accessibilityRole="radiogroup">
      {choices.map(p => {
        const on = p === value;
        return (
          <Pressable key={p} accessibilityRole="radio" {...a11yState({ checked: on })} onPress={() => onChange(p)} style={[s.segmentItem, { flexDirection: 'row', gap: 6 }, on && s.segmentItemOn]} testID={`${testPrefix}-${p}`}>
            <PriorityDot p={p} s={s} />
            <Text style={[s.segmentText, on && s.segmentTextOn]} numberOfLines={1}>{priorityLabel(p)}</Text>
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
        {loading ? tr('tasks.copy.101') : value ? (role === 'any' ? `${name}（${value.kind === 'user' ? tr('tasks.copy.1') : 'Agent'}）` : name)
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

/**
 * 参与人(多选,只列人类)。选择器和任务详情「编辑参与人」是同一个 RequirementPeoplePicker(mode=participants)。
 * 桌面:一格输入框,里面是已选的人(头像 + 名字),点开选择器增删。
 * 手机:每人一枚可点掉的胶囊(≥36 高)+ 一枚「添加参与人」按钮(44 高)—— 手指在面板里直接删,不必再开一层。
 */
export function ParticipantsField({ value, people, networkId, loading, onLoadPeople, onChange, touch, idBase }: {
  value: readonly RequirementPersonRef[]; people: readonly RequirementPerson[]; networkId: string; loading: boolean;
  onLoadPeople: () => Promise<boolean>; onChange: (next: RequirementPersonRef[]) => void; touch: boolean; idBase: string;
}) {
  useTranslation();
  const f = fieldStyles();
  const [open, setOpen] = useState(false);
  const show = async () => { if (await onLoadPeople()) setOpen(true); };
  const names = value.map(r => personName(r, people));
  const picker = open ? (
    <RequirementPeoplePicker
      networkId={networkId}
      mode="participants"
      kinds={['user']}
      title={tr('tasks.copy.66')}
      hint={tr('tasks.participantsPickHint', { v0: value.length })}
      people={people}
      selected={value}
      onClose={() => setOpen(false)}
      onConfirm={sel => { onChange(sel.filter(r => r.kind === 'user')); setOpen(false); }}
    />
  ) : null;
  if (touch) {
    return (
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }} testID={idBase}>
        {value.map((r, i) => (
          <Pressable key={personKey(r)} accessibilityRole="button" accessibilityLabel={tr('tasks.removeParticipant', { name: names[i] })} onPress={() => onChange(value.filter(x => personKey(x) !== personKey(r)))}
            style={{ minHeight: 36, flexDirection: 'row', alignItems: 'center', gap: 6, paddingLeft: 4, paddingRight: 12, borderRadius: radius.pill, backgroundColor: colors.subtleFill, maxWidth: '100%' }} testID={`${idBase}-chip-${r.id}`}>
            <AliasAvatar alias={names[i]} size={26} />
            <Text style={{ color: colors.text, fontSize: typeScale.body, flexShrink: 1 }} numberOfLines={1}>{names[i]}</Text>
            <Ionicons name="close" size={14} color={colors.textMuted} />
          </Pressable>
        ))}
        <Pressable accessibilityRole="button" accessibilityLabel={tr('tasks.addParticipants')} disabled={loading} onPress={() => { void show(); }}
          style={{ minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: spacing.md, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border, borderStyle: 'dashed' }} testID={`${idBase}-add`}>
          <Ionicons name="person-add-outline" size={16} color={colors.accent} />
          <Text style={{ color: colors.accent, fontSize: typeScale.body }}>{loading ? tr('tasks.copy.101') : tr('tasks.addParticipants')}</Text>
        </Pressable>
        {picker}
      </View>
    );
  }
  return (
    <>
      <Pressable testID={idBase} accessibilityRole="button" accessibilityLabel={value.length ? tr('tasks.participantsA11y', { v0: names.join('、') }) : tr('tasks.addParticipants')} disabled={loading} onPress={() => { void show(); }}
        style={state => [f.input, f.row, { flexWrap: 'wrap' }, (state as { hovered?: boolean }).hovered && { borderColor: colors.textMuted }]}>
        {value.length ? value.map((r, i) => (
          // 22 高:输入框 minHeight 40 = 22 + 上下 padding 8 + 边框 1 —— 选了人这一格也不长高(和负责人一样高)。
          <View key={personKey(r)} style={{ flexDirection: 'row', alignItems: 'center', gap: 4, height: 22, paddingLeft: 2, paddingRight: 8, borderRadius: radius.pill, backgroundColor: colors.subtleFill, maxWidth: 160 }} testID={`${idBase}-chip-${r.id}`}>
            <AliasAvatar alias={names[i]} size={18} />
            <Text style={{ color: colors.text, fontSize: typeScale.small, flexShrink: 1 }} numberOfLines={1}>{names[i]}</Text>
          </View>
        )) : <Ionicons name="people-outline" size={16} color={colors.textMuted} />}
        <Text style={{ flex: 1, color: colors.textMuted, fontSize: typeScale.body }} numberOfLines={1}>{loading ? tr('tasks.copy.101') : value.length ? '' : tr('tasks.participantsPlaceholder')}</Text>
        <Ionicons name="chevron-down" size={14} color={colors.textMuted} />
      </Pressable>
      {picker}
    </>
  );
}

export default function TaskCreateDialog({ draft, sheet, twoRoles, parentName, projects, dueDatetime, priorities, pointer, networkId, people, peopleLoading, peopleError, onLoadPeople, onChange, onSubmit, onClose, tagsCapable = false, participantsCapable = false }: {
  draft: CreateDraft | null;
  /** Hub 的 POST 收参与人(#2065 起;行里带 participants 字段)。旧 Hub 不显示这一栏 —— 发了也会被忽略。 */
  participantsCapable?: boolean;
  /** Hub 存得下标签(capabilities.tags):新建时就能带上,输入框补全已有标签。 */
  tagsCapable?: boolean;
  /** Hub 分不分「负责人(人类)/ 负责 Agent」。不分就是旧的单一负责人。 */
  twoRoles: boolean;
  /** 项目列表;null = Hub 没有项目,不显示。 */
  projects: readonly RequirementProject[] | null;
  /** 建子需求时父需求的名字(显示「属于:…」)。 */
  parentName?: string | null;
  /** Hub 能把预计完成存到秒(capabilities.due_datetime)。 */
  dueDatetime: boolean;
  /** Hub 收得下的优先级(旧 Hub 没有 P3)。 */
  priorities: readonly ReqPriority[];
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
  const tagChoices = useTagChoices();
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
    // 弹窗规则(DialogFrame.tsx):面板高度有界,表单在能收缩的 ScrollView 里,按钮行钉在面板底上。
    // 以前面板没有 maxHeight:短窗口 / 键盘弹起时「添加」掉出屏幕(sheet 则是标题和关闭钮顶出屏幕)。
    ...(sheet
      ? { maxHeight: '92%' as const, borderTopLeftRadius: BOARD_RADIUS.card, borderTopRightRadius: BOARD_RADIUS.card, paddingBottom: spacing.xl + safe.paddingBottom }
      : { width: '100%' as const, maxWidth: 480, maxHeight: '100%' as const, borderRadius: BOARD_RADIUS.card, borderWidth: themeMode() === 'dark' ? 1 : 0, borderColor: colors.border }),
    ...liftedShadow(),
  };
  return (
    <Modal visible transparent animationType={sheet ? 'slide' : 'fade'} onRequestClose={onClose}>
      <ModalKeyboardAvoider scrim="rgba(0,0,0,0.4)">
        <View style={[{ flex: 1 }, sheet ? { justifyContent: 'flex-end' } : [{ alignItems: 'center', justifyContent: 'center' }, withBasePadding(safe, spacing.lg)]]}>
          <Pressable accessibilityLabel={tr('tasks.copy.112')} onPress={onClose} style={StyleSheet.absoluteFill} testID="req-create-backdrop" />
          <View style={panel} accessibilityViewIsModal testID="req-create">
            <View style={[f.row, { justifyContent: 'space-between' }]}>
              <Text style={{ color: colors.text, fontSize: typeScale.title + 1, fontWeight: weight.strong }}>{draft.parentId ? tr('tasks.copy.113') : tr('tasks.copy.39')}</Text>
              <Pressable accessibilityRole="button" accessibilityLabel={tr('tasks.copy.114')} onPress={onClose} style={s.iconButton} testID="req-create-close">
                <Ionicons name="close" size={18} color={colors.textSecondary} />
              </Pressable>
            </View>
            <ScrollView keyboardShouldPersistTaps="handled" style={{ flexGrow: 0, flexShrink: 1 }} contentContainerStyle={{ gap: spacing.lg }} testID="req-create-body">
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
              {participantsCapable ? (
                <View style={{ gap: spacing.sm }} testID="req-create-participants">
                  <Text style={f.label}>{tr('tasks.copy.53')}</Text>
                  <ParticipantsField value={draft.participants ?? []} people={people} networkId={networkId} loading={peopleLoading} onLoadPeople={onLoadPeople} onChange={participants => set({ participants })} touch={sheet} idBase="req-participants" />
                </View>
              ) : null}
              {projects ? <ProjectSelect value={draft.projectId} projects={projects} onChange={projectId => set({ projectId })} touch={!pointer} idBase="req-project" /> : null}
              <View style={{ gap: spacing.sm }}>
                <Text style={f.label}>{tr('tasks.copy.32')}</Text>
                <PriorityPicker value={draft.priority} onChange={priority => set({ priority })} testPrefix="req-priority" choices={priorities} />
              </View>
              <View style={{ gap: spacing.sm }}>
                <Text style={f.label}>{tr('tasks.copy.119')}</Text>
                <DueField value={draft.due} onChange={due => set({ due })} error={error?.field === 'due' ? error.message : undefined} idBase="req-due" allowTime={dueDatetime} pointer={pointer} sheet={sheet} />
              </View>
              {tagsCapable ? (
                <View style={{ gap: spacing.sm }} testID="req-create-tags">
                  <Text style={f.label}>{tr('tags.title')}</Text>
                  {draft.tags?.length ? (
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                      {draft.tags.map(tag => (
                        <Pressable key={tag} accessibilityRole="button" accessibilityLabel={tr('tags.remove', { tag })} onPress={() => set({ tags: (draft.tags ?? []).filter(x => x !== tag) })} style={{ minHeight: 36, justifyContent: 'center', paddingHorizontal: 10, borderRadius: radius.control, backgroundColor: colors.subtleFill, maxWidth: '100%' }} testID={`req-create-tag-${tag}`}>
                          <Text numberOfLines={1} style={{ color: colors.text }}>{tag} ×</Text>
                        </Pressable>
                      ))}
                    </View>
                  ) : null}
                  <TagInputField tags={draft.tags ?? []} choices={tagChoices.choices} counts={tagChoices.counts} onAdd={tag => { const next = normalizeTags([...(draft.tags ?? []), tag]); if (next) set({ tags: next }); }} testPrefix="req-create" />
                </View>
              ) : null}
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
      </ModalKeyboardAvoider>
    </Modal>
  );
}
