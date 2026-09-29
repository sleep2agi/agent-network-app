import { t as tr } from './i18n';
import { validationText } from './i18n-task-presentation';
import { useTranslation } from './i18n-react';
import { taskText } from './i18n-tasks';
// 任务详情:宽屏是右侧抽屉(看板仍在左边可见),手机是推入的一整页(安卓返回键 / 左上 ‹ 关闭)。
// 可改:标题、优先级、预计完成、负责人(#488 + Hub #2070 的 PATCH,只发改过的字段),点「保存修改」才写 Hub。
// 状态单独一排,点了立即保存(和看板上拖动 / 菜单是同一个动作)。参与人沿用 RequirementAssignmentsEditor。
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Text, TextInput } from './ui-text';
import { Ionicons } from './icons';
import RequirementAssignmentsEditor from './RequirementAssignmentsEditor';
import { useModalSafePadding } from './safe-area-runtime';
import { colors, spacing, type as typeScale, weight } from './theme';
import type { HubConfig } from './api';
import { REQ_COLUMN_LABEL, REQ_COLUMNS, type ReqColumn, type Requirement, type RequirementProject } from './requirements-model';
import type { RequirementPerson } from './requirement-people';
import type { RequirementAssignments } from './requirement-people-api';
import { checkDraft, startError, editDraftOf, editPatch, hasDetails, hasRoles, type EditDraft, type EditPatch } from './task-board-model';
import TaskChecklist from './TaskChecklist';
import TaskIssueBindings from './TaskIssueBindings';
import TaskTags from './TaskTags';
import { parseIssue } from './requirement-issues';
import { ExternalLink, levelIn, ParentBreadcrumb, SubRequirements } from './TaskRelations';
import TaskDescriptionEditor from './TaskDescriptionEditor';
import { BOARD_RADIUS, cardBg, liftedShadow, STATUS_TONE, useTaskStyles, a11yState } from './TaskBoardParts';
import { DueField, fieldStyles, PriorityPicker, RoleFields } from './TaskCreateDialog';
import { ParentSelect, ProjectSelect } from './TaskFieldPickers';
import { moreSummary } from './task-detail-more';
import { priorityChoices } from './task-priority';
import { loadDetailMoreOpen, saveDetailMoreOpen } from './task-detail-prefs';
import { PARENT_REJECTED, PARENT_TOO_DEEP } from './requirements-hub';

export const DRAWER_WIDTH = 420;

