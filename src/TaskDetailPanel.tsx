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
import { checkDraft, DESCRIPTION_MAX, editDraftOf, editPatch, hasDetails, hasRoles, type EditDraft, type EditPatch } from './task-board-model';
import TaskChecklist from './TaskChecklist';
import MarkdownMessage from './MarkdownMessage';
import { BOARD_RADIUS, cardBg, liftedShadow, Segmented, STATUS_TONE, useTaskStyles, a11yState } from './TaskBoardParts';
import { DueField, fieldStyles, PriorityPicker, ProjectPicker, RoleFields } from './TaskCreateDialog';

export const DRAWER_WIDTH = 420;

export default function TaskDetailPanel({ cfg, item, projects, mode, top, people, peopleLoading, onLoadPeople, moving, moveError, onMove, onSave, onAssignmentsSaved, onClose, pointer, checklistError, onChecklistToggle, onChecklistAdd, onChecklistDelete, onChecklistMove }: {
  cfg: HubConfig;
  item: Requirement;
  /** 项目列表;null = Hub 没有项目。 */
  projects: readonly RequirementProject[] | null;
  mode: 'drawer' | 'page';
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
}) {
  const s = useTaskStyles();
  const f = fieldStyles();
  const styles = makePanelStyles();
  const safe = useModalSafePadding('fullScreen');
  const [draft, setDraft] = useState<EditDraft>(() => editDraftOf(item));
  const [error, setError] = useState<{ field: 'name' | 'due' | 'submit'; message: string } | null>(null);
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
        owner: JSON.stringify(d.owner) === JSON.stringify(base.owner) ? next.owner : d.owner,
        agentOwner: JSON.stringify(d.agentOwner) === JSON.stringify(base.agentOwner) ? next.agentOwner : d.agentOwner,
        description: d.description === base.description ? next.description : d.description,
        projectId: d.projectId === base.projectId ? next.projectId : d.projectId,
      };
    });
  }, [item]);
  const patch = editPatch(item, draft);
  const set = (p: Partial<EditDraft>) => { setDraft(d => ({ ...d, ...p })); setSaved(false); if (error) setError(null); };
  const save = async () => {
    if (!patch || saving) return;
    const c = checkDraft(draft);
    if (!c.ok) { setError({ field: c.field, message: c.message }); return; }
    setSaving(true);
    const failed = await onSave(patch);
    setSaving(false);
    if (failed) setError({ field: 'submit', message: failed });
    else setSaved(true);
  };
  const legacy = item.owner === undefined;

  const body: ReactNode = (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: spacing.xl, gap: spacing.lg }} keyboardShouldPersistTaps="handled">
      <TextInput
        value={draft.name}
        onChangeText={name => set({ name })}
        placeholder="任务标题"
        placeholderTextColor={colors.textMuted}
        multiline
        style={[f.input, { fontSize: typeScale.heading - 2, fontWeight: weight.strong, minHeight: 48, backgroundColor: 'transparent', borderColor: error?.field === 'name' ? colors.failed : colors.border }]}
        testID="req-edit-name"
        accessibilityLabel="任务标题"
      />
      {error?.field === 'name' ? <Text style={s.err} accessibilityRole="alert">{error.message}</Text> : null}
      <Field label="状态">
        <View style={[s.segment, { alignSelf: 'flex-start' }]} accessibilityRole="radiogroup">
          {REQ_COLUMNS.map(col => {
            const on = col === item.column;
            return (
              <Pressable
                key={col}
                accessibilityRole="radio"
                accessibilityLabel={on ? `当前：${REQ_COLUMN_LABEL[col]}` : `移到${REQ_COLUMN_LABEL[col]}`}
                {...a11yState({ disabled: moving || on, selected: on, checked: on })}
                disabled={moving || on}
                onPress={() => onMove(col)}
                style={[s.segmentItem, { flexDirection: 'row', gap: 6 }, on && s.segmentItemOn]}
                testID={`req-move-${col}`}
              >
                <View style={[s.prioDot, { backgroundColor: STATUS_TONE[col]() }]} />
                <Text style={[s.segmentText, on && s.segmentTextOn]}>{REQ_COLUMN_LABEL[col]}</Text>
              </Pressable>
            );
          })}
        </View>
        {moving ? <Text style={s.muted} accessibilityLiveRegion="polite">正在保存状态…</Text> : null}
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
            <Text style={{ color: colors.text, fontSize: typeScale.body }}>{item.assignee || '未分配'}</Text>
            <Text style={s.muted} testID="req-owner-unsupported">升级 Hub 后可绑定人类或 Agent 负责人</Text>
          </>
        ) : undefined}
      />
      {projects && item.projectId !== undefined ? <ProjectPicker value={draft.projectId} projects={projects} onChange={projectId => set({ projectId })} idBase="req-edit-project" /> : null}
      <Field label="优先级">
        <PriorityPicker value={draft.priority} onChange={priority => set({ priority })} testPrefix="req-edit-priority" />
      </Field>
      <Field label="预计完成">
        <DueField value={draft.due} onChange={due => set({ due })} error={error?.field === 'due' ? error.message : undefined} idBase="req-edit-due" />
      </Field>
      {hasDetails(item) ? (
        <>
          <DescriptionField value={draft.description} onChange={description => set({ description })} />
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
      ) : (
        <Text style={s.muted} testID="req-details-unsupported">升级 Hub 后可写描述(markdown)和子任务</Text>
      )}
      {!legacy ? (
        <Field label="参与人">
          <RequirementAssignmentsEditor key={item.id} cfg={cfg} item={item} fields="participants" onSaved={onAssignmentsSaved} />
        </Field>
      ) : null}
      {item.createdAt ? <Text style={s.muted}>创建于 {item.createdAt.slice(0, 10)}</Text> : null}
    </ScrollView>
  );

  const footer = (
    <View style={[styles.footer, { borderTopColor: colors.border }, mode === 'page' && { paddingBottom: spacing.md + safe.paddingBottom }]}>
      {error?.field === 'submit' ? <Text style={[s.err, { flex: 1 }]} accessibilityRole="alert" testID="req-edit-error">{error.message}</Text>
        : <Text style={[s.muted, { flex: 1 }]} accessibilityLiveRegion="polite">{saving ? '正在保存…' : saved ? '已保存' : patch ? '有未保存的修改' : ''}</Text>}
      <Pressable
        accessibilityRole="button"
        {...a11yState({ disabled: !patch || saving })}
        disabled={!patch || saving}
        onPress={() => { void save(); }}
        style={[s.primary, { height: 36, paddingHorizontal: spacing.lg }, (!patch || saving) && { opacity: 0.45 }]}
        testID="req-edit-save"
      >
        <Text style={s.primaryText}>保存修改</Text>
      </Pressable>
    </View>
  );

  const head = (
    <View style={[styles.head, { borderBottomColor: colors.border }]}>
      {mode === 'page' ? (
        <Pressable accessibilityRole="button" accessibilityLabel="返回" onPress={onClose} style={[s.iconButton, { marginLeft: -spacing.sm }]} testID="req-detail-close">
          <Ionicons name="chevron-back" size={22} color={colors.text} />
        </Pressable>
      ) : null}
      <Text style={{ flex: 1, color: colors.text, fontSize: typeScale.title, fontWeight: weight.strong }}>任务详情</Text>
      {saving || moving ? <ActivityIndicator size="small" color={colors.textMuted} /> : null}
      {mode === 'drawer' ? (
        <Pressable accessibilityRole="button" accessibilityLabel="关闭任务详情" onPress={onClose} style={s.iconButton} testID="req-detail-close">
          <Ionicons name="close" size={18} color={colors.textSecondary} />
        </Pressable>
      ) : null}
    </View>
  );


  if (mode === 'drawer') {
    return (
      <View
        style={[styles.drawer, { top, backgroundColor: cardBg(), borderLeftColor: colors.border }, liftedShadow()]}
        accessibilityViewIsModal
        accessibilityLabel="任务详情"
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

/** 描述:markdown 原文,编辑 / 预览两档(预览用聊天里同一个 MarkdownMessage 渲染)。跟标题一起「保存修改」。 */
function DescriptionField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const s = useTaskStyles();
  const f = fieldStyles();
  const [mode, setMode] = useState<'edit' | 'preview'>(value.trim() ? 'preview' : 'edit');
  return (
    <View style={{ gap: spacing.sm }} testID="req-description">
      <View style={[f.row, { justifyContent: 'space-between' }]}>
        <Text style={f.label}>描述</Text>
        <Segmented s={s} items={[{ key: 'edit', label: '编辑' }, { key: 'preview', label: '预览' }]} value={mode} onChange={setMode} testID="req-description-mode" />
      </View>
      {mode === 'edit' ? (
        <>
          <TextInput
            value={value}
            onChangeText={onChange}
            multiline
            maxLength={DESCRIPTION_MAX}
            placeholder="支持 Markdown:目标、背景、验收标准…"
            placeholderTextColor={colors.textMuted}
            style={[f.input, { minHeight: 140, textAlignVertical: 'top' }]}
            testID="req-description-input"
            accessibilityLabel="描述(Markdown)"
          />
          {value.length > DESCRIPTION_MAX * 0.9 ? <Text style={s.muted}>{value.length} / {DESCRIPTION_MAX}</Text> : null}
        </>
      ) : (
        <Pressable onPress={() => setMode('edit')} accessibilityRole="button" accessibilityLabel="编辑描述" style={[f.input, { minHeight: 60, backgroundColor: 'transparent' }]} testID="req-description-preview">
          {value.trim() ? <MarkdownMessage>{value}</MarkdownMessage> : <Text style={s.muted}>还没有描述,点这里编辑</Text>}
        </Pressable>
      )}
    </View>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
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
