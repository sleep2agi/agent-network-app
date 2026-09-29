// 任务页(需求池):头部一行 + 看板 / 列表 + 新建对话框 + 详情(桌面右侧抽屉,手机推入一页)。
//
// Owner 2026-09-29(0.2.137 截图):「这个任务列表也他妈太难看了…你自己搞搞吧」—— 三个常驻的整行输入框、
// 一行开发者说明、三列白框挤在左边右边一大片空、卡片上一个「查看详情」蓝字链接。现在参照 Linear / TickTick:
//   · 头部:任务 · 列表/看板 · 负责人 / 优先级筛选 · ＋ 新建(新建是对话框 / 手机底部面板,不再常驻)
//   · 看板:三列等分整个内容宽,列头名字 + 数目胶囊,列尾「＋ 添加」直接建在这一列
//   · 卡片:标题(最多两行)+ 优先级点 · 负责人头像 · 期限胶囊(逾期红),整张可点
//   · 换状态:桌面拖动(落点指示线)/ 右键菜单 / Shift+←→;手机长按菜单或详情里的状态,没有拖动
// 数据仍是 Hub 的 requirements(GET / POST / PATCH),负责人只存稳定身份 {kind,id}(#484),assignee 永远空。
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ActivityIndicator, Modal, Platform, Pressable, ScrollView, View } from 'react-native';
import { Text, TextInput } from './ui-text';
import { Ionicons } from './icons';
import AliasAvatar from './AliasAvatar';
import type { HubConfig } from './api';
import { REQ_COLUMN_LABEL, REQ_COLUMNS, REQ_PRIORITIES, REQ_PRIORITY_LABEL, type ChecklistItem, type ReqColumn, type Requirement, type RequirementProject } from './requirements-model';
import { readRequirements, requirementsKey, writeRequirements } from './requirements-store';
import { createProject, createRequirementOnHub, fetchMyUserId, listProjects, setChecklistItemOnHub, updateProject, listRequirements, migrateLocalRequirements, moveRequirementOnHub, probeAgentOwnerSupport, RequirementsHubError, updateRequirementOnHub } from './requirements-hub';
import { listRequirementPeople } from './requirement-people-api';
import { personKey } from './requirement-people';
import { colors, radius, spacing } from './theme';
import { elevated } from './elevation';
import { pointerUi } from './pointer-ui';
import { useModalSafePadding } from './safe-area-runtime';
import { usePoll } from './usePoll';
import {
  applyFilter, applyMove, boardColumns, createInput, DEFAULT_SORT, DRAG_IDLE, dragReduce, dropIndex, emptyDraft,
  activeProjects, defaultProjectFor, NO_PROJECT, projectCounts,
  filterActive, hasRoles, localToday, addChecklistItem, moveChecklistItem, removeChecklistItem, setChecklistDone, neighbourColumn, nextSort, ownerCounts, ownerLabel, revertMove, sortRows, toggleIn, UNASSIGNED,
  type CreateDraft, type DragEvent, type DragState, type EditPatch, type SortKey, type SortSpec,
} from './task-board-model';
import { enterTaskScope, patchTaskBoard, setManagingProjects, setTaskFilter, setTaskSection, taskScopeKey, updateTaskItems, useTaskBoard, type TaskSection } from './task-board-store';
import { CardMeta, ChecklistProgress, Chip, ProjectChip, DueChip, OwnerBadge, PriorityDot, Segmented, STATUS_TONE, useTaskStyles, type TaskStyles, a11yState } from './TaskBoardParts';
import TaskCreateDialog from './TaskCreateDialog';
import TaskDetailPanel from './TaskDetailPanel';
import TaskCardMenu, { type TaskMenuTarget } from './TaskCardMenu';
import TaskProjectManager from './TaskProjectManager';
import { setDraggingCursor, useTaskCardDom } from './task-board-dom';

const UNSUPPORTED = '这个 Hub 还没有需求池。升级 Hub 之后，手机和电脑才能看到同一份。';
/** 别的设备改了也要看得到;有未完成的写入时跳过这一轮(不拿旧数据盖掉乐观更新)。 */
const POLL_MS = 15_000;
/** 内容区窄于这个宽度:看板改成横向一列一屏,详情改成推入页。 */
const NARROW = 700;
const DRAWER_MIN = 860;

/** 筛选键(user:… / node:…)对应的名字:没有卡片的人不在 ownerCounts 里,从成员表取。 */
const keyName = (key: string, people: readonly { kind: string; id: string; name: string }[]) =>
  people.find(p => `${p.kind}:${p.id}` === key)?.name || key.split(':').slice(1).join(':') || '负责人';

const moveErrorText = (e: unknown) => (e instanceof RequirementsHubError && e.status === 403 ? '你没有修改这条需求的权限' : '状态未保存，请重试');

export default function RequirementBoard(props: { cfg: HubConfig; desktop?: boolean; dispatch?: ReactNode }) {
  const { cfg } = props;
  return <ScopedRequirementBoard key={taskScopeKey(cfg)} {...props} />;
}

