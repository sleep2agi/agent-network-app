// 新建任务:桌面是居中的小对话框,手机是从底部升起的面板。字段:标题(自动聚焦)、负责人(头像选择器,
// 复用 RequirementPeoplePicker —— 只存稳定身份 {kind,id})、优先级、预计完成。
import { useState, type ReactNode } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Text, TextInput } from './ui-text';
import { Ionicons } from './icons';
import AliasAvatar from './AliasAvatar';
import RequirementPeoplePicker from './RequirementPeoplePicker';
import { useModalSafePadding } from './safe-area-runtime';
import { withBasePadding } from './modal-safe-area';
import { colors, radius, spacing, themeMode, type as typeScale, weight } from './theme';
import { REQ_COLUMN_LABEL, REQ_PRIORITIES, REQ_PRIORITY_LABEL, type ReqPriority, type RequirementProject } from './requirements-model';
import type { RequirementPerson, RequirementPersonRef } from './requirement-people';
import { activeProjects, checkDraft, createInput, localToday, personName, roleKinds, type CreateDraft } from './task-board-model';
import { BOARD_RADIUS, CONTROL_H, liftedShadow, PriorityDot, useTaskStyles, a11yState } from './TaskBoardParts';

/** 期限的快捷项:今天 / 明天 / 下周一 / 清除。日期框仍可手写 2026-10-01。 */
export function dueShortcuts(today: string): { key: string; label: string; value: string }[] {
  const [y, m, d] = today.split('-').map(Number);
  const at = (days: number) => {
    const dt = new Date(Date.UTC(y, m - 1, d + days));
    return dt.toISOString().slice(0, 10);
  };
  const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  const toMonday = ((8 - weekday) % 7) || 7;
  return [
    { key: 'today', label: '今天', value: today },
    { key: 'tomorrow', label: '明天', value: at(1) },
    { key: 'nextweek', label: '下周一', value: at(toMonday) },
  ];
}

