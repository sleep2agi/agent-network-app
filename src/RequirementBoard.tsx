import { ownerCounts, ownerLabel } from './i18n-task-presentation';
import { t as tr } from './i18n';
import TaskListTable from './TaskListTable';
import TaskGantt from './TaskGantt';
import { TaskTagFilter } from './TaskTags';
import { useTranslation } from './i18n-react';
import { taskText } from './i18n-tasks';
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
import { ActivityIndicator, Modal, Platform, Pressable, ScrollView, View, useWindowDimensions } from 'react-native';
import { Text, TextInput } from './ui-text';
import { Ionicons } from './icons';
import AliasAvatar from './AliasAvatar';
import type { HubConfig } from './api';
import { REQ_COLUMN_LABEL, REQ_COLUMNS, REQ_PRIORITIES, type ChecklistItem, type ReqColumn, type Requirement, type RequirementProject } from './requirements-model';
import { readRequirements, requirementsKey, writeRequirements } from './requirements-store';
import { createProject, createRequirementOnHub, fetchMyUserId, listProjects, listRequirementsFull, setChecklistItemOnHub, updateProject, listRequirements, migrateLocalRequirements, moveRequirementOnHub, probeAgentOwnerSupport, RequirementsHubError, updateRequirementOnHub } from './requirements-hub';
import { listRequirementPeople } from './requirement-people-api';
import { personKey, type RequirementPerson } from './requirement-people';
import { colors, radius, spacing } from './theme';
import { elevated } from './elevation';
import { pointerUi } from './pointer-ui';
import { useModalSafePadding } from './safe-area-runtime';
import { usePoll } from './usePoll';
import { applyFilter, applyMove, boardColumns, createInput, DEFAULT_SORT, DRAG_IDLE, dragReduce, dropIndex, emptyDraft, activeProjects, defaultProjectFor, NO_PROJECT, projectCounts, filterActive, hasRoles, localToday, addChecklistItem, moveChecklistItem, removeChecklistItem, setChecklistDone, neighbourColumn, nextSort, revertMove, sortRows, toggleIn, hidesDone, toggleHideDone, UNASSIGNED, type CreateDraft, type DragEvent, type DragState, type EditPatch, type SortKey, type SortSpec } from './task-board-model';
import { enterTaskScope, patchTaskBoard, setManagingProjects, setTaskFilter, setTaskSection, taskScopeKey, updateTaskItems, useTaskBoard, type TaskSection } from './task-board-store';
import { PRIORITY_CODE, priorityChoices, priorityLabel, supportsLowest } from './task-priority';
import { CardMeta, ChecklistProgress, Chip, ParticipantStack, ProjectChip, DueChip, OwnerBadge, PriorityDot, Segmented, STATUS_TONE, useTaskStyles, type TaskStyles, a11yState } from './TaskBoardParts';
import TaskCreateDialog from './TaskCreateDialog';
import TaskDetailPanel, { DRAWER_WIDTH } from './TaskDetailPanel';
import TaskCardMenu, { type TaskMenuTarget } from './TaskCardMenu';
import TaskProjectManager from './TaskProjectManager';
import { setDraggingCursor, useTaskCardDom } from './task-board-dom';
import { boardLayout, pageAt } from './task-board-layout';
import { ParentLine, ProjectSelect, projectOptions } from './TaskFieldPickers';
import { SelectMenu } from './TaskSelectMenu';
import { changeConcernsMe, parseTaskChanged } from './task-window-model';
import { currentWindowLabel, emitTaskChanged, listenTaskChanged, openTaskWindow } from './task-window';
import { isSelectClick, NO_SELECTION, pruneSelection, runBulk, selectClick, toggleSelected, type BulkProgress, type SelectAnchor, type Selection } from './task-select-model';

const UNSUPPORTED = 'tasks.copy.14';
/** 别的设备改了也要看得到;有未完成的写入时跳过这一轮(不拿旧数据盖掉乐观更新)。 */
const POLL_MS = 15_000;
// 内容区窄于 NARROW(task-board-layout)时:看板改成横向一列一屏,详情改成推入页。
const DRAWER_MIN = 860;

/** 筛选键(user:… / node:…)对应的名字:没有卡片的人不在 ownerCounts 里,从成员表取。 */
const keyName = (key: string, people: readonly { kind: string; id: string; name: string }[]) =>
  people.find(p => `${p.kind}:${p.id}` === key)?.name || key.split(':').slice(1).join(':') || tr('tasks.copy.15');

const moveErrorText = (e: unknown) => (e instanceof RequirementsHubError && e.status === 403 ? tr('tasks.copy.16') : tr('tasks.copy.17'));

/** 「在新窗口打开」的任务窗口:只画这一个任务的详情(整窗),关掉 = 关窗口(TaskWindow.tsx)。 */
export type SingleTask = { taskId: string; onClose: () => void; onTitle?: (name: string) => void };

export default function RequirementBoard(props: { cfg: HubConfig; desktop?: boolean; dispatch?: ReactNode; onOpenVoiceSettings?: () => void; single?: SingleTask }) {
  useTranslation();
  const { cfg } = props;
  return <ScopedRequirementBoard key={taskScopeKey(cfg)} {...props} />;
}

