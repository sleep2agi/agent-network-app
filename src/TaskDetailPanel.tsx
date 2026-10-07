import { t as tr } from './i18n';
import { validationText } from './i18n-task-presentation';
import { useTranslation } from './i18n-react';
import { taskText } from './i18n-tasks';
// 任务详情(#701 重做):桌面是右侧抽屉(TaskDrawer.tsx 外框,默认 560、可拖宽),手机是推入的一整页,两者同一套样子:
//   头部:标题(就地编辑)· 状态 pill · 优先级 pill · #编号 · 复制链接 ·(抽屉)在新窗口打开 / 关闭。
//   正文:抽屉够宽时两栏 —— 左:描述、子任务、动态;右:属性(负责人、负责 Agent、参与人、项目、预计完成、标签)+ 更多。
//         窄抽屉 / 手机一栏(属性在前)。
// 保存:没有「保存修改」按钮了。
//   · 属性(状态、优先级、负责人、负责 Agent、参与人、项目、预计完成、标签、开始、母任务):改完立即保存,只发那一个字段,
//     成功后底部一个小提示「已保存」。
//   · 标题、描述(打字):离开输入框时保存(只发那一个字段),Esc 放弃这次改动、退回卡上的值。关详情 / 换卡时没存的照旧先存上。
// 纯逻辑(失焦补丁、Esc、宽度、分栏、链接、主题色)在 task-drawer-model.ts。
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ActivityIndicator, Modal, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Text, TextInput } from './ui-text';
import { Ionicons } from './icons';
import RequirementAssignmentsEditor from './RequirementAssignmentsEditor';
import { useModalSafePadding } from './safe-area-runtime';
import { colors, radius, spacing, type as typeScale, weight } from './theme';
import type { HubConfig } from './api';
import { REQ_COLUMN_LABEL, REQ_COLUMNS, type ReqColumn, type Requirement, type RequirementProject } from './requirements-model';
import type { RequirementPerson } from './requirement-people';
import type { RequirementAssignments } from './requirement-people-api';
import { ownerChange, type AssignChange } from './task-assign';
import { personKey, type RequirementPersonRef } from './requirement-people';
import { checkDraft, startError, editDraftOf, editPatch, hasDetails, hasRoles, type EditDraft, type EditPatch } from './task-board-model';
import TaskChecklist from './TaskChecklist';
import TaskIssueBindings from './TaskIssueBindings';
import TaskTags from './TaskTags';
import TaskComments from './TaskComments';
import { parseIssue } from './requirement-issues';
import { ExternalLink, levelIn, ParentBreadcrumb, SubRequirements } from './TaskRelations';
import TaskDescriptionEditor from './TaskDescriptionEditor';
import { BOARD_RADIUS, PriorityDot, STATUS_TONE, useTaskStyles, a11yState } from './TaskBoardParts';
import { blurPatch, drawerColumns, drawerTokens, escapeDraft, SAVED_TOAST_MS, taskLink, type TextField } from './task-drawer-model';
import { priorityLabel } from './task-priority';
import { DueField, fieldStyles, PriorityPicker, RoleFields } from './TaskCreateDialog';
import { ParentSelect, ProjectSelect } from './TaskFieldPickers';
import { moreSummary } from './task-detail-more';
import { priorityChoices } from './task-priority';
import { loadDetailMoreOpen, saveDetailMoreOpen } from './task-detail-prefs';
import { PARENT_REJECTED, PARENT_TOO_DEEP } from './requirements-hub';
import TaskIdChip from './TaskIdChip';
import { readOnlyLabelKey, type TaskEditField } from './task-access';
import { lockedMainRows, lockedMoreRows, lockedRestRows, type LockedRow } from './task-detail-locked';

/** 旧的固定抽屉宽度;#701 起抽屉宽度由 TaskDrawer(默认 560、可拖)决定,这个只剩给批量条留位的兜底。 */
export { DRAWER_DEFAULT_WIDTH as DRAWER_WIDTH } from './task-drawer-model';