export function PriorityPicker({ value, onChange, testPrefix }: { value: ReqPriority; onChange: (p: ReqPriority) => void; testPrefix: string }) {
  const s = useTaskStyles();
  return (
    <View style={[s.segment, { alignSelf: 'flex-start' }]} accessibilityRole="radiogroup">
      {REQ_PRIORITIES.map(p => {
        const on = p === value;
        return (
          <Pressable key={p} accessibilityRole="radio" {...a11yState({ checked: on })} onPress={() => onChange(p)} style={[s.segmentItem, { flexDirection: 'row', gap: 6 }, on && s.segmentItemOn]} testID={`${testPrefix}-${p}`}>
            <PriorityDot p={p} s={s} />
            <Text style={[s.segmentText, on && s.segmentTextOn]}>{REQ_PRIORITY_LABEL[p]}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function DueField({ value, onChange, error, idBase }: { value: string; onChange: (v: string) => void; error?: string; idBase: string }) {
  const testID = idBase;
  const s = useTaskStyles();
  const today = localToday();
  return (
    <View style={{ gap: spacing.sm }}>
      <TextInput value={value} onChangeText={onChange} placeholder="可空,如 2026-10-01" placeholderTextColor={colors.textMuted} style={[fieldStyles().input, error ? { borderColor: colors.failed } : null]} testID={testID} accessibilityLabel="预计完成" autoCapitalize="none" autoCorrect={false} />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
        {dueShortcuts(today).map(o => (
          <Pressable key={o.key} onPress={() => onChange(o.value)} style={[s.chip, { height: 28 }, value === o.value && s.chipOn]} testID={`${testID}-${o.key}`} accessibilityRole="button">
            <Text style={[s.chipText, value === o.value && s.chipTextOn]}>{o.label}</Text>
          </Pressable>
        ))}
        {value ? (
          <Pressable onPress={() => onChange('')} style={[s.chip, { height: 28 }]} testID={`${testID}-clear`} accessibilityRole="button">
            <Text style={s.chipText}>清除</Text>
          </Pressable>
        ) : null}
      </View>
      {error ? <Text style={s.err} accessibilityRole="alert">{error}</Text> : null}
    </View>
  );
}

export function OwnerField({ value, people, onPress, disabled, loading, idBase, role = 'any' }: {
  value: RequirementPersonRef | null; people: readonly RequirementPerson[]; onPress: () => void; disabled?: boolean; loading?: boolean; idBase: string;
  /** 'human' = 负责人(只能人类),'agent' = 负责 Agent,'any' = 旧 Hub 的单一负责人。 */
  role?: 'human' | 'agent' | 'any';
}) {
  const testID = idBase;
  const f = fieldStyles();
  const name = value ? personName(value, people) : '';
  return (
    <Pressable testID={testID} accessibilityRole="button" accessibilityLabel={value ? `${role === 'agent' ? '负责 Agent' : '负责人'} ${name}，更换` : role === 'agent' ? '选择负责 Agent' : '选择负责人'} disabled={disabled} onPress={onPress} style={[f.input, f.row]}>
      {value ? <AliasAvatar alias={name} size={22} /> : <Ionicons name={role === 'agent' ? 'hardware-chip-outline' : 'person-add-outline'} size={16} color={colors.textMuted} />}
      <Text style={{ flex: 1, color: value ? colors.text : colors.textMuted, fontSize: typeScale.body }} numberOfLines={1}>
        {loading ? '加载人员…' : value ? `${name}（${value.kind === 'user' ? '人类' : 'Agent'}）`
          : role === 'human' ? '选择负责人(人类),可空' : role === 'agent' ? '选择负责 Agent(执行者),可空' : '选择负责人(人类或 Agent),可空'}
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
  const s = useTaskStyles();
  const f = fieldStyles();
  const [picker, setPicker] = useState<'owner' | 'agent' | null>(null);
  const open = async (role: 'owner' | 'agent') => { if (await onLoadPeople()) setPicker(role); };
  const kinds = picker ? roleKinds(picker, twoRoles) : undefined;
  return (
    <>
      <View style={{ gap: spacing.sm }}>
        <Text style={f.label}>负责人</Text>
        {ownerLocked ?? <OwnerField value={owner} people={people} role={twoRoles ? 'human' : 'any'} onPress={() => { void open('owner'); }} loading={peopleLoading} disabled={peopleLoading} idBase={idBase} />}
        {twoRoles ? <Text style={s.muted}>对结果负责的人</Text> : null}
      </View>
      {twoRoles ? (
        <View style={{ gap: spacing.sm }}>
          <Text style={f.label}>负责 Agent</Text>
          <OwnerField value={agentOwner} people={people} role="agent" onPress={() => { void open('agent'); }} loading={peopleLoading} disabled={peopleLoading} idBase={`${idBase}-agent`} />
          <Text style={s.muted}>执行这件事的 Agent 节点</Text>
        </View>
      ) : null}
      {peopleError ? <Text style={s.err} testID="req-people-error">{peopleError}，点负责人重试</Text> : null}
      {picker ? (
        <RequirementPeoplePicker
          networkId={networkId}
          mode="owner"
          kinds={kinds}
          title={picker === 'agent' ? '选择负责 Agent' : '选择负责人'}
          hint={picker === 'agent' ? '选择执行这件事的 Agent 节点，也可以暂不指定' : twoRoles ? '选择一名对结果负责的人类，也可以暂不分配' : undefined}
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
      <Text style={f.label}>项目</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }} accessibilityRole="radiogroup">
        {chip(null, '无项目')}
        {list.map(p => chip(p.id, p.name, p.color))}
        {archivedCurrent ? chip(archivedCurrent.id, `${archivedCurrent.name}(已归档)`, archivedCurrent.color) : null}
      </View>
      {!list.length ? <Text style={s.muted}>还没有项目,在左栏「管理项目」里建</Text> : null}
    </View>
  );
}

export default function TaskCreateDialog({ draft, sheet, twoRoles, projects, networkId, people, peopleLoading, peopleError, onLoadPeople, onChange, onSubmit, onClose }: {
  draft: CreateDraft | null;
  /** Hub 分不分「负责人(人类)/ 负责 Agent」。不分就是旧的单一负责人。 */
  twoRoles: boolean;
  /** 项目列表;null = Hub 没有项目,不显示。 */
  projects: readonly RequirementProject[] | null;
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
  const s = useTaskStyles();
  const f = fieldStyles();
  const safe = useModalSafePadding(sheet ? 'fullScreen' : 'overlay');
  const [error, setError] = useState<{ field: 'name' | 'due' | 'submit'; message: string } | null>(null);
  const [saving, setSaving] = useState(false);
  if (!draft) return null;
  const submit = async () => {
    if (saving) return;
    const c = checkDraft(draft);
    if (!c.ok) { setError({ field: c.field, message: c.message }); return; }
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
          <Pressable accessibilityLabel="关闭新建" onPress={onClose} style={StyleSheet.absoluteFill} testID="req-create-backdrop" />
          <View style={panel} accessibilityViewIsModal testID="req-create">
            <View style={[f.row, { justifyContent: 'space-between' }]}>
              <Text style={{ color: colors.text, fontSize: typeScale.title + 1, fontWeight: weight.strong }}>新建任务</Text>
              <Pressable accessibilityRole="button" accessibilityLabel="关闭" onPress={onClose} style={s.iconButton} testID="req-create-close">
                <Ionicons name="close" size={18} color={colors.textSecondary} />
              </Pressable>
            </View>
            <ScrollView keyboardShouldPersistTaps="handled" style={{ flexGrow: 0 }} contentContainerStyle={{ gap: spacing.lg }}>
              <TextInput
                autoFocus
                value={draft.name}
                onChangeText={name => set({ name })}
                onSubmitEditing={() => { void submit(); }}
                placeholder="要做什么？"
                placeholderTextColor={colors.textMuted}
                style={[f.input, { fontSize: typeScale.title, minHeight: 44 }, error?.field === 'name' ? { borderColor: colors.failed } : null]}
                testID="req-name"
                accessibilityLabel="任务标题"
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
                <Text style={f.label}>优先级</Text>
                <PriorityPicker value={draft.priority} onChange={priority => set({ priority })} testPrefix="req-priority" />
              </View>
              <View style={{ gap: spacing.sm }}>
                <Text style={f.label}>预计完成</Text>
                <DueField value={draft.due} onChange={due => set({ due })} error={error?.field === 'due' ? error.message : undefined} idBase="req-due" />
              </View>
            </ScrollView>
            {error?.field === 'submit' ? <Text style={s.err} accessibilityRole="alert" testID="req-error">{error.message}</Text> : null}
            <View style={[f.row, { justifyContent: 'space-between' }]}>
              <Text style={s.muted}>放进「{REQ_COLUMN_LABEL[draft.column]}」</Text>
              <View style={[f.row, { gap: spacing.sm }]}>
                <Pressable accessibilityRole="button" onPress={onClose} style={[s.primary, { backgroundColor: colors.subtleFill }]} testID="req-create-cancel">
                  <Text style={[s.primaryText, { color: colors.text }]}>取消</Text>
                </Pressable>
                <Pressable accessibilityRole="button" {...a11yState({ disabled: saving || !draft.name.trim() })} disabled={saving} onPress={() => { void submit(); }} style={[s.primary, { minWidth: 72, justifyContent: 'center', height: CONTROL_H + 4 }, (saving || !draft.name.trim()) && { opacity: 0.5 }]} testID="req-add">
                  <Text style={s.primaryText}>{saving ? '创建中…' : '创建'}</Text>
                </Pressable>
              </View>
            </View>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