function ScopedRequirementBoard({ cfg, desktop, dispatch, onOpenVoiceSettings, single }: { cfg: HubConfig; desktop?: boolean; dispatch?: ReactNode; onOpenVoiceSettings?: () => void; single?: SingleTask }) {
  const { language } = useTranslation();
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
  const dueDatetime = useTaskBoard(st => st.scope === scope && st.capabilities.includes('due_datetime'));
  const subCaps = useTaskBoard(st => st.scope === scope && st.capabilities.includes('sub_requirements'));
  const lowestPriority = useTaskBoard(st => st.scope === scope && supportsLowest(st.capabilities));
  const priorityOptions = useMemo(() => priorityChoices(lowestPriority), [lowestPriority]);
  const filter = useTaskBoard(st => st.filter);
  const items = mine ? storeItems : [];
  /** 这块看板本次启动里从 Hub 读成功过(哪怕是空的)——连不上时照常显示那份,而不是整页报错。 */
  const hasCached = useTaskBoard(st => st.scope === scope && st.loaded);
  const people = mine ? storePeople : [];
  const pointer = pointerUi(desktop);
  const localKey = requirementsKey(cfg.profileId || cfg.username || 'local');

  const [measured, setMeasured] = useState(0);
  // 原生第一帧 onLayout 之前量到的是 0:退到窗口宽(旋转 / 折叠屏展开时跟着变),不按 0 去排版。
  const windowWidth = useWindowDimensions().width;
  const layout = boardLayout(measured, windowWidth, spacing.lg);
  const width = layout.width;
  const narrow = layout.mode === 'paged';
  const drawer = width >= DRAWER_MIN;
  const pagerRef = useRef<ScrollView>(null);
  const [page, setPage] = useState(0);
  const pageWidth = layout.mode === 'paged' ? layout.pageWidth : 0;
  // 旋转 / 折叠后页宽变了:停在同一列上,而不是停在旧偏移量(两列中间)。
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (pageWidth) pagerRef.current?.scrollTo({ x: page * pageWidth, animated: false }); }, [pageWidth]);
  const [headerBottom, setHeaderBottom] = useState(0);
  const [phase, setPhase] = useState<'loading' | 'ready' | 'unsupported' | 'error'>('loading');
  const [hubError, setHubError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const [retrying, setRetrying] = useState(false);
  const [peopleLoading, setPeopleLoading] = useState(false);
  const [peopleError, setPeopleError] = useState('');
  const [draft, setDraft] = useState<CreateDraft | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(single?.taskId ?? null);
  const [movingIds, setMovingIds] = useState<string[]>([]);
  const [moveErrors, setMoveErrors] = useState<Record<string, string>>({});
  const [banner, setBanner] = useState('');
  const [menu, setMenu] = useState<TaskMenuTarget | null>(null);
  const [sort, setSort] = useState<SortSpec>(DEFAULT_SORT);
  const [filterMenu, setFilterMenu] = useState<{ kind: FilterKind; x: number; y: number } | null>(null);
  const [quickAdd, setQuickAdd] = useState<{ column: ReqColumn; name: string } | null>(null);
  const [announce, setAnnounce] = useState('');
  // ── 桌面多选 + 批量改(task-select-model.ts):Ctrl/⌘ 单击、Shift 单击、列表行首勾选框 ──
  const [sel, setSel] = useState<Selection>(NO_SELECTION);
  const [bulk, setBulk] = useState<BulkProgress | null>(null);
  const [bulkMenu, setBulkMenu] = useState<{ kind: 'project' | 'status' | 'agent'; anchor: SelectAnchor } | null>(null);
  const lastBulk = useRef<{ kind: 'project' | 'status' | 'agent'; value: string | null } | null>(null);
  const bulkRefs = useRef<Record<string, any>>({});
  const pendingMoves = useRef(new Set<string>());
  const mutations = useRef(0);
  const inFlight = useRef(0);
  const today = localToday();
  const selected = items.find(item => item.id === selectedId) || null;

  // ── 读 Hub ──
  useEffect(() => {
    let dead = false;
    // 失败后重试时停在错误页(按钮换成「正在重试…」),不要在错误页和转圈之间来回闪。
    setPhase(p => (p === 'error' ? p : 'loading'));
    setRetrying(true);
    (async () => {
      try {
        await migrateLocalRequirements(cfg, () => readRequirements(localKey), rows => writeRequirements(localKey, rows));
        const { rows: list, capabilities } = await listRequirementsFull(cfg);
        if (dead) return;
        // 分不分两个角色:有卡片就看行里带没带 agent_owner;一张都没有才去探 Hub。
        const roles = list.length ? list.some(hasRoles) : await probeAgentOwnerSupport(cfg);
        if (dead) return;
        // 项目:旧 Hub 没有这个路由 → null,界面把项目整个藏起来;读失败也按没有处理,不挡看板。
        const projectList = await listProjects(cfg).catch(() => null);
        if (dead) return;
        patchTaskBoard(scope, { items: list, loaded: true, twoRoles: roles, projects: projectList, capabilities });
        setPhase('ready');
        setHubError('');
      } catch (e) {
        if (dead) return;
        if (e instanceof RequirementsHubError && e.status === 404) { setPhase('unsupported'); return; }
        setPhase('error');
        setHubError(e instanceof Error ? e.message : tr('tasks.copy.18'));
      } finally {
        if (!dead) setRetrying(false);
      }
    })();
    void fetchMyUserId(cfg).then(id => { if (!dead) patchTaskBoard(scope, { meId: id }); });
    return () => { dead = true; };
  }, [cfg.serverUrl, cfg.token, cfg.networkId, localKey, reloadKey, scope]);

  // 有卡片带稳定负责人时读一次成员(卡片上的名字 / 头像、筛选里的人都从这里来)。
  const hasOwners = items.some(item => item.owner || item.agentOwner || item.participants?.length);
  useEffect(() => {
    if (!hasOwners || !cfg.networkId) return;
    let dead = false;
    listRequirementPeople(cfg).then(rows => { if (!dead) patchTaskBoard(scope, { people: rows }); }).catch(() => {});
    return () => { dead = true; };
  }, [cfg.serverUrl, cfg.token, cfg.networkId, hasOwners, scope]);

  const refresh = useCallback(async () => {
    // 首次加载失败(连不上 / 超时)后不能只靠用户点「重试」:跟着轮询(失败时自动退避)再试一次首次加载。
    if (phase === 'error') { setReloadKey(n => n + 1); return; }
    if (phase !== 'ready' || inFlight.current > 0 || drag.current.phase !== 'idle') return;
    const gen = mutations.current;
    try {
      const list = await listRequirements(cfg);
      if (gen === mutations.current && inFlight.current === 0) patchTaskBoard(scope, { items: list });
    } catch { /* 下一轮再试;看板保留上次的 */ }
  }, [cfg, phase, scope]);
  usePoll(refresh, POLL_MS, [refresh]);
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;
  useEffect(() => {
    let off: (() => void) | undefined;
    let alive = true;
    void (async () => {
      const label = await currentWindowLabel();
      const u = await listenTaskChanged(raw => {
        const change = parseTaskChanged(raw);
        if (change && changeConcernsMe(change, { label, profileId: cfg.profileId, serverUrl: cfg.serverUrl, networkId: cfg.networkId })) void refreshRef.current();
      });
      if (alive) off = u; else u();
    })().catch(() => {});
    return () => { alive = false; off?.(); };
  }, [cfg.profileId, cfg.serverUrl, cfg.networkId]);

  const loadPeople = async (): Promise<boolean> => {
    if (peopleLoading) return false;
    setPeopleLoading(true);
    setPeopleError('');
    try {
      patchTaskBoard(scope, { people: await listRequirementPeople(cfg) });
      return true;
    } catch (e) {
      setPeopleError(e instanceof Error ? e.message : tr('tasks.copy.19'));
      return false;
    } finally {
      setPeopleLoading(false);
    }
  };

  // ── 写 Hub ──
  const track = async <T,>(fn: () => Promise<T>): Promise<T> => {
    mutations.current += 1;
    inFlight.current += 1;
    try {
      const out = await fn();
      // 别的窗口(主窗口的看板 / 「在新窗口打开」的任务窗口)里同一块看板马上重读,不等 15 秒的轮询。
      void emitTaskChanged({ profileId: cfg.profileId, serverUrl: cfg.serverUrl, networkId: cfg.networkId });
      return out;
    } finally { inFlight.current -= 1; }
  };

  const move = async (id: string, to: ReqColumn) => {
    const item = items.find(row => row.id === id);
    if (!item || item.column === to || pendingMoves.current.has(id)) return;
    const from = item.column;
    pendingMoves.current.add(id);
    setMovingIds(ids => [...ids, id]);
    setMoveErrors(({ [id]: _, ...rest }) => rest);
    updateTaskItems(scope, rows => applyMove(rows, id, to));
    setAnnounce(tr('tasks.copy.20', { v0: item.name, v1: taskText(REQ_COLUMN_LABEL[to]) }));
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
    if (!input) return tr('tasks.copy.21');
    try {
      const created = await track(() => createRequirementOnHub(cfg, input));
      updateTaskItems(scope, rows => [created, ...rows.filter(row => row.id !== created.id)]);
      setAnnounce(tr('tasks.copy.22', { v0: created.name }));
      return null;
    } catch (e) {
      return e instanceof Error ? e.message : tr('tasks.copy.23');
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
      setChecklistErrors(errs => ({ ...errs, [id]: e instanceof Error ? e.message : tr('tasks.copy.24') }));
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
      setChecklistErrors(errs => ({ ...errs, [id]: e instanceof Error ? e.message : tr('tasks.copy.24') }));
    }
  };

  const saveEdit = async (id: string, patch: EditPatch): Promise<string | null> => {
    try {
      const updated = await track(() => updateRequirementOnHub(cfg, id, patch));
      updateTaskItems(scope, rows => rows.map(row => (row.id === id ? updated : row)));
      return null;
    } catch (e) {
      return e instanceof Error ? e.message : tr('tasks.copy.25');
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
    // 筛着某一档就用那一档建;旧 Hub 不收 P3,筛着 P3 也按默认 P1 建。
    if (filter.priorities.length === 1 && priorityOptions.includes(filter.priorities[0])) d.priority = filter.priorities[0];
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
  // 状态筛选把列变少了:手机分页别停在已经不存在的那一页上。
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { const last = Math.max(0, columns.length - 1); if (page > last) { setPage(last); pagerRef.current?.scrollTo({ x: last * pageWidth, animated: false }); } }, [columns.length]);
  const owners = useMemo(() => ownerCounts(items, people), [items, people, language]);
  const draggingItem = dragView.phase === 'dragging' ? items.find(row => row.id === dragView.id) || null : null;
  const listRows = useMemo(() => sortRows(visible, sort, people, projects ?? []), [visible, sort, people, projects]);
  // Shift 单击连选按「当前显示的顺序」:列表按排序后的行,看板按 需求池 → 进行中 → 完成 各列从上到下。
  const order = useMemo(() => (section === 'list' ? listRows.map(r => r.id) : columns.flatMap(c => c.items.map(i => i.id))), [section, listRows, columns]);
  useEffect(() => { setSel(cur => pruneSelection(cur, items.map(i => i.id))); }, [items]);
  useEffect(() => { setSel(NO_SELECTION); }, [section, scope]);
  const onCardPress = (id: string, e?: { nativeEvent?: any }) => {
    const n = e?.nativeEvent ?? {};
    const m = { toggle: !!(n.ctrlKey || n.metaKey), range: !!n.shiftKey };
    if (pointer && isSelectClick(m)) { setSel(cur => selectClick(cur, id, m, order)); return; }
    openDetail(id);
  };
  const setProject = async (id: string, projectId: string | null) => {
    const failed = await saveEdit(id, { project_id: projectId });
    if (failed) setBanner(failed);
  };
  const applyBulk = async (kind: 'project' | 'status' | 'agent', value: string | null, ids: readonly string[] = sel.ids) => {
    lastBulk.current = { kind, value };
    const targets = ids.map(id => items.find(i => i.id === id)).filter((i): i is Requirement => !!i).map(i => ({ id: i.id, name: i.name }));
    const result = await runBulk(targets, async id => {
      const cur = items.find(i => i.id === id);
      if (kind === 'status') {
        if (!cur || cur.column === value) return;
        const updated = await track(() => moveRequirementOnHub(cfg, id, value as ReqColumn));
        updateTaskItems(scope, rows => rows.map(row => (row.id === id ? updated : row)));
        return;
      }
      if (kind === 'project' && cur && (cur.projectId ?? null) === value) return;
      const patch: EditPatch = kind === 'project' ? { project_id: value } : { agent_owner: value ? { kind: 'node', id: value } : null };
      const updated = await track(() => updateRequirementOnHub(cfg, id, patch));
      updateTaskItems(scope, rows => rows.map(row => (row.id === id ? updated : row)));
    }, setBulk);
    // 没改成的留在选择里(可以直接「重试」);都成了就清掉选择。
    setSel(result.failed.length ? { ids: result.failed.map(f => f.id), anchor: null } : NO_SELECTION);
    setAnnounce(tr('bulk.done', { n: result.total - result.failed.length }));
  };
  useEffect(() => {
    if (!bulk || bulk.running || bulk.failed.length) return;
    const t = setTimeout(() => setBulk(null), 2500);
    return () => clearTimeout(t);
  }, [bulk]);
  // Esc 取消选择(没有打开详情 / 菜单时)。
  useEffect(() => {
    const doc = (globalThis as any).document;
    if (!pointer || !sel.ids.length || !doc?.addEventListener) return;
    const onKey = (e: any) => { if (e.key === 'Escape' && !selectedId && !bulkMenu && !menu && !draft) { setSel(NO_SELECTION); setBulk(b => (b?.running ? b : null)); } };
    doc.addEventListener('keydown', onKey);
    return () => doc.removeEventListener('keydown', onKey);
  }, [pointer, sel.ids.length, selectedId, bulkMenu, menu, draft]);
  const openBulkMenu = async (kind: 'project' | 'status' | 'agent') => {
    if (kind === 'agent' && !(await loadPeople()) && !people.length) return;
    const el = bulkRefs.current[kind];
    const done = (x: number, y: number, w: number, h: number) => setBulkMenu({ kind, anchor: { x, y, w, h } });
    if (el?.measureInWindow) el.measureInWindow(done);
    else done(spacing.xl, 400, 200, 32);
  };

  const sections: { key: TaskSection; label: string }[] = [
    { key: 'list', label: tr('tasks.copy.26') },
    { key: 'board', label: tr('tasks.copy.27') },
    // 甘特图(只读):桌面 = 时间轴,手机 = 按周列表(TaskGantt.tsx 顶部写了为什么)。
    { key: 'gantt', label: tr('gantt.view') },
    // 桌面的派发记录在左栏(TaskFilterSidebar);手机 / 双栏没有左栏,放在分段里。
    ...(desktop ? [] : [{ key: 'dispatch' as const, label: tr('tasks.copy.28') }]),
  ];
  const ownerChipLabel = filter.owners.length === 0 ? tr('tasks.copy.15')
    : filter.owners.length === 1 ? (owners.find(o => o.key === filter.owners[0])?.name || (filter.owners[0] === UNASSIGNED ? tr('tasks.copy.6') : keyName(filter.owners[0], people)))
      : tr('tasks.copy.29', { v0: filter.owners.length });
  const projectById = new Map((projects ?? []).map(p => [p.id, p]));
  const selectedProject = filter.project && filter.project !== NO_PROJECT ? projectById.get(filter.project) : undefined;
  const projectChipLabel = !filter.project ? tr('tasks.copy.30') : filter.project === NO_PROJECT ? tr('tasks.copy.31') : selectedProject?.name || tr('tasks.copy.30');
  const counts = useMemo(() => projectCounts(items, filter), [items, filter]);
  const priorityChipLabel = filter.priorities.length === 0 ? tr('tasks.copy.32') : REQ_PRIORITIES.filter(p => filter.priorities.includes(p)).map(p => filter.priorities.length === 1 ? priorityLabel(p) : PRIORITY_CODE[p]).join('、');
  const statuses = filter.statuses ?? [];
  const statusChipLabel = statuses.length === 0 ? tr('tasks.filterStatus') : REQ_COLUMNS.filter(c => statuses.includes(c)).map(c => taskText(REQ_COLUMN_LABEL[c])).join('、');
  const chipRefs = useRef<Record<string, any>>({});
  const openFilter = (kind: FilterKind) => {
    const el = chipRefs.current[kind];
    const done = (x: number, y: number, h: number) => setFilterMenu({ kind, x, y: y + h + 4 });
    if (el?.measureInWindow) el.measureInWindow((x: number, y: number, _w: number, h: number) => done(x, y, h));
    else done(spacing.xl, 64, 0);
  };
  const filters = section === 'dispatch' ? null : (
    <>
      {!desktop ? <TaskTagFilter /> : null}
      <View ref={(r: any) => { chipRefs.current.owner = r; }} collapsable={false}>
        <Chip
          s={s}
          label={ownerChipLabel}
          on={filter.owners.length > 0}
          onPress={() => openFilter('owner')}
          testID="task-filter-owner"
          accessibilityLabel={tr('tasks.copy.33', { v0: filter.owners.length ? ownerChipLabel : tr('tasks.copy.34') })}
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
          accessibilityLabel={tr('tasks.copy.35', { v0: filter.priorities.length ? priorityChipLabel : tr('tasks.copy.34') })}
          leading={filter.priorities.length === 1 ? <PriorityDot p={filter.priorities[0]} s={s} /> : <Ionicons name="flag-outline" size={14} color={colors.textMuted} />}
        />
      </View>
      {subCaps ? (
        // 只看顶层 / 全部:列表和看板一起生效。
        <Segmented s={s} items={[{ key: 'all', label: tr('tasks.copy.34') }, { key: 'top', label: tr('tasks.copy.36') }]} value={filter.topLevel ? 'top' : 'all'} onChange={k => setTaskFilter({ ...filter, topLevel: k === 'top' })} testID="task-scope" />
      ) : null}
      {projects ? (
        <View ref={(r: any) => { chipRefs.current.project = r; }} collapsable={false}>
          <Chip
            s={s}
            label={projectChipLabel}
            on={!!filter.project}
            onPress={() => openFilter('project')}
            testID="task-filter-project"
            accessibilityLabel={tr('tasks.copy.37', { v0: filter.project ? projectChipLabel : tr('tasks.copy.34') })}
            leading={selectedProject ? <View style={{ width: 8, height: 8, borderRadius: radius.pill, backgroundColor: selectedProject.color }} /> : <Ionicons name="folder-outline" size={14} color={colors.textMuted} />}
          />
        </View>
      ) : null}
      <View ref={(r: any) => { chipRefs.current.status = r; }} collapsable={false}>
        <Chip
          s={s}
          label={statusChipLabel}
          on={statuses.length > 0}
          onPress={() => openFilter('status')}
          testID="task-filter-status"
          accessibilityLabel={tr('tasks.filterStatusA11y', { v0: statuses.length ? statusChipLabel : tr('tasks.copy.34') })}
          leading={statuses.length === 1 ? <View style={[s.columnDot, { backgroundColor: STATUS_TONE[statuses[0]]() }]} /> : <Ionicons name="ellipse-outline" size={14} color={colors.textMuted} />}
        />
      </View>
      {filterActive(filter) ? (
        <Pressable accessibilityRole="button" onPress={() => setTaskFilter({ owners: [], priorities: [], project: '', statuses: [], topLevel: filter.topLevel })} style={[s.iconButton, { width: 'auto', flexShrink: 0, paddingHorizontal: spacing.sm }]} testID="task-filter-clear">
          <Text style={s.link} numberOfLines={1}>{tr('tasks.copy.38')}</Text>
        </Pressable>
      ) : null}
    </>
  );
  const newButton = section === 'dispatch' ? null : narrow ? (
    <Pressable accessibilityRole="button" accessibilityLabel={tr('tasks.copy.39')} onPress={() => setDraft(draftFor('pool'))} style={[s.primary, { width: 32, paddingHorizontal: 0, justifyContent: 'center' }]} testID="req-new">
      <Ionicons name="add" size={20} color={colors.onAccent} />
    </Pressable>
  ) : (
    <Pressable accessibilityRole="button" accessibilityLabel={tr('tasks.copy.39')} onPress={() => setDraft(draftFor('pool'))} style={s.primary} testID="req-new">
      <Ionicons name="add" size={16} color={colors.onAccent} />
      <Text style={s.primaryText}>{tr('tasks.copy.40')}</Text>
    </Pressable>
  );

  const header = narrow ? (
    <View onLayout={e => setHeaderBottom(e.nativeEvent.layout.y + e.nativeEvent.layout.height)}>
      <View style={[s.header, s.headerPhone]} testID="task-header">
        <Text style={s.pageTitle} accessibilityRole="header">{tr('tasks.copy.41')}</Text>
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
      <Text style={[s.pageTitle, { flexShrink: 0 }]} numberOfLines={1} accessibilityRole="header">{tr('tasks.copy.41')}</Text>
      <View style={{ flexShrink: 0 }}><Segmented s={s} items={sections} value={section} onChange={setTaskSection} testID="tasks-view" /></View>
      {/* 筛选一行放不下(桌面窄窗口:1000 宽时内容区只有 ~716)就在这一格里横向滚动,不把标题挤成两行、不把「新建」挤出去。 */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flex: 1, minWidth: 0 }} contentContainerStyle={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }} testID="task-header-filters">
        {filters}
      </ScrollView>
      <View style={{ flexShrink: 0 }}>{newButton}</View>
    </View>
  );

  // 桌面列宽(内容宽 - 两侧 24 - 列间 16 的间隙)/ 列数(按状态筛了会少于三列);窄于 260 时卡片上的负责人只显示头像。
  const compactCards = !narrow && (width - spacing.xl * 2 - spacing.lg * (columns.length - 1)) / Math.max(1, columns.length) < 260;
  const card = (item: Requirement) => {
    const isDragged = draggingItem?.id === item.id;
    return (
      <Pressable
        key={item.id}
        testID={`req-card-${item.id}`}
        accessibilityRole="button"
        accessibilityLabel={tr('tasks.copy.42', { v0: item.name, v1: priorityLabel(item.priority), v2: ownerLabel(item, people) })}
        accessibilityHint={pointer ? tr('tasks.copy.43') : tr('tasks.copy.44')}
        {...a11yState({ selected: sel.ids.includes(item.id) })}
        onPress={e => onCardPress(item.id, e)}
        onLongPress={pointer ? undefined : e => openMenuAt(item, e.nativeEvent.pageX, e.nativeEvent.pageY)}
        delayLongPress={350}
        style={state => [s.card, ((state as { hovered?: boolean }).hovered || state.pressed) && s.cardHover, isDragged && s.cardDragging, sel.ids.includes(item.id) && s.cardSelected, pointer && ({ cursor: 'grab' } as object)]}
        {...({ dataSet: { taskCard: item.id, taskFrom: item.column } } as object)}
      >
        {projects && item.projectId ? <ProjectChip project={projectById.get(item.projectId)} s={s} small /> : null}
        <Text style={[s.cardTitle, item.column === 'done' && s.cardDone]} numberOfLines={2}>{item.name}</Text>
        <ParentLine item={item} items={items} />
        <CardMeta item={item} people={people} today={today} s={s} compact={compactCards} />
        <CardFooter item={item} people={people} s={s} touch={!pointer} />
        {moveErrors[item.id] ? <Text style={s.err} numberOfLines={1}>{moveErrors[item.id]}</Text> : null}
      </Pressable>
    );
  };

  const kanban = () => {
    const over = dragView.phase === 'dragging' && dragView.over !== dragView.from ? dragView.over : null;
    const renderColumn = (col: (typeof columns)[number]) => {
      const isOver = over === col.column;
      const at = isOver && draggingItem ? dropIndex(col.items, draggingItem, col.column) : -1;
      const quick = quickAdd?.column === col.column ? quickAdd : null;
      return (
        <View
          key={col.column}
          style={[layout.mode === 'paged' ? s.columnPaged : s.column, isOver && s.columnOver]}
          testID={`req-col-${col.column}`}
          {...({ dataSet: { taskColumn: col.column } } as object)}
        >
          <View style={s.columnHead}>
            <View style={[s.columnDot, { backgroundColor: STATUS_TONE[col.column]() }]} />
            <Text style={s.columnName}>{taskText(REQ_COLUMN_LABEL[col.column])}</Text>
            <View style={s.countPill} testID={`req-count-${col.column}`}><Text style={s.countText}>{col.items.length}</Text></View>
          </View>
          <ScrollView style={s.columnBody} contentContainerStyle={s.columnBodyContent}>
            {col.items.length === 0 && at < 0 ? (
              <View style={s.columnEmpty} testID={`req-empty-${col.column}`}>
                <Text style={s.columnEmptyText}>{pointer ? tr('tasks.copy.45') : filterActive(filter) ? tr('tasks.copy.46') : tr('tasks.copy.8')}</Text>
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
              placeholder={tr('tasks.copy.47')}
              placeholderTextColor={colors.textMuted}
              style={s.quickAddInput}
              testID={`req-quick-input-${col.column}`}
              accessibilityLabel={tr('tasks.copy.48', { v0: taskText(REQ_COLUMN_LABEL[col.column]) })}
            />
          ) : (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={tr('tasks.copy.48', { v0: taskText(REQ_COLUMN_LABEL[col.column]) })}
              onPress={() => (pointer && !narrow ? setQuickAdd({ column: col.column, name: '' }) : setDraft(draftFor(col.column)))}
              style={state => [s.quickAdd, ((state as { hovered?: boolean }).hovered || state.pressed) && { backgroundColor: colors.rowHover }]}
              testID={`req-quick-add-${col.column}`}
            >
              <Ionicons name="add" size={16} color={colors.textSecondary} />
              <Text style={s.quickAddText}>{tr('tasks.copy.49')}</Text>
            </Pressable>
          )}
        </View>
      );
    };
    if (layout.mode === 'paged') {
      // 手机:一列一屏。页宽 = 看板宽(数值),列宽 = 页宽 − 两侧留白;上面一排胶囊标出当前是哪一列,点了跳过去。
      const { pageWidth: pw, columnWidth, gutter } = layout;
      const goTo = (i: number) => { setPage(i); pagerRef.current?.scrollTo({ x: i * pw, animated: true }); };
      return (
        <View style={{ flex: 1 }}>
          <View style={s.pager} accessibilityRole="tablist" testID="req-pager">
            {columns.map((col, i) => {
              const on = i === page;
              return (
                <Pressable key={col.column} accessibilityRole="tab" {...a11yState({ selected: on })} onPress={() => goTo(i)} style={[s.pagerTab, on && s.pagerTabOn]} testID={`req-page-tab-${col.column}`}>
                  <View style={[s.columnDot, { backgroundColor: STATUS_TONE[col.column]() }]} />
                  <Text style={[s.pagerText, on && s.pagerTextOn]}>{taskText(REQ_COLUMN_LABEL[col.column])}</Text>
                  <Text style={s.countText}>{col.items.length}</Text>
                </Pressable>
              );
            })}
          </View>
          {/* paged-board:start —— 这段里只用数值宽度(task-board-layout.test.ts 静态检查)。 */}
          <ScrollView
            ref={pagerRef}
            horizontal
            showsHorizontalScrollIndicator={false}
            contentOffset={{ x: page * pw, y: 0 }}
            snapToInterval={pw}
            snapToAlignment="start"
            disableIntervalMomentum
            decelerationRate="fast"
            scrollEventThrottle={16}
            onScroll={e => { const i = pageAt(e.nativeEvent.contentOffset.x, pw, columns.length); if (i !== page) setPage(i); }}
            style={{ flex: 1 }}
            contentContainerStyle={s.boardPaged}
            testID="req-board"
          >
            {columns.map(col => (
              <View key={col.column} style={{ width: pw, paddingHorizontal: gutter }} testID={`req-page-${col.column}`}>
                <View style={{ width: columnWidth, flexGrow: 1 }}>{renderColumn(col)}</View>
              </View>
            ))}
          </ScrollView>
          {/* paged-board:end */}
        </View>
      );
    }
    return <View style={s.board} testID="req-board">{columns.map(renderColumn)}</View>;
  };

  const list = () => {
    if (narrow) {
      // 手机:按状态分组的列表。
      return (
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: spacing.xl }} testID="req-list">
          {columns.map(col => (
            <View key={col.column} testID={`req-group-${col.column}`}>
              <View style={s.groupHead}>
                <View style={[s.columnDot, { backgroundColor: STATUS_TONE[col.column]() }]} />
                <Text style={s.columnName}>{taskText(REQ_COLUMN_LABEL[col.column])}</Text>
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
                      <ParentLine item={item} items={items} />
                      <CardMeta item={item} people={people} today={today} s={s} />
                      <CardFooter item={item} people={people} s={s} touch={!pointer} />
                    </Pressable>
                  ))}
                </View>
              ) : <Text style={[s.muted, { paddingHorizontal: spacing.lg + spacing.xs }]}>{tr('tasks.copy.8')}</Text>}
            </View>
          ))}
        </ScrollView>
      );
    }
    const rows = listRows;
    return <TaskListTable rows={rows} people={people} projects={projects} sort={sort} setSort={setSort} s={s} today={today} selectedId={selectedId} onOpen={openDetail} touch={!pointer} onMenu={openMenuAt} filtered={filterActive(filter)} needsUpdateUpgrade={items.some(item => item.updatedAt === undefined)} items={items}
      selection={pointer ? { ids: sel.ids, onToggle: id => setSel(cur => toggleSelected(cur, id)), onPress: (id, e) => onCardPress(id, e as { nativeEvent?: any }) } : undefined}
      onProject={(id, pid) => { void setProject(id, pid); }} />;
  };

  const body = section === 'dispatch' ? dispatch ?? null
    : phase === 'loading' && !(hasCached || (mine && items.length)) ? <View style={s.center} testID="req-loading"><ActivityIndicator color={colors.accent} /></View>
      : phase === 'unsupported' ? <View style={s.center}><Text style={s.muted} testID="req-unsupported">{tr(UNSUPPORTED)}</Text></View>
        // 连不上但本机已有这块看板的上次数据:照常显示,不用一句错误把整页换掉(顶部横幅已说明是缓存)。
        : phase === 'error' && !(hasCached || (mine && items.length)) ? (
          <View style={s.center} testID="req-error">
            <Text style={s.err}>{hubError}</Text>
            {retrying
              ? <Text style={s.muted} testID="req-retrying">{tr('tasks.copy.56')}</Text>
              : <Pressable onPress={() => setReloadKey(n => n + 1)} testID="req-retry" accessibilityRole="button"><Text style={s.link}>{tr('tasks.copy.57')}</Text></Pressable>}
          </View>
        ) : section === 'list' ? list()
          : section === 'gantt' ? <TaskGantt items={visible} projects={projects} people={people} today={today} s={s} onOpen={openDetail} selectedId={selectedId} phone={narrow} />
            : kanban();

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

  const tauriShell = Platform.OS === 'web' && !!(globalThis as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
  // 详情:抽屉 / 推入页 / 「在新窗口打开」的整窗(single)。
  const detail = (mode: 'drawer' | 'page' | 'window') => (selected ? (
        <TaskDetailPanel
          cfg={cfg}
          item={selected}
          items={items}
          onOpenRequirement={id => { setSelectedId(id); const next = items.find(i => i.id === id); if (single && next) single.onTitle?.(next.name); }}
          onCreateChild={parent => setDraft({ ...draftFor('pool'), parentId: parent.id, projectId: parent.projectId ?? (projects ? defaultProjectFor(filter, projects) : null) })}
          projects={projects}
          dueDatetime={dueDatetime}
          lowestPriority={lowestPriority}
          mode={mode}
          top={headerBottom}
          people={people}
          peopleLoading={peopleLoading}
          onLoadPeople={loadPeople}
          moving={movingIds.includes(selected.id)}
          moveError={moveErrors[selected.id] || ''}
          onMove={to => { void move(selected.id, to); }}
          onSave={patch => saveEdit(selected.id, patch)}
          onAssignmentsSaved={a => updateTaskItems(scope, rows => rows.map(row => (row.id === selected.id ? { ...row, ...a } : row)))}
          onClose={() => (single ? single.onClose() : setSelectedId(null))}
          onOpenWindow={tauriShell && pointer && !single ? () => openTaskWindow({ taskId: selected.id, profileId: cfg.profileId, serverUrl: cfg.serverUrl, networkId: cfg.networkId, title: selected.name, at: Date.now() }) : undefined}
          pointer={pointer}
          onOpenVoiceSettings={onOpenVoiceSettings}
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
  ) : null);
  const createDialog = (
      <TaskCreateDialog
        draft={draft}
        twoRoles={twoRoles}
        parentName={draft?.parentId ? items.find(i => i.id === draft.parentId)?.name ?? null : null}
        projects={projects}
        dueDatetime={dueDatetime}
        priorities={priorityOptions}
        pointer={pointer}
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
  );

  if (single) {
    return (
      <View style={{ flex: 1 }} testID="requirement-board-single" onLayout={e => setMeasured(e.nativeEvent.layout.width)}>
        {selected ? detail('window')
          : phase === 'loading' ? <View style={s.center}><ActivityIndicator color={colors.accent} /></View>
            : <View style={s.center}><Text style={s.muted} testID="task-window-missing">{phase === 'error' ? hubError : tr('taskWin.missing')}</Text></View>}
        {createDialog}
      </View>
    );
  }

  return (
    <View style={{ flex: 1 }} testID="requirement-board" onLayout={e => setMeasured(e.nativeEvent.layout.width)}>
      {header}
      {banner ? (
        <View style={[s.banner, narrow && { marginHorizontal: spacing.lg }]} accessibilityRole="alert" testID="req-banner">
          <Ionicons name="alert-circle-outline" size={14} color={colors.failed} />
          <Text style={[s.err, { flex: 1 }]}>{banner}</Text>
          <Pressable onPress={() => setBanner('')} accessibilityRole="button" accessibilityLabel={tr('tasks.copy.58')}><Ionicons name="close" size={14} color={colors.textMuted} /></Pressable>
        </View>
      ) : null}
      {body}
      <Text style={{ position: 'absolute', width: 1, height: 1, opacity: 0 }} accessibilityLiveRegion="polite">{announce}</Text>
      {ghost}
      {selected && section !== 'dispatch' ? detail(drawer ? 'drawer' : 'page') : null}
      {createDialog}
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
            } catch (e) { return e instanceof Error ? e.message : tr('tasks.copy.59'); }
          }}
          onUpdate={async (id, patch) => {
            try {
              const updated = await updateProject(cfg, id, patch);
              patchTaskBoard(scope, { projects: (projects ?? []).map(p => (p.id === id ? updated : p)) });
              // 归档了正在筛的项目:退回「全部项目」
              if (updated.archived && filter.project === id) setTaskFilter({ ...filter, project: '' });
              return null;
            } catch (e) { return e instanceof Error ? e.message : tr('tasks.copy.59'); }
          }}
          onClose={() => setManagingProjects(false)}
        />
      ) : null}
      {pointer && section !== 'dispatch' && (sel.ids.length || bulk) ? (
        <BulkBar
          count={sel.ids.length}
          bulk={bulk}
          canProject={!!projects}
          canAgent={twoRoles}
          right={selected && drawer ? DRAWER_WIDTH : 0}
          setRef={(kind, r) => { bulkRefs.current[kind] = r; }}
          onOpen={kind => { void openBulkMenu(kind); }}
          onRetry={() => { const last = lastBulk.current; if (last && bulk) void applyBulk(last.kind, last.value, bulk.failed.map(f => f.id)); }}
          onClear={() => { setSel(NO_SELECTION); setBulk(null); }}
        />
      ) : null}
      <SelectMenu
        anchor={bulkMenu?.anchor ?? null}
        touch={!pointer}
        title={bulkMenu?.kind === 'project' ? tr('bulk.project') : bulkMenu?.kind === 'agent' ? tr('bulk.agent') : tr('bulk.status')}
        options={bulkMenu?.kind === 'project' ? projectOptions(projects ?? [], null)
          : bulkMenu?.kind === 'agent' ? people.filter(p => p.kind === 'node').map(p => ({ id: p.id, label: p.name, lead: <AliasAvatar alias={p.name} size={18} /> }))
            : REQ_COLUMNS.map(col => ({ id: col, label: taskText(REQ_COLUMN_LABEL[col]), color: STATUS_TONE[col]() }))}
        noneLabel={bulkMenu?.kind === 'project' ? tr('tasks.copy.31') : bulkMenu?.kind === 'agent' ? tr('bulk.agentNone') : undefined}
        selected={null}
        searchable={bulkMenu?.kind === 'agent'}
        onPick={value => { const kind = bulkMenu?.kind; setBulkMenu(null); if (kind) void applyBulk(kind, value); }}
        onClose={() => setBulkMenu(null)}
        testID={`task-bulk-menu-${bulkMenu?.kind ?? 'none'}`}
      />
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
        priorities={priorityChoices(lowestPriority || filter.priorities.includes('lowest'))}
        selectedPriorities={filter.priorities}
        meId={meId}
        onToggleOwner={key => setTaskFilter({ ...filter, owners: toggleIn(filter.owners, key) })}
        onTogglePriority={p => setTaskFilter({ ...filter, priorities: toggleIn(filter.priorities, p) })}
        selectedStatuses={statuses}
        onToggleStatus={c => setTaskFilter({ ...filter, statuses: toggleIn(statuses, c) })}
        onToggleHideDone={() => setTaskFilter({ ...filter, statuses: toggleHideDone(statuses) })}
        onClear={kind => setTaskFilter(kind === 'owner' ? { ...filter, owners: [] } : kind === 'project' ? { ...filter, project: '' } : kind === 'status' ? { ...filter, statuses: [] } : { ...filter, priorities: [] })}
        projects={projects ?? []}
        projectCounts={counts}
        selectedProject={filter.project || ''}
        onPickProject={id => setTaskFilter({ ...filter, project: id })}
        onClose={() => setFilterMenu(null)}
      />
    </View>
  );
}