function ScopedRequirementBoard({ cfg, desktop, dispatch }: { cfg: HubConfig; desktop?: boolean; dispatch?: ReactNode }) {
  const s = useTaskStyles();
  const scope = taskScopeKey(cfg);
  useLayoutEffect(() => { enterTaskScope(scope); }, [scope]);
  const mine = useTaskBoard(st => st.scope === scope);
  const storeItems = useTaskBoard(st => st.items);
  const storePeople = useTaskBoard(st => st.people);
  const meId = useTaskBoard(st => (st.scope === scope ? st.meId : null));
  const section = useTaskBoard(st => st.section);
  const twoRoles = useTaskBoard(st => (st.scope === scope ? st.twoRoles === true : false));
  const projects = useTaskBoard(st => (st.scope === scope ? st.projects : null));
  const managingProjects = useTaskBoard(st => st.managingProjects);
  const filter = useTaskBoard(st => st.filter);
  const items = mine ? storeItems : [];
  const people = mine ? storePeople : [];
  const pointer = pointerUi(desktop);
  const localKey = requirementsKey(cfg.profileId || cfg.username || 'local');

  const [width, setWidth] = useState(0);
  const narrow = width > 0 && width < NARROW;
  const drawer = width >= DRAWER_MIN;
  const [headerBottom, setHeaderBottom] = useState(0);
  const [phase, setPhase] = useState<'loading' | 'ready' | 'unsupported' | 'error'>('loading');
  const [hubError, setHubError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const [peopleLoading, setPeopleLoading] = useState(false);
  const [peopleError, setPeopleError] = useState('');
  const [draft, setDraft] = useState<CreateDraft | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [movingIds, setMovingIds] = useState<string[]>([]);
  const [moveErrors, setMoveErrors] = useState<Record<string, string>>({});
  const [banner, setBanner] = useState('');
  const [menu, setMenu] = useState<TaskMenuTarget | null>(null);
  const [sort, setSort] = useState<SortSpec>(DEFAULT_SORT);
  const [filterMenu, setFilterMenu] = useState<{ kind: 'owner' | 'priority' | 'project'; x: number; y: number } | null>(null);
  const [quickAdd, setQuickAdd] = useState<{ column: ReqColumn; name: string } | null>(null);
  const [announce, setAnnounce] = useState('');
  const pendingMoves = useRef(new Set<string>());
  const mutations = useRef(0);
  const inFlight = useRef(0);
  const today = localToday();
  const selected = items.find(item => item.id === selectedId) || null;

  // ── 读 Hub ──
  useEffect(() => {
    let dead = false;
    setPhase('loading');
    (async () => {
      try {
        await migrateLocalRequirements(cfg, () => readRequirements(localKey), rows => writeRequirements(localKey, rows));
        const list = await listRequirements(cfg);
        if (dead) return;
        // 分不分两个角色:有卡片就看行里带没带 agent_owner;一张都没有才去探 Hub。
        const roles = list.length ? list.some(hasRoles) : await probeAgentOwnerSupport(cfg);
        if (dead) return;
        // 项目:旧 Hub 没有这个路由 → null,界面把项目整个藏起来;读失败也按没有处理,不挡看板。
        const projectList = await listProjects(cfg).catch(() => null);
        if (dead) return;
        patchTaskBoard(scope, { items: list, loaded: true, twoRoles: roles, projects: projectList });
        setPhase('ready');
        setHubError('');
      } catch (e) {
        if (dead) return;
        if (e instanceof RequirementsHubError && e.status === 404) { setPhase('unsupported'); return; }
        setPhase('error');
        setHubError(e instanceof Error ? e.message : '需求池打不开');
      }
    })();
    void fetchMyUserId(cfg).then(id => { if (!dead) patchTaskBoard(scope, { meId: id }); });
    return () => { dead = true; };
  }, [cfg.serverUrl, cfg.token, cfg.networkId, localKey, reloadKey, scope]);

  // 有卡片带稳定负责人时读一次成员(卡片上的名字 / 头像、筛选里的人都从这里来)。
  const hasOwners = items.some(item => item.owner || item.agentOwner);
  useEffect(() => {
    if (!hasOwners || !cfg.networkId) return;
    let dead = false;
    listRequirementPeople(cfg).then(rows => { if (!dead) patchTaskBoard(scope, { people: rows }); }).catch(() => {});
    return () => { dead = true; };
  }, [cfg.serverUrl, cfg.token, cfg.networkId, hasOwners, scope]);

  const refresh = useCallback(async () => {
    if (phase !== 'ready' || inFlight.current > 0 || drag.current.phase !== 'idle') return;
    const gen = mutations.current;
    try {
      const list = await listRequirements(cfg);
      if (gen === mutations.current && inFlight.current === 0) patchTaskBoard(scope, { items: list });
    } catch { /* 下一轮再试;看板保留上次的 */ }
  }, [cfg, phase, scope]);
  usePoll(refresh, POLL_MS, [refresh]);

  const loadPeople = async (): Promise<boolean> => {
    if (peopleLoading) return false;
    setPeopleLoading(true);
    setPeopleError('');
    try {
      patchTaskBoard(scope, { people: await listRequirementPeople(cfg) });
      return true;
    } catch (e) {
      setPeopleError(e instanceof Error ? e.message : '人员列表加载失败，请重试');
      return false;
    } finally {
      setPeopleLoading(false);
    }
  };

  // ── 写 Hub ──
  const track = async <T,>(fn: () => Promise<T>): Promise<T> => {
    mutations.current += 1;
    inFlight.current += 1;
    try { return await fn(); } finally { inFlight.current -= 1; }
  };

  const move = async (id: string, to: ReqColumn) => {
    const item = items.find(row => row.id === id);
    if (!item || item.column === to || pendingMoves.current.has(id)) return;
    const from = item.column;
    pendingMoves.current.add(id);
    setMovingIds(ids => [...ids, id]);
    setMoveErrors(({ [id]: _, ...rest }) => rest);
    updateTaskItems(scope, rows => applyMove(rows, id, to));
    setAnnounce(`「${item.name}」已移到${REQ_COLUMN_LABEL[to]}`);
    try {
      const updated = await track(() => moveRequirementOnHub(cfg, id, to));
      updateTaskItems(scope, rows => rows.map(row => (row.id === id ? updated : row)));
    } catch (e) {
      updateTaskItems(scope, rows => revertMove(rows, id, from, to));
      const message = moveErrorText(e);
      setMoveErrors(prev => ({ ...prev, [id]: message }));
      setBanner(`「${item.name}」${message}`);
    } finally {
      pendingMoves.current.delete(id);
      setMovingIds(ids => ids.filter(x => x !== id));
    }
  };

  const create = async (d: CreateDraft): Promise<string | null> => {
    const input = createInput(d, twoRoles);
    if (!input) return '先写任务标题';
    try {
      const created = await track(() => createRequirementOnHub(cfg, input));
      updateTaskItems(scope, rows => [created, ...rows.filter(row => row.id !== created.id)]);
      setAnnounce(`已新建「${created.name}」`);
      return null;
    } catch (e) {
      return e instanceof Error ? e.message : '没有存到 Hub';
    }
  };

  // ── 子任务:勾选只改那一项(单项接口),增删排序改整张清单;都先乐观更新,失败退回 ──
  const [checklistErrors, setChecklistErrors] = useState<Record<string, string>>({});
  const setChecklistLocal = (id: string, next: ChecklistItem[]) => updateTaskItems(scope, rows => rows.map(row => (row.id === id ? { ...row, checklist: next } : row)));
  const replaceChecklist = async (id: string, next: ChecklistItem[]) => {
    const prev = items.find(row => row.id === id)?.checklist;
    if (!prev) return;
    setChecklistErrors(({ [id]: _, ...rest }) => rest);
    setChecklistLocal(id, next);
    try {
      const updated = await track(() => updateRequirementOnHub(cfg, id, { checklist: next }));
      setChecklistLocal(id, updated.checklist ?? next);
    } catch (e) {
      setChecklistLocal(id, prev);
      setChecklistErrors(errs => ({ ...errs, [id]: e instanceof Error ? e.message : '子任务没有保存，请重试' }));
    }
  };
  const toggleChecklist = async (id: string, itemId: string, done: boolean) => {
    const list = items.find(row => row.id === id)?.checklist;
    if (!list) return;
    setChecklistErrors(({ [id]: _, ...rest }) => rest);
    updateTaskItems(scope, rows => rows.map(row => (row.id === id && row.checklist ? { ...row, checklist: setChecklistDone(row.checklist, itemId, done) } : row)));
    try {
      const updated = await track(() => setChecklistItemOnHub(cfg, id, itemId, done));
      if (updated.checklist) setChecklistLocal(id, updated.checklist);
    } catch (e) {
      updateTaskItems(scope, rows => rows.map(row => (row.id === id && row.checklist ? { ...row, checklist: setChecklistDone(row.checklist, itemId, !done) } : row)));
      setChecklistErrors(errs => ({ ...errs, [id]: e instanceof Error ? e.message : '子任务没有保存，请重试' }));
    }
  };

  const saveEdit = async (id: string, patch: EditPatch): Promise<string | null> => {
    try {
      const updated = await track(() => updateRequirementOnHub(cfg, id, patch));
      updateTaskItems(scope, rows => rows.map(row => (row.id === id ? updated : row)));
      return null;
    } catch (e) {
      return e instanceof Error ? e.message : '修改没有保存，请重试';
    }
  };

  // 新建时带上当前筛选:在「我负责的」/ 某个节点下建,负责人默认就是它;只筛了一个优先级也带上。
  const draftFor = (column: ReqColumn): CreateDraft => {
    const d = emptyDraft(column);
    const only = filter.owners.length === 1 ? filter.owners[0] : null;
    if (only && only !== UNASSIGNED) {
      const [kind, ...rest] = only.split(':');
      const ref = { kind, id: rest.join(':') } as const;
      // 在某个 Agent 下建:分两个角色的 Hub 上它是负责 Agent;旧 Hub 上是唯一的负责人。
      if (kind === 'node' && twoRoles) d.agentOwner = { kind: 'node', id: ref.id };
      else if (kind === 'user' || kind === 'node') d.owner = { kind, id: ref.id };
    }
    if (filter.priorities.length === 1) d.priority = filter.priorities[0];
    if (projects) d.projectId = defaultProjectFor(filter, projects);
    return d;
  };

  // ── 拖动(只在桌面)──
  const drag = useRef<DragState>(DRAG_IDLE);
  const [dragView, setDragView] = useState<DragState>(DRAG_IDLE);
  const grab = useRef({ dx: 0, dy: 0, w: 240 });
  const swallow = useRef(false);
  const onDrag = (ev: DragEvent, g?: { dx: number; dy: number; w: number }) => {
    if (g) grab.current = g;
    const before = drag.current;
    const step = dragReduce(before, ev);
    drag.current = step.state;
    if (step.swallowClick) { swallow.current = true; setTimeout(() => { swallow.current = false; }, 0); }
    if (step.state.phase === 'dragging' || before.phase === 'dragging') setDragView(step.state);
    if ((step.state.phase === 'dragging') !== (before.phase === 'dragging')) setDraggingCursor(step.state.phase === 'dragging');
    if (step.commit) void move(step.commit.id, step.commit.to);
  };
  useEffect(() => () => setDraggingCursor(false), []);
  const focusCard = (id: string) => setTimeout(() => {
    const el = (globalThis as { document?: any }).document?.querySelector?.(`[data-task-card="${id}"]`);
    el?.focus?.();
  }, 30);
  useTaskCardDom(pointer && phase === 'ready' && section !== 'dispatch' && !selectedId && !draft && !menu, {
    onDrag,
    dragging: () => drag.current.phase === 'dragging',
    onContextMenu: (id, x, y) => {
      const item = items.find(row => row.id === id);
      if (item) setMenu({ id, title: item.name, column: item.column, x, y });
    },
    onKeyMove: (id, dir) => {
      const item = items.find(row => row.id === id);
      const to = item && neighbourColumn(item.column, dir);
      if (item && to) { void move(id, to); focusCard(id); }
    },
  });

  const openDetail = (id: string) => { if (!swallow.current) setSelectedId(id); };
  const openMenuAt = (item: Requirement, x: number, y: number) => setMenu({ id: item.id, title: item.name, column: item.column, x, y });

  // ── 视图 ──
  const visible = useMemo(() => applyFilter(items, filter), [items, filter]);
  const columns = useMemo(() => boardColumns(items, filter), [items, filter]);
  const owners = useMemo(() => ownerCounts(items, people), [items, people]);
  const draggingItem = dragView.phase === 'dragging' ? items.find(row => row.id === dragView.id) || null : null;

  const sections: { key: TaskSection; label: string }[] = [
    { key: 'list', label: '列表' },
    { key: 'board', label: '看板' },
    // 桌面的派发记录在左栏(TaskFilterSidebar);手机 / 双栏没有左栏,放在分段里。
    ...(desktop ? [] : [{ key: 'dispatch' as const, label: '派发记录' }]),
  ];
  const ownerChipLabel = filter.owners.length === 0 ? '负责人'
    : filter.owners.length === 1 ? (owners.find(o => o.key === filter.owners[0])?.name || (filter.owners[0] === UNASSIGNED ? '未分配' : keyName(filter.owners[0], people)))
      : `负责人 · ${filter.owners.length}`;
  const projectById = new Map((projects ?? []).map(p => [p.id, p]));
  const selectedProject = filter.project && filter.project !== NO_PROJECT ? projectById.get(filter.project) : undefined;
  const projectChipLabel = !filter.project ? '项目' : filter.project === NO_PROJECT ? '无项目' : selectedProject?.name || '项目';
  const counts = useMemo(() => projectCounts(items, filter), [items, filter]);
  const priorityChipLabel = filter.priorities.length === 0 ? '优先级' : filter.priorities.map(p => REQ_PRIORITY_LABEL[p]).join('、');
  const chipRefs = useRef<Record<string, any>>({});
  const openFilter = (kind: 'owner' | 'priority' | 'project') => {
    const el = chipRefs.current[kind];
    const done = (x: number, y: number, h: number) => setFilterMenu({ kind, x, y: y + h + 4 });
    if (el?.measureInWindow) el.measureInWindow((x: number, y: number, _w: number, h: number) => done(x, y, h));
    else done(spacing.xl, 64, 0);
  };
  const filters = section === 'dispatch' ? null : (
    <>
      <View ref={(r: any) => { chipRefs.current.owner = r; }} collapsable={false}>
        <Chip
          s={s}
          label={ownerChipLabel}
          on={filter.owners.length > 0}
          onPress={() => openFilter('owner')}
          testID="task-filter-owner"
          accessibilityLabel={`按负责人筛选，当前：${filter.owners.length ? ownerChipLabel : '全部'}`}
          leading={filter.owners.length ? <AvatarStack keys={filter.owners} owners={owners} /> : <Ionicons name="people-outline" size={14} color={colors.textMuted} />}
        />
      </View>
      <View ref={(r: any) => { chipRefs.current.priority = r; }} collapsable={false}>
        <Chip
          s={s}
          label={priorityChipLabel}
          on={filter.priorities.length > 0}
          onPress={() => openFilter('priority')}
          testID="task-filter-priority"
          accessibilityLabel={`按优先级筛选，当前：${filter.priorities.length ? priorityChipLabel : '全部'}`}
          leading={filter.priorities.length === 1 ? <PriorityDot p={filter.priorities[0]} s={s} /> : <Ionicons name="flag-outline" size={14} color={colors.textMuted} />}
        />
      </View>
      {projects ? (
        <View ref={(r: any) => { chipRefs.current.project = r; }} collapsable={false}>
          <Chip
            s={s}
            label={projectChipLabel}
            on={!!filter.project}
            onPress={() => openFilter('project')}
            testID="task-filter-project"
            accessibilityLabel={`按项目筛选，当前：${filter.project ? projectChipLabel : '全部'}`}
            leading={selectedProject ? <View style={{ width: 8, height: 8, borderRadius: radius.pill, backgroundColor: selectedProject.color }} /> : <Ionicons name="folder-outline" size={14} color={colors.textMuted} />}
          />
        </View>
      ) : null}
      {filterActive(filter) ? (
        <Pressable accessibilityRole="button" onPress={() => setTaskFilter({ owners: [], priorities: [], project: '' })} style={[s.iconButton, { width: undefined, paddingHorizontal: spacing.sm }]} testID="task-filter-clear">
          <Text style={s.link}>清除筛选</Text>
        </Pressable>
      ) : null}
    </>
  );
  const newButton = section === 'dispatch' ? null : narrow ? (
    <Pressable accessibilityRole="button" accessibilityLabel="新建任务" onPress={() => setDraft(draftFor('pool'))} style={[s.primary, { width: 32, paddingHorizontal: 0, justifyContent: 'center' }]} testID="req-new">
      <Ionicons name="add" size={20} color={colors.onAccent} />
    </Pressable>
  ) : (
    <Pressable accessibilityRole="button" accessibilityLabel="新建任务" onPress={() => setDraft(draftFor('pool'))} style={s.primary} testID="req-new">
      <Ionicons name="add" size={16} color={colors.onAccent} />
      <Text style={s.primaryText}>新建</Text>
    </Pressable>
  );

  const header = narrow ? (
    <View onLayout={e => setHeaderBottom(e.nativeEvent.layout.y + e.nativeEvent.layout.height)}>
      <View style={[s.header, s.headerPhone]} testID="task-header">
        <Text style={s.pageTitle} accessibilityRole="header">任务</Text>
        <View style={s.spacer} />
        {newButton}
      </View>
      <View style={{ paddingHorizontal: spacing.lg, paddingBottom: spacing.sm }}>
        <Segmented s={s} items={sections} value={section} onChange={setTaskSection} testID="tasks-view" />
      </View>
      {filters ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.filterRowPhone} contentContainerStyle={s.filterRowPhoneContent}>{filters}</ScrollView>
      ) : null}
    </View>
  ) : (
    <View style={s.header} testID="task-header" onLayout={e => setHeaderBottom(e.nativeEvent.layout.y + e.nativeEvent.layout.height)}>
      <Text style={s.pageTitle} accessibilityRole="header">任务</Text>
      <Segmented s={s} items={sections} value={section} onChange={setTaskSection} testID="tasks-view" />
      {filters}
      <View style={s.spacer} />
      {newButton}
    </View>
  );

  // 桌面三列的列宽(内容宽 - 两侧 24 - 两个 16 的间隙)/ 3;窄于 260 时卡片上的负责人只显示头像。
  const compactCards = !narrow && width > 0 && (width - spacing.xl * 2 - spacing.lg * 2) / 3 < 260;
  const card = (item: Requirement) => {
    const isDragged = draggingItem?.id === item.id;
    return (
      <Pressable
        key={item.id}
        testID={`req-card-${item.id}`}
        accessibilityRole="button"
        accessibilityLabel={`${item.name}，${REQ_PRIORITY_LABEL[item.priority]}优先级，${ownerLabel(item, people)}`}
        accessibilityHint={pointer ? '回车打开详情，Shift 加左右方向键换列' : '打开详情'}
        onPress={() => openDetail(item.id)}
        onLongPress={pointer ? undefined : e => openMenuAt(item, e.nativeEvent.pageX, e.nativeEvent.pageY)}
        delayLongPress={350}
        style={state => [s.card, ((state as { hovered?: boolean }).hovered || state.pressed) && s.cardHover, isDragged && s.cardDragging, pointer && ({ cursor: 'grab' } as object)]}
        {...({ dataSet: { taskCard: item.id, taskFrom: item.column } } as object)}
      >
        {projects && item.projectId ? <ProjectChip project={projectById.get(item.projectId)} s={s} small /> : null}
        <Text style={[s.cardTitle, item.column === 'done' && s.cardDone]} numberOfLines={2}>{item.name}</Text>
        <CardMeta item={item} people={people} today={today} s={s} compact={compactCards} />
        <ChecklistProgress item={item} s={s} />
        {moveErrors[item.id] ? <Text style={s.err} numberOfLines={1}>{moveErrors[item.id]}</Text> : null}
      </Pressable>
    );
  };

  const kanban = () => {
    const over = dragView.phase === 'dragging' && dragView.over !== dragView.from ? dragView.over : null;
    const colWidth = narrow ? Math.max(260, width - spacing.lg * 2 - 28) : undefined;
    const renderColumn = (col: (typeof columns)[number]) => {
      const isOver = over === col.column;
      const at = isOver && draggingItem ? dropIndex(col.items, draggingItem, col.column) : -1;
      const quick = quickAdd?.column === col.column ? quickAdd : null;
      return (
        <View
          key={col.column}
          style={[s.column, isOver && s.columnOver, colWidth ? { flexGrow: 0, flexShrink: 0, flexBasis: 'auto', width: colWidth } : null]}
          testID={`req-col-${col.column}`}
          {...({ dataSet: { taskColumn: col.column } } as object)}
        >
          <View style={s.columnHead}>
            <View style={[s.columnDot, { backgroundColor: STATUS_TONE[col.column]() }]} />
            <Text style={s.columnName}>{REQ_COLUMN_LABEL[col.column]}</Text>
            <View style={s.countPill} testID={`req-count-${col.column}`}><Text style={s.countText}>{col.items.length}</Text></View>
          </View>
          <ScrollView style={s.columnBody} contentContainerStyle={s.columnBodyContent}>
            {col.items.length === 0 && at < 0 ? (
              <View style={s.columnEmpty} testID={`req-empty-${col.column}`}>
                <Text style={s.columnEmptyText}>{pointer ? '拖到这里' : filterActive(filter) ? '没有符合筛选的任务' : '暂无'}</Text>
              </View>
            ) : null}
            {col.items.map((item, i) => (
              <View key={item.id}>
                {i === at ? <View style={[s.dropLine, { marginBottom: spacing.sm }]} testID="req-drop-indicator" /> : null}
                {card(item)}
              </View>
            ))}
            {at >= 0 && at >= col.items.length ? <View style={s.dropLine} testID="req-drop-indicator" /> : null}
          </ScrollView>
          {quick ? (
            <TextInput
              autoFocus
              value={quick.name}
              onChangeText={name => setQuickAdd({ column: col.column, name })}
              onSubmitEditing={() => {
                const name = quick.name.trim();
                if (!name) { setQuickAdd(null); return; }
                const d = { ...draftFor(col.column), name };
                setQuickAdd({ column: col.column, name: '' });
                void create(d).then(failed => { if (failed) { setBanner(failed); setQuickAdd({ column: col.column, name }); } });
              }}
              onBlur={() => { if (!quick.name.trim()) setQuickAdd(null); }}
              onKeyPress={e => { if ((e.nativeEvent as { key?: string }).key === 'Escape') setQuickAdd(null); }}
              placeholder="输入标题，回车添加"
              placeholderTextColor={colors.textMuted}
              style={s.quickAddInput}
              testID={`req-quick-input-${col.column}`}
              accessibilityLabel={`在${REQ_COLUMN_LABEL[col.column]}添加任务`}
            />
          ) : (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`在${REQ_COLUMN_LABEL[col.column]}添加任务`}
              onPress={() => (pointer && !narrow ? setQuickAdd({ column: col.column, name: '' }) : setDraft(draftFor(col.column)))}
              style={state => [s.quickAdd, ((state as { hovered?: boolean }).hovered || state.pressed) && { backgroundColor: colors.rowHover }]}
              testID={`req-quick-add-${col.column}`}
            >
              <Ionicons name="add" size={16} color={colors.textSecondary} />
              <Text style={s.quickAddText}>添加</Text>
            </Pressable>
          )}
        </View>
      );
    };
    if (narrow) {
      return (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          snapToInterval={(colWidth || 0) + spacing.md}
          decelerationRate="fast"
          style={{ flex: 1 }}
          contentContainerStyle={[s.board, s.boardNarrow, { flexGrow: 0, flexShrink: 0, flexBasis: 'auto' }]}
          testID="req-board"
        >
          {columns.map(renderColumn)}
        </ScrollView>
      );
    }
    return <View style={s.board} testID="req-board">{columns.map(renderColumn)}</View>;
  };

  const list = () => {
    if (narrow || !pointer && width < DRAWER_MIN) {
      // 手机:按状态分组的列表。
      return (
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: spacing.xl }} testID="req-list">
          {columns.map(col => (
            <View key={col.column} testID={`req-group-${col.column}`}>
              <View style={s.groupHead}>
                <View style={[s.columnDot, { backgroundColor: STATUS_TONE[col.column]() }]} />
                <Text style={s.columnName}>{REQ_COLUMN_LABEL[col.column]}</Text>
                <View style={s.countPill}><Text style={s.countText}>{col.items.length}</Text></View>
              </View>
              {col.items.length ? (
                <View style={s.groupList}>
                  {col.items.map((item, i) => (
                    <Pressable
                      key={item.id}
                      testID={`req-row-${item.id}`}
                      accessibilityRole="button"
                      accessibilityLabel={item.name}
                      onPress={() => openDetail(item.id)}
                      onLongPress={pointer ? undefined : e => openMenuAt(item, e.nativeEvent.pageX, e.nativeEvent.pageY)}
                      style={state => [s.phoneRow, i === col.items.length - 1 && { borderBottomWidth: 0 }, state.pressed && { backgroundColor: colors.rowHover }]}
                    >
                      {projects && item.projectId ? <ProjectChip project={projectById.get(item.projectId)} s={s} small /> : null}
                      <Text style={[s.cardTitle, item.column === 'done' && s.cardDone]} numberOfLines={2}>{item.name}</Text>
                      <CardMeta item={item} people={people} today={today} s={s} />
                      <ChecklistProgress item={item} s={s} />
                    </Pressable>
                  ))}
                </View>
              ) : <Text style={[s.muted, { paddingHorizontal: spacing.lg + spacing.xs }]}>暂无</Text>}
            </View>
          ))}
        </ScrollView>
      );
    }
    const rows = sortRows(visible, sort, people, projects ?? []);
    const th = (key: SortKey, label: string, style?: object) => {
      const on = sort.key === key;
      return (
        <Pressable accessibilityRole="button" accessibilityLabel={`按${label}排序`} {...a11yState({ selected: on })} onPress={() => setSort(cur => nextSort(cur, key))} style={[s.th, style]} testID={`req-sort-${key}`}>
          <Text style={[s.thText, on && s.thTextOn]}>{label}</Text>
          {on ? <Ionicons name={sort.dir === 'asc' ? 'arrow-up' : 'arrow-down'} size={11} color={colors.text} /> : null}
        </Pressable>
      );
    };
    return (
      <View style={s.table} testID="req-list">
        <View style={s.tableHead}>
          {th('title', '标题', { flex: 1 })}
          {th('owner', '负责人', s.colOwner)}
          {th('priority', '优先级', s.colPriority)}
          {th('due', '期限', s.colDue)}
          {projects ? th('project', '项目', s.colProject) : null}
          {th('status', '状态', s.colStatus)}
        </View>
        <ScrollView style={{ flex: 1 }}>
          {rows.length === 0 ? <View style={[s.center, { paddingVertical: spacing.xl * 2 }]}><Text style={s.muted}>{filterActive(filter) ? '没有符合筛选的任务' : '还没有任务，点右上角「新建」'}</Text></View> : null}
          {rows.map(item => (
            <Pressable
              key={item.id}
              testID={`req-row-${item.id}`}
              accessibilityRole="button"
              accessibilityLabel={item.name}
              onPress={() => openDetail(item.id)}
              onLongPress={pointer ? undefined : e => openMenuAt(item, e.nativeEvent.pageX, e.nativeEvent.pageY)}
              style={state => [s.tr, ((state as { hovered?: boolean }).hovered || state.pressed || item.id === selectedId) && s.trHover]}
              {...({ dataSet: { taskCard: item.id, taskFrom: item.column } } as object)}
            >
              <Text style={[s.tdTitle, item.column === 'done' && s.cardDone]} numberOfLines={1}>{item.name}</Text>
              <View style={s.colOwner}><OwnerBadge item={item} people={people} s={s} /></View>
              <View style={[s.colPriority, s.owner]}><PriorityDot p={item.priority} s={s} /><Text style={s.metaText}>{REQ_PRIORITY_LABEL[item.priority]}</Text></View>
              <View style={[s.colDue, { flexDirection: 'row' }]}>{item.due ? <DueChip item={item} today={today} s={s} /> : <Text style={s.metaMuted}>—</Text>}</View>
              {projects ? <View style={s.colProject}>{item.projectId ? <ProjectChip project={projectById.get(item.projectId)} s={s} small /> : <Text style={s.metaMuted}>—</Text>}</View> : null}
              <View style={s.colStatus}>
                <View style={[s.statusPill, { backgroundColor: STATUS_TONE[item.column]() + '1f' }]}>
                  <View style={[s.prioDot, { width: 6, height: 6, backgroundColor: STATUS_TONE[item.column]() }]} />
                  <Text style={[s.statusPillText, { color: STATUS_TONE[item.column]() }]}>{REQ_COLUMN_LABEL[item.column]}</Text>
                </View>
              </View>
            </Pressable>
          ))}
        </ScrollView>
      </View>
    );
  };

  const body = section === 'dispatch' ? dispatch ?? null
    : phase === 'loading' && !(mine && items.length) ? <View style={s.center} testID="req-loading"><ActivityIndicator color={colors.accent} /></View>
      : phase === 'unsupported' ? <View style={s.center}><Text style={s.muted} testID="req-unsupported">{UNSUPPORTED}</Text></View>
        : phase === 'error' ? (
          <View style={s.center}>
            <Text style={s.err}>{hubError}</Text>
            <Pressable onPress={() => setReloadKey(n => n + 1)} testID="req-retry" accessibilityRole="button"><Text style={s.link}>重试</Text></Pressable>
          </View>
        ) : section === 'list' ? list() : kanban();

  const ghost = pointer && draggingItem && dragView.phase === 'dragging' ? (
    <View
      pointerEvents="none"
      style={[s.card, s.ghost, { position: (Platform.OS === 'web' ? 'fixed' : 'absolute') as 'absolute', left: dragView.x - grab.current.dx, top: dragView.y - grab.current.dy, width: grab.current.w, transform: [{ rotate: '1.5deg' }] }]}
      testID="req-drag-ghost"
    >
      <Text style={s.cardTitle} numberOfLines={2}>{draggingItem.name}</Text>
      <CardMeta item={draggingItem} people={people} today={today} s={s} />
    </View>
  ) : null;

  return (
    <View style={{ flex: 1 }} testID="requirement-board" onLayout={e => setWidth(e.nativeEvent.layout.width)}>
      {header}
      {banner ? (
        <View style={[s.banner, narrow && { marginHorizontal: spacing.lg }]} accessibilityRole="alert" testID="req-banner">
          <Ionicons name="alert-circle-outline" size={14} color={colors.failed} />
          <Text style={[s.err, { flex: 1 }]}>{banner}</Text>
          <Pressable onPress={() => setBanner('')} accessibilityRole="button" accessibilityLabel="关闭提示"><Ionicons name="close" size={14} color={colors.textMuted} /></Pressable>
        </View>
      ) : null}
      {body}
      <Text style={{ position: 'absolute', width: 1, height: 1, opacity: 0 }} accessibilityLiveRegion="polite">{announce}</Text>
      {ghost}
      {selected && section !== 'dispatch' ? (
        <TaskDetailPanel
          cfg={cfg}
          item={selected}
          projects={projects}
          mode={drawer ? 'drawer' : 'page'}
          top={headerBottom}
          people={people}
          peopleLoading={peopleLoading}
          onLoadPeople={loadPeople}
          moving={movingIds.includes(selected.id)}
          moveError={moveErrors[selected.id] || ''}
          onMove={to => { void move(selected.id, to); }}
          onSave={patch => saveEdit(selected.id, patch)}
          onAssignmentsSaved={a => updateTaskItems(scope, rows => rows.map(row => (row.id === selected.id ? { ...row, ...a } : row)))}
          onClose={() => setSelectedId(null)}
          pointer={pointer}
          checklistError={checklistErrors[selected.id] || ''}
          onChecklistToggle={(itemId, done) => { void toggleChecklist(selected.id, itemId, done); }}
          onChecklistAdd={text => {
            const next = addChecklistItem(selected.checklist ?? [], text);
            if (!next) return false;
            void replaceChecklist(selected.id, next);
            return true;
          }}
          onChecklistDelete={itemId => { void replaceChecklist(selected.id, removeChecklistItem(selected.checklist ?? [], itemId)); }}
          onChecklistMove={(from, to) => {
            const list = selected.checklist ?? [];
            const next = moveChecklistItem(list, from, to);
            if (next !== list) void replaceChecklist(selected.id, [...next]);
          }}
        />
      ) : null}
      <TaskCreateDialog
        draft={draft}
        twoRoles={twoRoles}
        projects={projects}
        sheet={!pointer && narrow}
        networkId={cfg.networkId || ''}
        people={people}
        peopleLoading={peopleLoading}
        peopleError={peopleError}
        onLoadPeople={loadPeople}
        onChange={setDraft}
        onSubmit={async () => {
          if (!draft) return null;
          const failed = await create(draft);
          if (!failed) setDraft(null);
          return failed;
        }}
        onClose={() => setDraft(null)}
      />
      {projects ? (
        <TaskProjectManager
          open={managingProjects}
          sheet={!pointer && narrow}
          projects={projects}
          counts={new Map(Array.from(items.reduce((m, it) => (it.projectId ? m.set(it.projectId, (m.get(it.projectId) ?? 0) + 1) : m), new Map<string, number>())))}
          onCreate={async (name, color) => {
            try {
              const created = await createProject(cfg, { name, color });
              patchTaskBoard(scope, { projects: [...(projects ?? []), created] });
              return null;
            } catch (e) { return e instanceof Error ? e.message : '项目没有保存，请重试'; }
          }}
          onUpdate={async (id, patch) => {
            try {
              const updated = await updateProject(cfg, id, patch);
              patchTaskBoard(scope, { projects: (projects ?? []).map(p => (p.id === id ? updated : p)) });
              // 归档了正在筛的项目:退回「全部项目」
              if (updated.archived && filter.project === id) setTaskFilter({ ...filter, project: '' });
              return null;
            } catch (e) { return e instanceof Error ? e.message : '项目没有保存，请重试'; }
          }}
          onClose={() => setManagingProjects(false)}
        />
      ) : null}
      <TaskCardMenu
        target={menu}
        touch={!pointer}
        busy={!!menu && movingIds.includes(menu.id)}
        onOpen={id => setSelectedId(id)}
        onMove={(id, to) => { void move(id, to); if (pointer) focusCard(id); }}
        onClose={() => setMenu(null)}
      />
      <FilterMenu
        open={filterMenu}
        touch={!pointer}
        owners={owners}
        selectedOwners={filter.owners}
        selectedPriorities={filter.priorities}
        meId={meId}
        onToggleOwner={key => setTaskFilter({ ...filter, owners: toggleIn(filter.owners, key) })}
        onTogglePriority={p => setTaskFilter({ ...filter, priorities: toggleIn(filter.priorities, p) })}
        onClear={kind => setTaskFilter(kind === 'owner' ? { ...filter, owners: [] } : kind === 'project' ? { ...filter, project: '' } : { ...filter, priorities: [] })}
        projects={projects ?? []}
        projectCounts={counts}
        selectedProject={filter.project || ''}
        onPickProject={id => setTaskFilter({ ...filter, project: id })}
        onClose={() => setFilterMenu(null)}
      />
    </View>
  );
}