export default function TaskDetailPanel({ cfg, item, readOnly = false, editFields, items, onOpenRequirement, onCreateChild, projects, dueDatetime, lowestPriority, mode, top, people, peopleLoading, onLoadPeople, moving, moveError, onMove, onSave, onAssignmentsSaved, onAssign, onClose, onArchive, onFlush, pointer, checklistError, onChecklistToggle, onChecklistAdd, onChecklistDelete, onChecklistMove, onOpenVoiceSettings, onOpenWindow, networkId }: {
  cfg: HubConfig;
  item: Requirement;
  /** 只读(RFC-038 §9:hub 说这张卡我不能改)。表单整块不响应,底部不给「保存修改」,顶上一条说明。 */
  readOnly?: boolean;
  /** 只读的卡上仍能改的字段(参与人:状态、检查项;hub viewer_can.edit_fields)。只有这几块响应,其余照只读。 */
  editFields?: readonly TaskEditField[];
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
  /** 负责人 / 负责 Agent 选完立即保存(只发那一个字段);null = 存上了,字符串 = 没存上的原因。 */
  onAssign: (change: AssignChange) => Promise<string | null>;
  onClose: () => void;
  /** 归档(true)/ 恢复(false);不给 = 这张卡不能归档(旧 Hub、只读、单卡窗口)。 */
  onArchive?: (archived: boolean) => void;
  /**
   * 详情不是经过自己的 ✕ / 返回关掉的(点了另一张卡、筛选把它藏了、面板被换掉)时,没存的标题 / 描述交给看板按 id 存 ——
   * 不靠「当前选中的卡」,因为那时选中的已经是别的卡了(任务页审计 2026-10-02 M1)。
   */
  onFlush?: (id: string, patch: EditPatch) => void;
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
  /** 「复制链接」里的网络(anet://task/<网络>/<id>)。 */
  networkId?: string | null;
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
  // 没存的打字(标题 / 描述)在换卡 / 卸载时交给看板存(onFlush)。选择类字段选完就存了,不在这里重发。
  // savedRef:刚经「保存修改」/ ✕ 存过的同一份改动不再发第二次(卸载时卡片行可能还没刷新成新值)。
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const onFlushRef = useRef(onFlush);
  onFlushRef.current = onFlush;
  const savedRef = useRef('');
  // 失焦已经发出去的标题 / 描述(按 id + 字段 + 值):关详情 / 换卡 / 归档时不再发第二次。
  const sent = useRef(new Set<string>());
  const sentKey = (id: string, field: TextField, value: unknown) => `${id}\u0000${field}\u0000${JSON.stringify(value)}`;
  // 底部「已保存」小提示(属性自动保存、标题 / 描述失焦保存成功后出现,一会儿自己消失)。
  const [toast, setToast] = useState<number | null>(null);
  useEffect(() => {
    if (toast === null) return;
    const timer = setTimeout(() => setToast(null), SAVED_TOAST_MS);
    return () => clearTimeout(timer);
  }, [toast]);
  const showSaved = () => setToast(Date.now());
  // 头部状态 / 优先级 pill 点开的选择行。
  const [menu, setMenu] = useState<'status' | 'priority' | null>(null);
  const flushTyped = (forItem: Requirement) => {
    const all = editPatch(forItem, draftRef.current);
    if (!all || !onFlushRef.current) return;
    const typed: EditPatch = {};
    if (all.name !== undefined) typed.name = all.name;
    if (all.description !== undefined) typed.description = all.description;
    for (const f of ['name', 'description'] as const) if (typed[f] !== undefined && sent.current.has(sentKey(forItem.id, f, typed[f]))) delete typed[f];
    if (!Object.keys(typed).length) return;
    const key = `${forItem.id}\u0000${JSON.stringify(typed)}`;
    if (key === savedRef.current || !checkDraft(draftRef.current).ok) return;
    savedRef.current = key;
    onFlushRef.current(forItem.id, typed);
  };
  useEffect(() => () => flushTyped(shown.current), []);
  useEffect(() => {
    const prev = shown.current;
    shown.current = item;
    if (prev.id !== item.id) { flushTyped(prev); setDraft(editDraftOf(item)); setError(null); setSaved(false); setRoleSave(null); setFieldSave(null); setMenu(null); setToast(null); sent.current.clear(); return; }
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
  const rawPatch = editPatch(item, draft);
  // 失焦时已经发出去、Hub 还没回新行的标题 / 描述不算「没存」(否则关详情会再发一次)。
  const patch = (() => {
    if (!rawPatch) return null;
    const p: EditPatch = { ...rawPatch };
    for (const f of ['name', 'description'] as const) if (p[f] !== undefined && sent.current.has(sentKey(item.id, f, p[f]))) delete p[f];
    return Object.keys(p).length ? p : null;
  })();
  const set = (p: Partial<EditDraft>) => { setDraft(d => ({ ...d, ...p })); setSaved(false); if (error) setError(null); };
  /** 返回 true = 没有要存的,或存上了。 */
  const save = async (): Promise<boolean> => {
    if (!patch) return true;
    if (saving) return false;
    const c = checkDraft(draft);
    if (!c.ok) { setError({ field: c.field, message: validationText(c.message) }); return false; }
    const badStart = patch.start !== undefined ? startError(patch.start) : null;
    if (badStart) { setError({ field: 'start', message: validationText(badStart) }); return false; }
    setSaving(true);
    const failed = await onSave(patch);
    setSaving(false);
    if (failed) { setError({ field: patch.parent_id !== undefined && (failed === PARENT_TOO_DEEP || failed === PARENT_REJECTED) ? 'parent' : 'submit', message: failed }); return false; }
    setSaved(true);
    const typed: EditPatch = {};
    if (patch.name !== undefined) typed.name = patch.name;
    if (patch.description !== undefined) typed.description = patch.description;
    savedRef.current = `${item.id}\u0000${JSON.stringify(typed)}`;
    return true;
  };
  // 关详情(✕ / 返回 / 系统返回):还有没存的修改(标题、描述)就先存上再关;存不上(标题空、Hub 拒绝)留在详情里显示原因。
  // 以前直接关掉,改了的东西悄悄丢了(任务页审计 2026-10-02 H1)。
  const close = async () => {
    if (await save()) onClose();
  };
  // 负责人 / 负责 Agent:选完立即保存,不进草稿(草稿里的这两个字段永远等于卡上的值,「保存修改」不会再带它们)。
  const [roleSave, setRoleSave] = useState<{ state: 'saving' | 'saved' } | { state: 'error'; message: string } | null>(null);
  // 优先级 / 项目 / 预计完成 / 开始 / 母任务:选完立即保存,只发这一个字段 —— 和状态、负责人、看板卡片菜单、列表格子一样。
  // 以前它们进草稿等「保存修改」,不点就关详情 = 改了白改(任务页审计 2026-10-02 H1)。标题和描述(打字)仍走草稿 + 关时自动存。
  const [fieldSave, setFieldSave] = useState<{ state: 'saving' | 'saved' } | { state: 'error'; message: string } | null>(null);
  const saveField = async (p: Partial<Pick<EditDraft, 'priority' | 'projectId' | 'due' | 'start' | 'parentId'>>) => {
    setDraft(d => ({ ...d, ...p }));
    setSaved(false);
    if (error && error.field !== 'name') setError(null);
    const base = editDraftOf(item);
    const one = editPatch(item, { ...base, ...p });
    if (!one) return;
    const c = checkDraft({ ...base, ...p });
    if (!c.ok) { setError({ field: c.field, message: validationText(c.message) }); return; }
    const badStart = one.start !== undefined ? startError(one.start) : null;
    if (badStart) { setError({ field: 'start', message: validationText(badStart) }); return; }
    const id = item.id;
    setFieldSave({ state: 'saving' });
    const failed = await onSave(one);
    if (shown.current.id !== id) return;
    if (failed) {
      // 没存上:这个字段退回卡上的值,原因就地说(母任务的原因在「更多」里)。
      setDraft(d => ({ ...d, ...Object.fromEntries(Object.keys(p).map(k => [k, editDraftOf(shown.current)[k as keyof EditDraft]])) }));
      if (one.parent_id !== undefined && (failed === PARENT_TOO_DEEP || failed === PARENT_REJECTED)) setError({ field: 'parent', message: failed });
      setFieldSave({ state: 'error', message: failed });
    } else { setFieldSave({ state: 'saved' }); showSaved(); }
  };
  // 标题 / 描述:离开输入框时保存(只发这一个字段);Esc 放弃这次改动。
  const saveText = async (field: TextField) => {
    const one = blurPatch(item, draftRef.current, field);
    if (!one) return;
    if (field === 'name') {
      const c = checkDraft(draftRef.current);
      if (!c.ok && c.field === 'name') { setError({ field: 'name', message: validationText(c.message) }); return; }
    }
    const key = sentKey(item.id, field, one[field]);
    if (sent.current.has(key)) return;
    sent.current.add(key);
    const id = item.id;
    setFieldSave({ state: 'saving' });
    const failed = await onSave(one);
    if (shown.current.id !== id) return;
    if (failed) { sent.current.delete(key); setError({ field: field === 'name' ? 'name' : 'submit', message: failed }); setFieldSave(null); }
    else { setFieldSave({ state: 'saved' }); showSaved(); }
  };
  const cancelText = (field: TextField) => {
    setDraft(d => escapeDraft(shown.current, d, field));
    if (error?.field === 'name' && field === 'name') setError(null);
  };
  const assignRole = async (p: { owner?: RequirementPersonRef | null; agentOwner?: RequirementPersonRef | null }) => {
    let change: AssignChange | null = null;
    if (p.owner !== undefined) change = ownerChange(item, p.owner ? [p.owner] : []);
    else if (p.agentOwner !== undefined && (item.agentOwner ? personKey(item.agentOwner) : '') !== (p.agentOwner ? personKey(p.agentOwner) : '')) change = { agentOwner: p.agentOwner };
    if (!change) return;
    const id = item.id;
    setRoleSave({ state: 'saving' });
    const failed = await onAssign(change);
    if (shown.current.id !== id) return;
    setRoleSave(failed ? { state: 'error', message: failed } : { state: 'saved' });
    if (!failed) showSaved();
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

  // 「更多」收起时,里面有值的字段在「更多」那一行上用一行字说出来(task-detail-more.ts),不悄悄藏掉。
  const summary = moreSummary(item, draft, items);
  // 母任务被 Hub 拒绝、开始日期不对:错误在「更多」里,自动展开,不能藏着。
  // 参与人的卡:整块不再锁死,改成逐块锁 —— 状态、「更多」开关、检查项能点,别的照只读(看得见、点不动)。
  // RN 原生上父级 pointerEvents=none 会连子级一起吃掉,所以不能「父锁子开」,只能把锁的几块各包一层。
  const partial = readOnly && !!editFields?.length;
  const moreShown = moreOpen || error?.field === 'parent' || error?.field === 'start';
  const canColumn = !readOnly || !!editFields?.includes('column');
  const canChecklist = !readOnly || !!editFields?.includes('checklist');
  const tokens = drawerTokens();
  // 抽屉 / 窗口够宽就两栏;手机推入页一栏。
  const [panelWidth, setPanelWidth] = useState(0);
  const twoColumns = mode !== 'page' && drawerColumns(panelWidth) === 2;
  const [linkCopied, setLinkCopied] = useState(false);
  useEffect(() => { setLinkCopied(false); }, [item.id]);
  const copyLink = async () => {
    // 第一次复制时才加载剪贴板模块(同 TaskIdChip:详情被只装了 react 的测试镜像渲染)。
    try { const Clipboard = await import('expo-clipboard'); await Clipboard.setStringAsync(taskLink(item, networkId ?? cfg.networkId)); } catch { return; }
    setLinkCopied(true);
    setTimeout(() => setLinkCopied(false), SAVED_TOAST_MS);
  };
  // 描述是一整块编辑器(富文本 / 源码 / 全屏):web 上看焦点有没有离开这一块、块里按 Esc;原生上看内联输入框的失焦。
  const descBox = useRef<any>(null);
  const titleRef = useRef<any>(null);
  const textHandlers = useRef({ saveText, cancelText });
  textHandlers.current = { saveText, cancelText };
  useEffect(() => {
    const el = descBox.current;
    if (Platform.OS !== 'web' || !el?.addEventListener) return;
    const onFocusOut = (e: any) => { if (!e.relatedTarget || !el.contains?.(e.relatedTarget)) void textHandlers.current.saveText('description'); };
    const onKey = (e: any) => {
      if (e.key !== 'Escape' && e.key !== 'Esc') return;
      textHandlers.current.cancelText('description');
      e.target?.blur?.();
    };
    el.addEventListener('focusout', onFocusOut);
    el.addEventListener('keydown', onKey);
    return () => { el.removeEventListener('focusout', onFocusOut); el.removeEventListener('keydown', onKey); };
  }, [item.id, hasDetails(item)]);

  const checklistBlock = hasDetails(item) ? (
            <View pointerEvents={canChecklist ? 'auto' : 'none'} testID="req-checklist-wrap">
              <TaskChecklist
                items={item.checklist ?? []}
                pointer={pointer}
                onToggle={onChecklistToggle}
                onAdd={onChecklistAdd}
                onDelete={onChecklistDelete}
                onMove={onChecklistMove}
                error={checklistError}
                readOnly={!canChecklist}
              />
            </View>
  ) : null;

  // ── 左栏:描述 · 子任务 · 动态 ───────────────────────────────────────────────────────────
  const description = (
    <Locked on={readOnly} testID="req-locked-description" rows={readOnly ? lockedMainRows(item, people, projects).filter(r => r.key === 'description') : undefined}>
      {hasDetails(item) ? (
        <View ref={descBox} collapsable={false} testID="req-description-box">
          <TaskDescriptionEditor cfg={cfg} value={draft.description} onChange={description => set({ description })} pointer={pointer} title={item.name} dirty={!!patch} onOpenVoiceSettings={onOpenVoiceSettings} onInlineBlur={Platform.OS === 'web' ? undefined : () => { void saveText('description'); }} />
        </View>
      ) : (
        // 精简列表的卡:全文正在按 id 补读(RequirementBoard);旧 Hub 才是真的不支持。
        item.summary
          ? <Text style={s.muted} testID="req-details-loading">{tr('detail.loadingDetails')}</Text>
          : <Text style={s.muted} testID="req-details-unsupported">{tr('tasks.copy.138')}</Text>
      )}
    </Locked>
  );
  const subtasks = (
    // 检查项和子任务各自带小标题(TaskChecklist / SubRequirements),这里不再加一层。
    <View style={{ gap: spacing.lg }} testID="req-section-subtasks">
      {checklistBlock}
      <Locked on={readOnly} testID="req-locked-children" rows={readOnly ? lockedMoreRows(item, items).filter(r => r.key === 'children') : undefined}>
        <SubRequirements item={item} items={items} onOpen={onOpenRequirement} onCreateChild={onCreateChild} canAddLevel={levelIn(items, item) < 5} />
      </Locked>
    </View>
  );
  // 评论 / 进展(#474):只读,Agent 经 MCP 发、人经 REST 发;旧 Hub / 没有评论时不画。
  const activity = (
    <Section title={tr('taskDrawer.activity')} testID="req-section-activity">
      <TaskComments key={`comments:${item.id}`} cfg={cfg} requirementId={item.id} people={people ?? []} onLoadPeople={onLoadPeople} />
    </Section>
  );

  // ── 右栏:属性(改完立即保存)+ 更多 ───────────────────────────────────────────────────────
  const properties = (
    <View style={{ gap: spacing.lg }} testID="req-properties">
      <Locked on={readOnly} testID="req-locked-main" rows={readOnly ? lockedMainRows(item, people, projects).filter(r => r.key !== 'description' && r.key !== 'priority') : undefined}>
      <RoleFields
        twoRoles={hasRoles(item)}
        owner={draft.owner}
        agentOwner={draft.agentOwner}
        people={people}
        peopleLoading={peopleLoading}
        networkId={cfg.networkId || ''}
        onLoadPeople={onLoadPeople}
        onChange={p => { void assignRole(p); }}
        idBase="req-edit-owner"
        pointer={pointer}
        ownerLocked={legacy ? (
          <>
            <Text style={{ color: colors.text, fontSize: typeScale.body }}>{item.assignee || tr('tasks.copy.6')}</Text>
            <Text style={s.muted} testID="req-owner-unsupported">{tr('tasks.copy.137')}</Text>
          </>
        ) : undefined}
      />
      {roleSave?.state === 'error' ? <Text style={s.err} accessibilityRole="alert" testID="req-assign-error">{roleSave.message}</Text>
        : roleSave?.state === 'saving' ? <Text style={s.muted} accessibilityLiveRegion="polite" testID="req-assign-status">{tr('tasks.copy.13')}</Text> : null}
      {!legacy ? (
        <View testID="req-participants-row">
          <Field label={tr('tasks.copy.53')}>
            <RequirementAssignmentsEditor key={item.id} cfg={cfg} item={item} fields="participants" onSaved={a => { onAssignmentsSaved(a); showSaved(); }} pointer={pointer} />
          </Field>
        </View>
      ) : null}
      {projects && item.projectId !== undefined ? <ProjectSelect value={draft.projectId} projects={projects} onChange={projectId => { void saveField({ projectId }); }} touch={!pointer} idBase="req-edit-project" /> : null}
      <Field label={tr('tasks.copy.119')}>
        <DueField value={draft.due} onChange={due => { void saveField({ due }); }} error={error?.field === 'due' ? error.message : undefined} idBase="req-edit-due" allowTime={dueDatetime} pointer={pointer} sheet={mode === 'page'} />
      </Field>
      </Locked>
      <Locked on={readOnly} testID="req-locked-tags" rows={readOnly ? lockedRestRows(item, people).filter(r => r.key === 'tags') : undefined}>
        <TaskTags key={`tags:${item.id}`} cfg={cfg} item={item} onSave={async p => { const failed = await onSave(p); if (!failed) showSaved(); return failed; }} />
      </Locked>
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
          <Locked on={readOnly} testID="req-locked-more" rows={readOnly ? lockedMoreRows(item, items).filter(r => r.key !== 'children') : undefined}>
          {/* 开始(甘特图的条从这里画):只有带 start 字段的 Hub(capability start_date)才有;只到日。 */}
          {item.start !== undefined ? (
            <Field label={tr('detail.start')}>
              <DueField value={draft.start} onChange={start => { void saveField({ start }); }} error={error?.field === 'start' ? error.message : undefined} idBase="req-edit-start" pointer={pointer} sheet={mode === 'page'} />
            </Field>
          ) : null}
          <ParentSelect item={item} items={items} value={draft.parentId} onChange={parentId => { void saveField({ parentId }); }} touch={!pointer} idBase="req-edit-parent" error={error?.field === 'parent' ? error.message : undefined} />
          </Locked>
          <Locked on={readOnly} testID="req-locked-rest" rows={readOnly ? lockedRestRows(item, people).filter(r => r.key !== 'tags') : undefined}>
          <TaskIssueBindings key={item.id} item={item} onSave={onSave} />
          {!item.externalUrl || !parseIssue(item.externalUrl, false) ? <ExternalLink item={item} /> : null}
          {item.createdAt ? <Text style={s.muted}>{tr('tasks.copy.139')}{item.createdAt.slice(0, 10)}</Text> : null}
          {onArchive && !item.archived ? (
            // 没存的标题 / 描述先存上再归档(和关详情一样),免得归档把它们带走。
            <Pressable accessibilityRole="button" onPress={() => { void save().then(ok => { if (ok) onArchive(true); }); }} style={state => [{ alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 36, paddingHorizontal: spacing.md, borderRadius: radius.control, borderWidth: 1, borderColor: colors.border }, ((state as { hovered?: boolean }).hovered || state.pressed) && { backgroundColor: colors.rowHover }]} testID="req-archive">
              <Ionicons name="archive-outline" size={15} color={colors.textSecondary} />
              <Text style={{ color: colors.text, fontSize: typeScale.small }}>{tr('archive.detailAction')}</Text>
            </Pressable>
          ) : null}
          </Locked>
          {/* 外部链接只是个链接(看,不改):参与人的卡上也照样能点。 */}
          {readOnly && (!item.externalUrl || !parseIssue(item.externalUrl, false)) ? <ExternalLink item={item} /> : null}
        </View>
      ) : null}
    </View>
  );

  const banners = (
    <>
      {readOnly ? (
        <View style={[styles.readOnly, { backgroundColor: colors.subtleFill }]} testID="req-detail-read-only">
          <Ionicons name="lock-closed-outline" size={14} color={colors.textSecondary} />
          <Text style={[s.muted, { flex: 1 }]}>{partial ? tr('tasks.partialBanner', { what: tr(readOnlyLabelKey(editFields)) }) : tr('tasks.readOnlyBanner')}</Text>
        </View>
      ) : null}
      {item.archived ? (
        // 归档的卡(搜索「包含已归档」打开的):说清楚它不在看板上,一键恢复(任务页审计 2026-10-02 H2)。
        <View style={[styles.readOnly, { backgroundColor: colors.subtleFill }]} testID="req-archived-banner">
          <Ionicons name="archive-outline" size={14} color={colors.textSecondary} />
          <Text style={[s.muted, { flex: 1 }]}>{tr('archive.banner')}</Text>
          {onArchive ? (
            <Pressable accessibilityRole="button" onPress={() => onArchive(false)} hitSlop={8} style={{ minHeight: 32, justifyContent: 'center', paddingHorizontal: spacing.sm }} testID="req-restore">
              <Text style={{ color: colors.accent, fontSize: typeScale.small, fontWeight: weight.medium }}>{tr('archive.restore')}</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
      <ParentBreadcrumb item={item} items={items} onOpen={onOpenRequirement} />
    </>
  );

  const body: ReactNode = (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: twoColumns ? spacing.lg : spacing.xl, gap: spacing.lg }} keyboardShouldPersistTaps="handled">
      {banners}
      {/* 只读时下面的编辑控件整块不响应(看得见、点不动),而不是让人改完再被 hub 403 退回。 */}
      <View pointerEvents={readOnly && !partial ? 'none' : 'auto'} testID="req-detail-fields" style={twoColumns ? styles.columns : { gap: spacing.xl }}>
        {twoColumns ? (
          <>
            <View style={styles.left} testID="req-detail-left">{description}{subtasks}{activity}</View>
            <View style={[styles.right, { borderLeftColor: tokens.border }]} testID="req-detail-right">{properties}</View>
          </>
        ) : (
          <>{properties}{description}{subtasks}{activity}</>
        )}
      </View>
    </ScrollView>
  );

  // 底部:只在出错 / 保存中时说一句,成功是一个会自己消失的小提示(没有「保存修改」按钮了)。
  const statusLine = error?.field === 'submit' ? <Text style={[s.err, styles.statusLine]} accessibilityRole="alert" testID="req-edit-error">{error.message}</Text>
    : fieldSave?.state === 'error' ? <Text style={[s.err, styles.statusLine]} accessibilityRole="alert" testID="req-field-save-error">{fieldSave.message}</Text>
    : null;
  const toastView = toast !== null ? (
    <View pointerEvents="none" style={[styles.toast, { backgroundColor: tokens.toastBg }, mode === 'page' && { bottom: spacing.xl + safe.paddingBottom }]} accessibilityLiveRegion="polite" testID="req-saved-toast">
      <Ionicons name="checkmark-circle" size={14} color={tokens.toastText} />
      <Text style={{ color: tokens.toastText, fontSize: typeScale.small, fontWeight: weight.medium }}>{tr('taskDrawer.saved')}</Text>
    </View>
  ) : null;
  // 给旧的读屏 / 测试:一行看不见的保存状态(保存中 / 已保存 / 有未保存的修改)。
  const saveStatus = (
    <Text style={styles.srOnly} accessibilityLiveRegion="polite" testID="req-save-status">{saving || fieldSave?.state === 'saving' ? tr('tasks.copy.140') : patch ? tr('tasks.copy.142') : saved || fieldSave?.state === 'saved' || toast !== null ? tr('tasks.copy.141') : ''}</Text>
  );

  // ── 头部:标题 · 状态 / 优先级 pill · #编号 · 复制链接 · 新窗口 · 关闭 ───────────────────────
  const iconButton = (testID: string, icon: string, label: string, onPress: () => void, color = colors.textSecondary) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      {...({ title: label } as object)}
      onPress={onPress}
      style={state => [s.iconButton, ((state as { hovered?: boolean }).hovered || state.pressed) && { backgroundColor: colors.rowHover }]}
      testID={testID}
    >
      <Ionicons name={icon as any} size={17} color={color} />
    </Pressable>
  );
  const pill = (testID: string, dot: ReactNode, label: string, a11y: string, open: boolean, disabled: boolean, onPress: () => void) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={a11y}
      {...a11yState({ expanded: open, disabled })}
      disabled={disabled}
      onPress={onPress}
      style={state => [styles.pill, { backgroundColor: open ? colors.tonalBg : tokens.pillBg }, ((state as { hovered?: boolean }).hovered || state.pressed) && !disabled && { backgroundColor: colors.tonalBg }]}
      testID={testID}
    >
      {dot}
      <Text style={{ color: open ? colors.accent : colors.text, fontSize: typeScale.small, fontWeight: weight.medium }} numberOfLines={1}>{label}</Text>
      {disabled ? null : <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={12} color={colors.textMuted} />}
    </Pressable>
  );
  const statusLabel = taskText(REQ_COLUMN_LABEL[item.column]);
  const head = (
    <View style={[styles.head, { borderBottomColor: tokens.border }]}>
      <View style={styles.headRow}>
        {mode === 'page' ? (
          <Pressable accessibilityRole="button" accessibilityLabel={tr('tasks.copy.144')} onPress={() => { void close(); }} style={[s.iconButton, { marginLeft: -spacing.sm }]} testID="req-detail-close">
            <Ionicons name="chevron-back" size={22} color={colors.text} />
          </Pressable>
        ) : null}
        <View style={{ flex: 1, minWidth: 0 }}>
          <Locked on={readOnly} testID="req-locked-title" title={item.name}>
            <TextInput
              ref={titleRef}
              value={draft.name}
              onChangeText={name => set({ name })}
              onBlur={() => { void saveText('name'); }}
              onKeyPress={e => {
                const key = (e.nativeEvent as { key?: string }).key;
                if (key === 'Escape' || key === 'Esc') { cancelText('name'); titleRef.current?.blur?.(); }
                // 标题是一行字:回车 = 写完了(失焦即保存),不换行。
                else if (key === 'Enter' && Platform.OS === 'web') { e.preventDefault?.(); titleRef.current?.blur?.(); }
              }}
              placeholder={tr('tasks.copy.118')}
              placeholderTextColor={colors.textMuted}
              // web 上多行输入框默认两行高,标题和 pill 之间空一大块;标题最多 80 字,web 用单行(回车 = 写完)。
              multiline={Platform.OS !== 'web'}
              style={[styles.title, { color: colors.text, borderColor: error?.field === 'name' ? colors.failed : 'transparent' }]}
              testID="req-edit-name"
              accessibilityLabel={tr('tasks.copy.118')}
              accessibilityHint={tr('taskDrawer.textHint')}
            />
          </Locked>
        </View>
        {saving || moving || fieldSave?.state === 'saving' ? <ActivityIndicator size="small" color={colors.textMuted} /> : null}
        {iconButton('req-detail-copy-link', linkCopied ? 'checkmark' : 'link-outline', linkCopied ? tr('taskDrawer.linkCopied') : tr('taskDrawer.copyLink'), () => { void copyLink(); }, linkCopied ? colors.accent : colors.textSecondary)}
        {mode === 'drawer' && onOpenWindow ? iconButton('req-detail-open-window', 'open-outline', tr('taskWin.open'), () => { void openWindow(); }) : null}
        {mode === 'drawer' ? iconButton('req-detail-close', 'close', tr('tasks.copy.146'), () => { void close(); }) : null}
      </View>
      {error?.field === 'name' ? <Text style={s.err} accessibilityRole="alert">{error.message}</Text> : null}
      <View style={styles.pillRow}>
        <View pointerEvents={canColumn ? 'auto' : 'none'}>
          {pill('req-status-pill', <View style={[s.prioDot, { backgroundColor: STATUS_TONE[item.column]() }]} />, statusLabel, tr('taskDrawer.status', { v0: statusLabel }), menu === 'status', !canColumn || moving, () => setMenu(m => (m === 'status' ? null : 'status')))}
        </View>
        <View pointerEvents={readOnly ? 'none' : 'auto'}>
          {pill('req-priority-pill', <PriorityDot p={draft.priority} s={s} />, priorityLabel(draft.priority), tr('taskDrawer.priority', { v0: priorityLabel(draft.priority) }), menu === 'priority', readOnly, () => setMenu(m => (m === 'priority' ? null : 'priority')))}
        </View>
        <TaskIdChip item={item} pointer={pointer} />
      </View>
      {menu === 'status' ? (
        <View pointerEvents={canColumn ? 'auto' : 'none'} style={[s.segment, { alignSelf: 'flex-start' }]} accessibilityRole="radiogroup" testID="req-move-group">
          {REQ_COLUMNS.map(col => {
            const on = col === item.column;
            return (
              <Pressable
                key={col}
                accessibilityRole="radio"
                accessibilityLabel={on ? tr('tasks.copy.91', { v0: taskText(REQ_COLUMN_LABEL[col]) }) : tr('tasks.copy.135', { v0: taskText(REQ_COLUMN_LABEL[col]) })}
                {...a11yState({ disabled: moving || on || !canColumn, selected: on, checked: on })}
                disabled={moving || on || !canColumn}
                onPress={() => { onMove(col); setMenu(null); }}
                style={[s.segmentItem, { flexDirection: 'row', gap: 6 }, on && s.segmentItemOn]}
                testID={`req-move-${col}`}
              >
                <View style={[s.prioDot, { backgroundColor: STATUS_TONE[col]() }]} />
                <Text style={[s.segmentText, on && s.segmentTextOn]}>{taskText(REQ_COLUMN_LABEL[col])}</Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}
      {menu === 'priority' ? (
        <View testID="req-priority-row">
          <PriorityPicker value={draft.priority} onChange={priority => { setMenu(null); void saveField({ priority }); }} testPrefix="req-edit-priority" choices={priorityChoices(lowestPriority, item.priority)} />
        </View>
      ) : null}
      {moving ? <Text style={s.muted} accessibilityLiveRegion="polite">{tr('tasks.copy.136')}</Text> : null}
      {moveError ? <Text style={s.err} accessibilityRole="alert">{moveError}</Text> : null}
    </View>
  );

  const content = (
    <>
      {head}
      {body}
      {statusLine}
      {saveStatus}
      {toastView}
    </>
  );
  const onLayout = (e: { nativeEvent: { layout: { width: number } } }) => setPanelWidth(e.nativeEvent.layout.width);

  if (mode === 'window' || mode === 'drawer') {
    // 抽屉的外框(位置、宽度、拖动)是 TaskDrawer;这里只铺满它给的地方。窗口模式铺满整窗。
    return (
      <View style={{ flex: 1, backgroundColor: tokens.bg }} onLayout={onLayout} testID="req-detail" accessibilityViewIsModal={mode === 'drawer'} accessibilityLabel={tr('tasks.copy.145')}>
        {content}
      </View>
    );
  }
  return (
    <Modal visible animationType="slide" onRequestClose={() => { void close(); }} presentationStyle="fullScreen">
      <View style={{ flex: 1, backgroundColor: tokens.bg, paddingTop: safe.paddingTop }} onLayout={onLayout} testID="req-detail" accessibilityViewIsModal>
        {content}
      </View>
    </Modal>
  );
}

/** 正文里的一节(子任务 / 动态):小标题 + 内容。 */
function Section({ title, children, testID }: { title: string; children: ReactNode; testID?: string }) {
  return (
    <View style={{ gap: spacing.sm }} testID={testID}>
      <Text style={{ color: colors.textMuted, fontSize: typeScale.small, fontWeight: weight.medium }}>{title}</Text>
      {children}
    </View>
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
  head: { gap: spacing.sm, paddingHorizontal: spacing.xl, paddingTop: spacing.md, paddingBottom: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth },
  headRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.xs },
  title: { fontSize: typeScale.heading - 2, fontWeight: weight.strong, lineHeight: 26, paddingVertical: 4, paddingHorizontal: 6, marginLeft: -6, borderWidth: 1, borderRadius: radius.item, backgroundColor: 'transparent' },
  pillRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: spacing.sm },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 28, paddingHorizontal: 10, borderRadius: radius.pill },
  // 560 宽的抽屉:左栏要放得下描述编辑器一行工具栏(≈300),右栏固定宽。
  columns: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.lg },
  left: { flex: 1, minWidth: 0, gap: spacing.xl },
  right: { width: 196, flexShrink: 0, gap: spacing.lg, paddingLeft: spacing.md, borderLeftWidth: StyleSheet.hairlineWidth },
  statusLine: { paddingHorizontal: spacing.xl, paddingVertical: spacing.sm },
  toast: { position: 'absolute', alignSelf: 'center', bottom: spacing.xl, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: spacing.md, height: 30, borderRadius: radius.pill, opacity: 0.92 },
  srOnly: { position: 'absolute', width: 1, height: 1, opacity: 0, overflow: 'hidden' },
  readOnly: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.item },
});

/**
 * 参与人的卡上锁住的一块:包一层 pointerEvents=none(看得见、点不动)。不锁时原样返回子节点,布局与以前逐字相同。
 * 放在模块级:在组件里现定义的组件每次渲染都是新类型,会把里面的输入框整个重挂(打一个字丢一次焦点)。
 */
function Locked({ on, children, testID, rows, title }: { on: boolean; children: ReactNode; testID?: string; rows?: readonly LockedRow[]; title?: string }) {
  if (!on) return <>{children}</>;
  // 锁住时不画编辑控件(输入框 / 下拉箭头 / 今天明天 / 富文本工具栏),只画值:看起来能点、点了没反应最糟。
  return (
    <View pointerEvents="none" style={{ gap: spacing.md }} testID={testID}>
      {title !== undefined ? <Text style={{ color: colors.text, fontSize: typeScale.heading - 2, fontWeight: weight.strong }} testID="req-locked-name">{title}</Text> : null}
      {(rows ?? []).map(r => (
        <View key={r.key} style={{ gap: 4 }} testID={`req-locked-row-${r.key}`}>
          <Text style={{ color: colors.textMuted, fontSize: typeScale.small, fontWeight: weight.medium }}>{r.label}</Text>
          <Text style={{ color: colors.textSecondary, fontSize: typeScale.body, lineHeight: 20 }} numberOfLines={r.multiline ? 12 : 2}>{r.value}</Text>
        </View>
      ))}
    </View>
  );
}