/** 桌面多选的底部操作条:已选几个 · 移到项目… · 改状态… · 负责 Agent… · 取消选择;改的过程中显示进度,失败的列出来可以重试。 */
function BulkBar({ count, bulk, canProject, canAgent, right, setRef, onOpen, onRetry, onClear }: {
  count: number;
  bulk: BulkProgress | null;
  canProject: boolean;
  canAgent: boolean;
  /** 右边被详情抽屉占掉的宽度(条在剩下的区域里居中)。 */
  right: number;
  setRef: (kind: 'project' | 'status' | 'agent', r: any) => void;
  onOpen: (kind: 'project' | 'status' | 'agent') => void;
  onRetry: () => void;
  onClear: () => void;
}) {
  useTranslation();
  const s = useTaskStyles();
  const running = !!bulk?.running;
  const btn = (kind: 'project' | 'status' | 'agent', label: string, icon: string) => (
    <View key={kind} ref={r => setRef(kind, r)} collapsable={false}>
      <Pressable
        accessibilityRole="button"
        {...a11yState({ disabled: running })}
        disabled={running}
        onPress={() => onOpen(kind)}
        style={state => [{ flexDirection: 'row', alignItems: 'center', gap: 6, height: 32, paddingHorizontal: spacing.md, borderRadius: radius.control, flexShrink: 0 }, ((state as { hovered?: boolean }).hovered || state.pressed) && { backgroundColor: colors.rowHover }, running && { opacity: 0.45 }]}
        testID={`task-bulk-${kind}`}
      >
        <Ionicons name={icon as never} size={15} color={colors.textSecondary} />
        <Text style={{ color: colors.text, fontSize: 13 }} numberOfLines={1}>{label}</Text>
      </Pressable>
    </View>
  );
  const status = running ? tr('bulk.running', { done: bulk!.done, total: bulk!.total })
    : count ? tr('bulk.selected', { n: count })
      : bulk && !bulk.failed.length ? tr('bulk.done', { n: bulk.total }) : '';
  return (
    <View pointerEvents="box-none" style={{ position: 'absolute', left: 0, right, bottom: spacing.xl, alignItems: 'center', gap: spacing.sm, zIndex: 15 }}>
      {bulk && !bulk.running && bulk.failed.length ? (
        <View style={{ maxWidth: 520, padding: spacing.md, gap: 4, borderRadius: radius.control, backgroundColor: colors.card, ...elevated('floating') }} testID="task-bulk-failed" accessibilityRole="alert">
          <Text style={s.err}>{tr('bulk.failed', { n: bulk.failed.length })}</Text>
          {bulk.failed.slice(0, 5).map(f => <Text key={f.id} style={s.muted} numberOfLines={1}>「{f.name}」{f.message}</Text>)}
          <Pressable accessibilityRole="button" onPress={onRetry} testID="task-bulk-retry"><Text style={s.link}>{tr('bulk.retry')}</Text></Pressable>
        </View>
      ) : null}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, height: 44, paddingLeft: spacing.lg, paddingRight: 6, borderRadius: radius.pill, backgroundColor: colors.card, ...elevated('floating') }} testID="task-bulk-bar">
        <Text style={{ color: colors.text, fontSize: 13, fontWeight: '600', marginRight: spacing.sm, flexShrink: 0 }} numberOfLines={1} testID="task-bulk-count" accessibilityLiveRegion="polite">{status}</Text>
        {running ? <ActivityIndicator size="small" color={colors.textMuted} /> : null}
        {count ? (
          <>
            {canProject ? btn('project', tr('bulk.project'), 'folder-outline') : null}
            {btn('status', tr('bulk.status'), 'swap-horizontal-outline')}
            {canAgent ? btn('agent', tr('bulk.agent'), 'hardware-chip-outline') : null}
          </>
        ) : null}
        <Pressable accessibilityRole="button" accessibilityLabel={tr('bulk.clear')} onPress={onClear} disabled={running} style={state => [{ width: 32, height: 32, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' }, ((state as { hovered?: boolean }).hovered || state.pressed) && { backgroundColor: colors.rowHover }]} testID="task-bulk-clear">
          <Ionicons name="close" size={16} color={colors.textSecondary} />
        </Pressable>
      </View>
    </View>
  );
}

/** 卡片最下一行:子任务进度(左,可没有)+ 参与人头像(右,可没有)。都没有就不占位置。 */
function CardFooter({ item, people, s, touch }: { item: Requirement; people: readonly RequirementPerson[]; s: TaskStyles; touch: boolean }) {
  useTranslation();
  const hasList = !!item.checklist?.length;
  const hasPeople = !!item.participants?.length;
  const subs = item.children?.total ? item.children : null;
  if (!hasList && !hasPeople && !subs) return null;
  return (
    // 窄列放不下三样(子需求 · 子任务进度 · 参与人)时换行,不把「4/7」挤成「4/」。
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap', rowGap: 6 }} testID="task-card-footer">
      {/* 子需求进度(分支图标 + 「2/5」)和子任务进度(勾选框 + 细条)是两件事,样子也分开。 */}
      {subs ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, height: 20, paddingHorizontal: 7, borderRadius: radius.pill, backgroundColor: colors.subtleFill }} testID="task-subreq-progress" accessibilityLabel={tr('tasks.copy.60', { v0: subs.done, v1: subs.total })}>
          <Ionicons name="git-branch-outline" size={11} color={subs.done === subs.total ? colors.running : colors.textSecondary} />
          <Text style={[s.metaMuted, { fontSize: 11 }]}>{subs.done}/{subs.total}</Text>
        </View>
      ) : null}
      <View style={{ flex: 1, minWidth: hasList ? 96 : 0 }}>{hasList ? <ChecklistProgress item={item} s={s} /> : null}</View>
      {hasPeople ? <ParticipantStack item={item} people={people} s={s} touch={touch} /> : null}
    </View>
  );
}