function AvatarStack({ keys, owners }: { keys: readonly string[]; owners: ReturnType<typeof ownerCounts> }) {
  const shown = keys.slice(0, 3);
  return (
    <View style={{ flexDirection: 'row' }}>
      {shown.map((key, i) => {
        const o = owners.find(row => row.key === key);
        return (
          <View key={key} style={{ marginLeft: i ? -6 : 0, borderRadius: radius.pill, borderWidth: 1.5, borderColor: colors.card }}>
            {key === UNASSIGNED ? <Ionicons name="person-circle-outline" size={18} color={colors.textMuted} /> : <AliasAvatar alias={o?.name || key.split(':').slice(1).join(':')} size={18} />}
          </View>
        );
      })}
    </View>
  );
}

/** 头部筛选的弹层:负责人(头像 + 名字 + 数目,多选)或优先级(多选)。 */
function FilterMenu({ open, touch, owners, selectedOwners, selectedPriorities, meId, onToggleOwner, onTogglePriority, onClear, onClose, projects, projectCounts, selectedProject, onPickProject }: {
  open: { kind: 'owner' | 'priority' | 'project'; x: number; y: number } | null;
  touch: boolean;
  owners: ReturnType<typeof ownerCounts>;
  selectedOwners: readonly string[];
  selectedPriorities: readonly string[];
  meId: string | null;
  onToggleOwner: (key: string) => void;
  onTogglePriority: (p: (typeof REQ_PRIORITIES)[number]) => void;
  onClear: (kind: 'owner' | 'priority' | 'project') => void;
  onClose: () => void;
  projects: readonly RequirementProject[];
  projectCounts: ReadonlyMap<string, number>;
  selectedProject: string;
  onPickProject: (id: string) => void;
}) {
  const s = useTaskStyles();
  // 锚定的浮层:遮罩铺满窗口,安全区只用来夹住弹层的位置(同 TaskCardMenu / AgentRowMenu)。
  const safe = useModalSafePadding('fullScreen');
  const rowH = touch ? 44 : 36;
  const row = (key: string, on: boolean, onPress: () => void, lead: ReactNode, label: string, count?: number) => (
    <Pressable key={key} testID={`task-filter-opt-${key}`} accessibilityRole="checkbox" {...a11yState({ checked: on })} onPress={onPress}
      style={state => ({ height: rowH, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: spacing.md, borderRadius: radius.item, backgroundColor: (state as { hovered?: boolean }).hovered || state.pressed ? colors.rowHover : 'transparent' })}>
      {lead}
      <Text style={{ flex: 1, color: colors.text, fontSize: 13 }} numberOfLines={1}>{label}</Text>
      {count !== undefined ? <Text style={s.metaMuted}>{count}</Text> : null}
      <Ionicons name={on ? 'checkbox' : 'square-outline'} size={16} color={on ? colors.accent : colors.textMuted} />
    </Pressable>
  );
  const meKey = meId ? personKey({ kind: 'user', id: meId }) : '';
  return (
    <Modal visible={!!open} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, backgroundColor: touch ? 'rgba(0,0,0,0.18)' : 'transparent' }} onPress={onClose} testID="task-filter-scrim" accessibilityLabel="关闭筛选" />
      {open ? (
        <View style={{ position: 'absolute', left: Math.max(8 + safe.paddingLeft, open.x), top: Math.max(open.y, safe.paddingTop + 8), width: 260, maxHeight: 360, padding: 6, borderRadius: radius.control, backgroundColor: colors.card, ...elevated('floating') }} testID={`task-filter-menu-${open.kind}`} accessibilityRole="menu">
          <ScrollView style={{ flexGrow: 0 }}>
            {open.kind === 'project'
              ? [...activeProjects(projects).map(p => ({ id: p.id, name: p.name, color: p.color as string | null })), { id: NO_PROJECT, name: '无项目', color: null }].map(p => row(
                p.id, selectedProject === p.id, () => { onPickProject(selectedProject === p.id ? '' : p.id); onClose(); },
                p.color ? <View style={{ width: 10, height: 10, borderRadius: radius.pill, backgroundColor: p.color }} /> : <Ionicons name="remove-circle-outline" size={14} color={colors.textMuted} />,
                p.name, projectCounts.get(p.id) ?? 0,
              ))
              : open.kind === 'owner'
              ? owners.filter(o => o.count > 0 || selectedOwners.includes(o.key)).map(o => row(
                o.key, selectedOwners.includes(o.key), () => onToggleOwner(o.key),
                o.ref ? <AliasAvatar alias={o.name} size={22} /> : <Ionicons name="person-circle-outline" size={22} color={colors.textMuted} />,
                o.key === meKey ? `${o.name}（我）` : o.name, o.count,
              ))
              : REQ_PRIORITIES.map(p => row(p, selectedPriorities.includes(p), () => onTogglePriority(p), <PriorityDot p={p} s={s} />, REQ_PRIORITY_LABEL[p]))}
          </ScrollView>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <Pressable onPress={() => { onClear(open.kind); onClose(); }} style={{ height: 36, justifyContent: 'center', paddingHorizontal: spacing.md }} testID="task-filter-reset" accessibilityRole="button">
              <Text style={s.link}>显示全部</Text>
            </Pressable>
            {/* 手机 / 双栏没有左栏:「管理项目」放在项目筛选弹层里。 */}
            {open.kind === 'project' ? (
              <Pressable onPress={() => { onClose(); setManagingProjects(true); }} style={{ height: 36, justifyContent: 'center', paddingHorizontal: spacing.md }} testID="task-filter-manage-projects" accessibilityRole="button">
                <Text style={s.link}>管理项目</Text>
              </Pressable>
            ) : null}
          </View>
        </View>
      ) : null}
    </Modal>
  );
}