export default function TaskDetailPanel({ cfg, item, items, onOpenRequirement, onCreateChild, projects, dueDatetime, lowestPriority, mode, top, people, peopleLoading, onLoadPeople, moving, moveError, onMove, onSave, onAssignmentsSaved, onClose, pointer, checklistError, onChecklistToggle, onChecklistAdd, onChecklistDelete, onChecklistMove, onOpenVoiceSettings, onOpenWindow }: {
  cfg: HubConfig;
  item: Requirement;
  /** 全部卡片(找父需求 / 子需求用)。 */
  items: readonly Requirement[];
  onOpenRequirement: (id: string) => void;
  onCreateChild: (parent: Requirement) => void;
  /** 项目列表;null = Hub 没有项目。 */
  projects: readonly RequirementProject[] | null;
  dueDatetime: boolean;
  /** Hub 收 P3 极低(capabilities.priority_lowest);旧 Hub 不给选。 */
  lowestPriority: boolean;
  /** window = 「在新窗口打开」的任务窗口:整窗铺满,没有 ✕(关窗口用系统的)。 */
  mode: 'drawer' | 'page' | 'window';
  /** 抽屉的上沿 = 页面头部的下沿(对齐)。 */
  top: number;
  people: readonly RequirementPerson[];
  peopleLoading: boolean;
  onLoadPeople: () => Promise<boolean>;
  moving: boolean;
  moveError: string;
  onMove: (to: ReqColumn) => void;
  onSave: (patch: EditPatch) => Promise<string | null>;
  onAssignmentsSaved: (a: RequirementAssignments) => void;
  onClose: () => void;
  /** 鼠标界面:子任务可拖动排序。 */
  pointer: boolean;
  checklistError: string;
  onChecklistToggle: (id: string, done: boolean) => void;
  onChecklistAdd: (text: string) => boolean;
  onChecklistDelete: (id: string) => void;
  onChecklistMove: (from: number, to: number) => void;
  /** 描述的语音输入未配置时「去设置」。 */
  onOpenVoiceSettings?: () => void;
  /** 桌面(Tauri)抽屉:「⧉ 在新窗口打开」;true = 窗口开了。 */
  onOpenWindow?: () => Promise<boolean>;
}) {
  useTranslation();
  const s = useTaskStyles();
  const f = fieldStyles();
  const styles = makePanelStyles();
  const safe = useModalSafePadding('fullScreen');
  const [draft, setDraft] = useState<EditDraft>(() => editDraftOf(item));
  const [error, setError] = useState<{ field: 'name' | 'due' | 'start' | 'submit' | 'parent'; message: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  // 换了一张卡片就换草稿;同一张卡片被 Hub 刷新(别处改了)时,没改过的字段跟着刷新。
  const shown = useRef(item);
  useEffect(() => {
    const prev = shown.current;
    shown.current = item;
    if (prev.id !== item.id) { setDraft(editDraftOf(item)); setError(null); setSaved(false); return; }
    setDraft(d => {
      const base = editDraftOf(prev);
      const next = editDraftOf(item);
      return {
        name: d.name === base.name ? next.name : d.name,
        priority: d.priority === base.priority ? next.priority : d.priority,
        due: d.due === base.due ? next.due : d.due,
        start: d.start === base.start ? next.start : d.start,
        owner: JSON.stringify(d.owner) === JSON.stringify(base.owner) ? next.owner : d.owner,
        agentOwner: JSON.stringify(d.agentOwner) === JSON.stringify(base.agentOwner) ? next.agentOwner : d.agentOwner,
        description: d.description === base.description ? next.description : d.description,
        projectId: d.projectId === base.projectId ? next.projectId : d.projectId,
        parentId: d.parentId === base.parentId ? next.parentId : d.parentId,
      };
    });
  }, [item]);
  const patch = editPatch(item, draft);
  const set = (p: Partial<EditDraft>) => { setDraft(d => ({ ...d, ...p })); setSaved(false); if (error) setError(null); };
  const save = async () => {
    if (!patch || saving) return;
    const c = checkDraft(draft);
    if (!c.ok) { setError({ field: c.field, message: validationText(c.message) }); return; }
    const badStart = patch.start !== undefined ? startError(patch.start) : null;
    if (badStart) { setError({ field: 'start', message: validationText(badStart) }); return; }
    setSaving(true);
    const failed = await onSave(patch);
    setSaving(false);
    if (failed) setError({ field: patch.parent_id !== undefined && (failed === PARENT_TOO_DEEP || failed === PARENT_REJECTED) ? 'parent' : 'submit', message: failed });
    else setSaved(true);
  };
  const legacy = item.owner === undefined;
  // 「更多」展开没有:本机记住(task-detail-prefs.ts);读到之前按收起。
  const [moreOpen, setMoreOpen] = useState(false);
  useEffect(() => { let alive = true; void loadDetailMoreOpen().then(v => { if (alive && v !== null) setMoreOpen(v); }); return () => { alive = false; }; }, []);
  const toggleMore = () => setMoreOpen(v => { void saveDetailMoreOpen(!v); return !v; });
  // 开了新窗口:抽屉里没有没保存的修改就收起(新窗口从 Hub 读同一份);有的话留着,免得丢。开不了 = 留在抽屉,说一声。
  const openWindow = async () => {
    if (!onOpenWindow) return;
    const ok = await onOpenWindow();
    if (ok && !patch) onClose();
    else if (!ok) setError({ field: 'submit', message: tr('taskWin.failed') });
  };

  // 常显:标题 · 状态 · 负责人 / 负责 Agent · 项目 · 预计完成 · 描述;其余收进「更多」(owner 09-29:详情太长)。
  // 更多收起时,里面有值的字段在「更多」那一行上用一行字说出来(task-detail-more.ts),不悄悄藏掉。
  const summary = moreSummary(item, draft, items);
  // 母任务被 Hub 拒绝、检查项没存上:错误在「更多」里,自动展开,不能藏着。
  const moreShown = moreOpen || error?.field === 'parent' || error?.field === 'start' || !!checklistError;
  const body: ReactNode = (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: spacing.xl, gap: spacing.lg }} keyboardShouldPersistTaps="handled">
      <ParentBreadcrumb item={item} items={items} onOpen={onOpenRequirement} />
      <TextInput
        value={draft.name}
        onChangeText={name => set({ name })}
        placeholder={tr('tasks.copy.118')}
        placeholderTextColor={colors.textMuted}
        multiline
        style={[f.input, { fontSize: typeScale.heading - 2, fontWeight: weight.strong, minHeight: 48, backgroundColor: 'transparent', borderColor: error?.field === 'name' ? colors.failed : colors.border }]}
        testID="req-edit-name"
        accessibilityLabel={tr('tasks.copy.118')}
      />
      {error?.field === 'name' ? <Text style={s.err} accessibilityRole="alert">{error.message}</Text> : null}
      <Field label={tr('tasks.copy.54')}>
        <View style={[s.segment, { alignSelf: 'flex-start' }]} accessibilityRole="radiogroup">
          {REQ_COLUMNS.map(col => {
            const on = col === item.column;
            return (
              <Pressable
                key={col}
                accessibilityRole="radio"
                accessibilityLabel={on ? tr('tasks.copy.91', { v0: taskText(REQ_COLUMN_LABEL[col]) }) : tr('tasks.copy.135', { v0: taskText(REQ_COLUMN_LABEL[col]) })}
                {...a11yState({ disabled: moving || on, selected: on, checked: on })}
                disabled={moving || on}
                onPress={() => onMove(col)}
                style={[s.segmentItem, { flexDirection: 'row', gap: 6 }, on && s.segmentItemOn]}
                testID={`req-move-${col}`}
              >
                <View style={[s.prioDot, { backgroundColor: STATUS_TONE[col]() }]} />
                <Text style={[s.segmentText, on && s.segmentTextOn]}>{taskText(REQ_COLUMN_LABEL[col])}</Text>
              </Pressable>
            );
          })}
        </View>
        {moving ? <Text style={s.muted} accessibilityLiveRegion="polite">{tr('tasks.copy.136')}</Text> : null}
        {moveError ? <Text style={s.err} accessibilityRole="alert">{moveError}</Text> : null}
      </Field>
      <RoleFields
        twoRoles={hasRoles(item)}
        owner={draft.owner}
        agentOwner={draft.agentOwner}
        people={people}
        peopleLoading={peopleLoading}
        networkId={cfg.networkId || ''}
        onLoadPeople={onLoadPeople}
        onChange={p => set(p)}
        idBase="req-edit-owner"
        ownerLocked={legacy ? (
          <>
            <Text style={{ color: colors.text, fontSize: typeScale.body }}>{item.assignee || tr('tasks.copy.6')}</Text>
            <Text style={s.muted} testID="req-owner-unsupported">{tr('tasks.copy.137')}</Text>
          </>
        ) : undefined}
      />
      {projects && item.projectId !== undefined ? <ProjectSelect value={draft.projectId} projects={projects} onChange={projectId => set({ projectId })} touch={!pointer} idBase="req-edit-project" /> : null}
      <Field label={tr('tasks.copy.119')}>
        <DueField value={draft.due} onChange={due => set({ due })} error={error?.field === 'due' ? error.message : undefined} idBase="req-edit-due" allowTime={dueDatetime} pointer={pointer} sheet={mode === 'page'} />
      </Field>
      {hasDetails(item) ? (
        <TaskDescriptionEditor cfg={cfg} value={draft.description} onChange={description => set({ description })} pointer={pointer} title={item.name} dirty={!!patch} onOpenVoiceSettings={onOpenVoiceSettings} />
      ) : (
        <Text style={s.muted} testID="req-details-unsupported">{tr('tasks.copy.138')}</Text>
      )}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={moreShown ? tr('detail.lessA11y') : tr('detail.moreA11y')}
        {...a11yState({ expanded: moreShown })}
        onPress={toggleMore}
        style={state => [{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 36, marginHorizontal: -spacing.sm, paddingHorizontal: spacing.sm, borderRadius: BOARD_RADIUS.control }, ((state as { hovered?: boolean }).hovered || state.pressed) && { backgroundColor: colors.rowHover }]}
        testID="req-more-toggle"
      >
        <Text style={{ color: colors.textSecondary, fontSize: typeScale.small, fontWeight: weight.medium, flexShrink: 0 }} testID="req-more-label">{tr('detail.more')}</Text>
        <Ionicons name={moreShown ? 'chevron-up' : 'chevron-down'} size={14} color={colors.textMuted} />
        {!moreShown && summary.length ? <Text style={[s.muted, { flex: 1 }]} numberOfLines={1} testID="req-more-summary">{summary.map(x => tr(x.key, x.values)).join(' · ')}</Text> : null}
      </Pressable>
      {moreShown ? (
        <View style={{ gap: spacing.lg }} testID="req-more">
          {/* 开始(甘特图的条从这里画):只有带 start 字段的 Hub(capability start_date)才有;只到日。 */}
          {item.start !== undefined ? (
            <Field label={tr('detail.start')}>
              <DueField value={draft.start} onChange={start => set({ start })} error={error?.field === 'start' ? error.message : undefined} idBase="req-edit-start" pointer={pointer} sheet={mode === 'page'} />
            </Field>
          ) : null}
          <Field label={tr('tasks.copy.32')}>
            <PriorityPicker value={draft.priority} onChange={priority => set({ priority })} testPrefix="req-edit-priority" choices={priorityChoices(lowestPriority, item.priority)} />
          </Field>
          <ParentSelect item={item} items={items} value={draft.parentId} onChange={parentId => set({ parentId })} touch={!pointer} idBase="req-edit-parent" error={error?.field === 'parent' ? error.message : undefined} />
          <SubRequirements item={item} items={items} onOpen={onOpenRequirement} onCreateChild={onCreateChild} canAddLevel={levelIn(items, item) < 5} />
          {hasDetails(item) ? (
            <>
              <TaskChecklist
                items={item.checklist ?? []}
                pointer={pointer}
                onToggle={onChecklistToggle}
                onAdd={onChecklistAdd}
                onDelete={onChecklistDelete}
                onMove={onChecklistMove}
                error={checklistError}
              />
            </>
          ) : null}
          {!legacy ? (
            <Field label={tr('tasks.copy.53')}>
              <RequirementAssignmentsEditor key={item.id} cfg={cfg} item={item} fields="participants" onSaved={onAssignmentsSaved} />
            </Field>
          ) : null}
          <TaskIssueBindings key={item.id} item={item} onSave={onSave} />
          <TaskTags key={`tags:${item.id}`} cfg={cfg} item={item} onSave={onSave} />
          {!item.externalUrl || !parseIssue(item.externalUrl, false) ? <ExternalLink item={item} /> : null}
          {item.createdAt ? <Text style={s.muted}>{tr('tasks.copy.139')}{item.createdAt.slice(0, 10)}</Text> : null}
        </View>
      ) : null}
    </ScrollView>
  );

  const footer = (
    <View style={[styles.footer, { borderTopColor: colors.border }, mode === 'page' && { paddingBottom: spacing.md + safe.paddingBottom }]}>
      {error?.field === 'submit' ? <Text style={[s.err, { flex: 1 }]} accessibilityRole="alert" testID="req-edit-error">{error.message}</Text>
        : <Text style={[s.muted, { flex: 1 }]} accessibilityLiveRegion="polite">{saving ? tr('tasks.copy.140') : saved ? tr('tasks.copy.141') : patch ? tr('tasks.copy.142') : ''}</Text>}
      <Pressable
        accessibilityRole="button"
        {...a11yState({ disabled: !patch || saving })}
        disabled={!patch || saving}
        onPress={() => { void save(); }}
        style={[s.primary, { height: 36, paddingHorizontal: spacing.lg }, (!patch || saving) && { opacity: 0.45 }]}
        testID="req-edit-save"
      >
        <Text style={s.primaryText}>{tr('tasks.copy.143')}</Text>
      </Pressable>
    </View>
  );

  const head = (
    <View style={[styles.head, { borderBottomColor: colors.border }]}>
      {mode === 'page' ? (
        <Pressable accessibilityRole="button" accessibilityLabel={tr('tasks.copy.144')} onPress={onClose} style={[s.iconButton, { marginLeft: -spacing.sm }]} testID="req-detail-close">
          <Ionicons name="chevron-back" size={22} color={colors.text} />
        </Pressable>
      ) : null}
      <Text style={{ flex: 1, color: colors.text, fontSize: typeScale.title, fontWeight: weight.strong }}>{tr('tasks.copy.145')}</Text>
      {saving || moving ? <ActivityIndicator size="small" color={colors.textMuted} /> : null}
      {mode === 'drawer' && onOpenWindow ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={tr('taskWin.open')}
          {...({ title: tr('taskWin.open') } as object)}
          onPress={() => { void openWindow(); }}
          style={state => [s.iconButton, ((state as { hovered?: boolean }).hovered || state.pressed) && { backgroundColor: colors.rowHover }]}
          testID="req-detail-open-window"
        >
          <Ionicons name="open-outline" size={17} color={colors.textSecondary} />
        </Pressable>
      ) : null}
      {mode === 'drawer' ? (
        <Pressable accessibilityRole="button" accessibilityLabel={tr('tasks.copy.146')} onPress={onClose} style={s.iconButton} testID="req-detail-close">
          <Ionicons name="close" size={18} color={colors.textSecondary} />
        </Pressable>
      ) : null}
    </View>
  );


  if (mode === 'window') {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg }} testID="req-detail" accessibilityLabel={tr('tasks.copy.145')}>
        {head}
        {body}
        {footer}
      </View>
    );
  }
  if (mode === 'drawer') {
    return (
      <View
        style={[styles.drawer, { top, backgroundColor: cardBg(), borderLeftColor: colors.border }, liftedShadow()]}
        accessibilityViewIsModal
        accessibilityLabel={tr('tasks.copy.145')}
        testID="req-detail"
      >
        {head}
        {body}
        {footer}
      </View>
    );
  }
  return (
    <Modal visible animationType="slide" onRequestClose={onClose} presentationStyle="fullScreen">
      <View style={{ flex: 1, backgroundColor: colors.bg, paddingTop: safe.paddingTop }} testID="req-detail" accessibilityViewIsModal>
        {head}
        {body}
        {footer}
      </View>
    </Modal>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  useTranslation();
  const f = fieldStyles();
  return (
    <View style={{ gap: spacing.sm }}>
      <Text style={f.label}>{label}</Text>
      {children}
    </View>
  );
}

const makePanelStyles = () => StyleSheet.create({
  drawer: { position: 'absolute', right: 0, bottom: 0, width: DRAWER_WIDTH, maxWidth: '100%', borderLeftWidth: StyleSheet.hairlineWidth, borderTopLeftRadius: BOARD_RADIUS.card, zIndex: 20, overflow: 'hidden' },
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, height: 56, paddingHorizontal: spacing.xl, borderBottomWidth: StyleSheet.hairlineWidth },
  footer: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.xl, paddingVertical: spacing.md, borderTopWidth: StyleSheet.hairlineWidth },
});