function AvatarStack({ keys, owners }: { keys: readonly string[]; owners: ReturnType<typeof ownerCounts> }) {
  useTranslation();
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

type FilterKind = 'owner' | 'priority' | 'project' | 'status';

/** 头部筛选的弹层:负责人(头像 + 名字 + 数目,多选)、优先级 / 状态(多选)或项目(单选)。 */
function FilterMenu({ open, touch, owners, selectedOwners, priorities, selectedPriorities, selectedStatuses, meId, onToggleOwner, onTogglePriority, onToggleStatus, onToggleHideDone, onClear, onClose, projects, projectCounts, selectedProject, onPickProject }: {
  open: { kind: FilterKind; x: number; y: number } | null;
  touch: boolean;
  owners: ReturnType<typeof ownerCounts>;
  selectedOwners: readonly string[];
  selectedPriorities: readonly string[];
  meId: string | null;
  onToggleOwner: (key: string) => void;
  onTogglePriority: (p: (typeof REQ_PRIORITIES)[number]) => void;
  /** 给哪几档(旧 Hub 没有 P3;已勾上的 P3 仍列出来,好取消)。 */
  priorities: readonly (typeof REQ_PRIORITIES)[number][];
  selectedStatuses: readonly ReqColumn[];
  onToggleStatus: (c: ReqColumn) => void;
  onToggleHideDone: () => void;
  onClear: (kind: FilterKind) => void;
  onClose: () => void;
  projects: readonly RequirementProject[];
  projectCounts: ReadonlyMap<string, number>;
  selectedProject: string;
  onPickProject: (id: string) => void;
}) {
  useTranslation();
  const s = useTaskStyles();
  // 锚定的浮层:遮罩铺满窗口,安全区只用来夹住弹层的位置(同 TaskCardMenu / AgentRowMenu)。
  const safe = useModalSafePadding('fullScreen');
  const viewport = useWindowDimensions();
  const menuWidth = Math.min(260, viewport.width - safe.paddingLeft - safe.paddingRight - 16);
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
      <Pressable style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, backgroundColor: touch ? 'rgba(0,0,0,0.18)' : 'transparent' }} onPress={onClose} testID="task-filter-scrim" accessibilityLabel={tr('tasks.copy.61')} />
      {open ? (
        <View style={{ position: 'absolute', left: Math.max(8 + safe.paddingLeft, Math.min(open.x, viewport.width - safe.paddingRight - menuWidth - 8)), top: Math.max(open.y, safe.paddingTop + 8), width: menuWidth, maxHeight: 360, padding: 6, borderRadius: radius.control, backgroundColor: colors.card, ...elevated('floating') }} testID={`task-filter-menu-${open.kind}`} accessibilityRole="menu">
          <ScrollView style={{ flexGrow: 0 }}>
            {open.kind === 'project'
              ? [...activeProjects(projects).map(p => ({ id: p.id, name: p.name, color: p.color as string | null })), { id: NO_PROJECT, name: tr('tasks.copy.31'), color: null }].map(p => row(
                p.id, selectedProject === p.id, () => { onPickProject(selectedProject === p.id ? '' : p.id); onClose(); },
                p.color ? <View style={{ width: 10, height: 10, borderRadius: radius.pill, backgroundColor: p.color }} /> : <Ionicons name="remove-circle-outline" size={14} color={colors.textMuted} />,
                p.name, projectCounts.get(p.id) ?? 0,
              ))
              : open.kind === 'owner'
              ? owners.filter(o => o.count > 0 || selectedOwners.includes(o.key)).map(o => row(
                o.key, selectedOwners.includes(o.key), () => onToggleOwner(o.key),
                o.ref ? <AliasAvatar alias={o.name} size={22} /> : <Ionicons name="person-circle-outline" size={22} color={colors.textMuted} />,
                o.key === meKey ? tr('tasks.copy.62', { v0: o.name }) : o.name, o.count,
              ))
              : open.kind === 'status'
              ? [
                ...REQ_COLUMNS.map(c => row(`status-${c}`, selectedStatuses.includes(c), () => onToggleStatus(c), <View style={[s.columnDot, { backgroundColor: STATUS_TONE[c]() }]} />, taskText(REQ_COLUMN_LABEL[c]))),
                <View key="status-sep" style={{ height: 1, marginVertical: 4, backgroundColor: colors.border }} />,
                row('status-hide-done', hidesDone(selectedStatuses), onToggleHideDone, <Ionicons name="eye-off-outline" size={14} color={colors.textMuted} />, tr('tasks.hideDone')),
              ]
              : priorities.map(p => row(p, selectedPriorities.includes(p), () => onTogglePriority(p), <PriorityDot p={p} s={s} />, priorityLabel(p)))}
          </ScrollView>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <Pressable onPress={() => { onClear(open.kind); onClose(); }} style={{ height: 36, justifyContent: 'center', paddingHorizontal: spacing.md }} testID="task-filter-reset" accessibilityRole="button">
              <Text style={s.link}>{tr('tasks.copy.63')}</Text>
            </Pressable>
            {/* 手机 / 双栏没有左栏:「管理项目」放在项目筛选弹层里。 */}
            {open.kind === 'project' ? (
              <Pressable onPress={() => { onClose(); setManagingProjects(true); }} style={{ height: 36, justifyContent: 'center', paddingHorizontal: spacing.md }} testID="task-filter-manage-projects" accessibilityRole="button">
                <Text style={s.link}>{tr('tasks.copy.64')}</Text>
              </Pressable>
            ) : null}
          </View>
        </View>
      ) : null}
    </Modal>
  );
}
