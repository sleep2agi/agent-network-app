import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ActivityIndicator, FlatList, Modal, Platform, Pressable, ScrollView, StyleSheet, View, useWindowDimensions, type PressableStateCallbackType } from 'react-native';
import { Text, TextInput } from './ui-text';
import { colors, onThemeChange, spacing, type as typeScale, radius } from './theme';
import { Ionicons } from './icons';
import AliasAvatar from './AliasAvatar';
import DialogFrame from './DialogFrame';
import { listenEscapeClose } from './escape-close';
import type { HubConfig } from './api';
import { loadAgentOrg, moveAgentDepartment, orgLoadErrorReason } from './agent-org-api';
import { agentCount, agentsDirectlyIn, orgTree, placeAgents, type AgentOrgData, type DemoMove, type PlacedAgent } from './agent-org-model';
import { childrenOf, deptPathLabel, flattenTree, subtreeIds, type Department } from './org-model';
import { createDepartment, deleteDepartment, updateDepartment, OrgRequestError } from './org-api';
import { blockersFromDetail, canEditAnyDepartment, DEPT_MENU_LABEL_KEY, deleteBlockers, deptMenuActions, isDeleteBlocked, type DeleteBlockers, type DeptMenuAction } from './agent-org-dept-menu';
import { anchorRowMenu, rowMenuHeight, rowMenuMetrics } from './agent-row-menu';
import { elevated } from './elevation';
import { uiScale } from './ui-scale';
import { useModalSafePadding } from './safe-area-runtime';
import { pointerUi } from './pointer-ui';
import { SettingsButton, SettingsChoiceRow, SettingsGroup, SettingsRow } from './settings-kit';
import { buttonStyle, buttonTextStyle } from './elevation';
import { useTranslation } from './i18n-react';
import './i18n-agent-org';
import OrgShowcase from './OrgShowcase';
import { peekOrg, recallOrg, rememberOrg } from './swr-cache';

/** canManageStructure = 网络 owner / admin(或 Hub 管理员):能建根部门;旧 Hub 没有 viewer_can 时也按它决定能不能改。 */
type Props = { cfg: HubConfig; networkId?: string; phone: boolean; canManageStructure?: boolean;
  /** 一级栏「组织」整页(2026-11-15):用满主窗口内容区,不套设置页的 760 上限。 */
  fullWidth?: boolean;
  /** 一级栏整页:点 Agent 行 → 打开它的节点页(权限等)。管理员 2026-11-15「点击 AGENT,设置不了权限」。 */
  onOpenAgent?: (alias: string) => void;
  /** 一级栏整页:侧栏顶上的标题(「组织」)。 */
  title?: string;
  /** 一级栏整页:有权管成员时,侧栏多一项「成员与权限」,右侧画这个(代替原来的两个页签)。 */
  renderMembers?: () => ReactNode;
  /** 一级栏整页:部门详情的「成员」页签画什么(人在这个部门里的管理;管理员 2026-11-15「这个 UI/UX 体验非常不好」)。 */
  renderPeople?: (deptId: string | null, onSelect: (id: string | null) => void) => ReactNode };

export default function AgentOrgScreen(p: Props) {
  const [, refreshTheme] = useState(0);
  useEffect(() => onThemeChange(() => refreshTheme(n => n + 1)), []);
  return (
    <View testID="agent-org-page" style={[styles.page, p.fullWidth && styles.pageFill]}>
      {p.networkId
        ? <OrgBody key={JSON.stringify([p.cfg.serverUrl, p.cfg.token, p.networkId])} cfg={p.cfg} networkId={p.networkId} phone={p.phone} canManageStructure={!!p.canManageStructure} fill={!!p.fullWidth && !p.phone} onOpenAgent={p.onOpenAgent} title={p.title} renderMembers={p.renderMembers} renderPeople={p.renderPeople} />
        : <NoNetwork />}
    </View>
  );
}

function NoNetwork() {
  const { t } = useTranslation();
  return <SettingsGroup testID="agent-org-no-network"><SettingsRow label={t('agentOrg.noNetwork')} /></SettingsGroup>;
}

// 管理员 2026-11-15「提升一下 UI/UX 的体验」(一级栏「组织」截图):fill = 一级栏整页。
//   * 不再「组织」套「组织管理」两层标题;统计挪到部门列头。
//   * 整页不滚,部门树和 Agent 列表各自滚到窗口底(以前页面滚 + 列表 400 高再滚,两层滚动)。
//   * 底部「说明」「调整结构」两块收掉:说明进部门列底部,单个移动改成行上悬停「移动到…」。
//   * 部门可折叠;「新建部门」「⋯」看得见,不用先知道右键。
const TREE_COLLAPSED_KEY = 'anet.orgTreeCollapsed';
function readCollapsed(): Set<string> {
  try {
    const raw = (globalThis as { localStorage?: Storage }).localStorage?.getItem(TREE_COLLAPSED_KEY);
    const ids = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(ids) ? ids.filter((x: unknown): x is string => typeof x === 'string') : []);
  } catch { return new Set(); }
}
function writeCollapsed(ids: ReadonlySet<string>) {
  try { (globalThis as { localStorage?: Storage }).localStorage?.setItem(TREE_COLLAPSED_KEY, JSON.stringify([...ids])); } catch { /* 存不了就只在本次有效 */ }
}

function OrgBody(p: { cfg: HubConfig; networkId: string; phone: boolean; canManageStructure: boolean; fill?: boolean; onOpenAgent?: (alias: string) => void; title?: string; renderMembers?: () => ReactNode; renderPeople?: (deptId: string | null, onSelect: (id: string | null) => void) => ReactNode }) {
  const { t } = useTranslation();
  const [attempt, setAttempt] = useState(0);
  const [phase, setPhase] = useState<{ kind: 'loading' } | { kind: 'error'; reason: string } | { kind: 'ready'; data: AgentOrgData | null }>({ kind: 'loading' });
  const [focus, setFocus] = useState<string | null | undefined>(undefined);
  const [moves, setMoves] = useState<DemoMove[]>([]);
  const [pickAgent, setPickAgent] = useState<string | null>(null);
  const [pickDept, setPickDept] = useState<string | null | undefined>(undefined);
  const [adjustNote, setAdjustNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [deptEditor, setDeptEditor] = useState<{ dept?: Department; parent: string | null; mode: 'create' | 'rename' | 'reparent' } | null>(null);
  const [deptNote, setDeptNote] = useState('');
  const [infoOpen, setInfoOpen] = useState(false);
  // 管理员 2026-11-14「右键可以新建组织、重命名组织」:部门树右键(桌面)/ 长按(手机)出菜单。dept null = 空白处 / 未归属行。
  const [deptMenu, setDeptMenu] = useState<{ dept: Department | null; x: number; y: number; touch: boolean } | null>(null);
  const [deleting, setDeleting] = useState<Department | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => (p.fill ? readCollapsed() : new Set()));
  const toggleCollapsed = (id: string) => setCollapsed(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    writeCollapsed(next);
    return next;
  });
  const bulkPending = useRef(false);
  // 整页:右侧是部门详情还是「成员与权限」(管理员 2026-11-15「做的更好一下」:左边做成一整条侧栏,页签收进侧栏)。
  const [view, setView] = useState<'dept' | 'members' | 'chart'>('dept');
  // 部门详情页签:Agent / 成员(人)。换部门时保持在同一个页签。
  const [deptTab, setDeptTab] = useState<'agents' | 'people'>('agents');
  const focusDept = (id: string | null) => { setView('dept'); setFocus(id); };
  // 整页:「已保存到 Hub」这类结果用底部小条提示几秒就消失,不再占一行常驻(以前上下各一条)。
  const toast = p.fill ? (deptNote || adjustNote) : '';
  const toastOk = !['saveForbidden', 'saveNoDepartment', 'saveNoNode', 'saveUnsupported', 'saveFailed', 'bulkNone', 'demoNeedPick'].some(k => toast === t(`agentOrg.${k}`));
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => { setDeptNote(''); setAdjustNote(''); }, toastOk ? 2600 : 6000);
    return () => clearTimeout(id);
  }, [toast, toastOk]);

  useEffect(() => {
    let live = true;
    let painted = false;
    setMoves([]);
    setPickAgent(null);
    setPickDept(undefined);
    setAdjustNote('');
    // 首次画出时定落点;实时结果替换缓存时不动用户已经点到的部门。
    const show = (data: AgentOrgData | null) => {
      setPhase({ kind: 'ready', data });
      if (painted) return;
      painted = true;
      const initialAgents = data ? placeAgents(data, []) : [];
      // #2025：有未归属 Agent 时右栏直接落在「未归属」，不再先落在某个部门上。
      const unowned = data ? agentCount(initialAgents, data, null) : 0;
      const populated = data ? flattenTree(orgTree(data)).find(row => agentsDirectlyIn(initialAgents, row.dept.id).length > 0) : undefined;
      const fallback = data?.directory || unowned > 0 ? null : (data?.departments[0]?.id ?? null);
      setFocus(p.phone ? undefined : (unowned > 0 ? null : (populated?.dept.id ?? fallback)));
    };
    // admin 2026-11-16「这个UI 加载UI太差了」:先画上次读到的组织架构(内存瞬开,磁盘次之),实时结果回来再替换。
    const profile = p.cfg.profileId;
    const mem = peekOrg(profile, p.networkId) as AgentOrgData | null;
    if (mem) show(mem); else setPhase({ kind: 'loading' });
    if (!mem) void recallOrg(profile, p.networkId).then(cached => { if (live && !painted && cached) show(cached as AgentOrgData); });
    void loadAgentOrg(p.cfg, p.networkId).then(data => {
      if (!live) return;
      show(data);
      if (data) rememberOrg(profile, p.networkId, data);
    }, (e: unknown) => { if (live && !painted) setPhase({ kind: 'error', reason: orgLoadErrorReason(e) }); });
    return () => { live = false; };
  }, [p.cfg.serverUrl, p.cfg.token, p.networkId, p.phone, attempt]);

  const data = phase.kind === 'ready' ? phase.data : null;
  const placed = useMemo(() => (data ? placeAgents(data, moves) : []), [data, moves]);
  // 手机(管理员 2026-11-16「手机上没有组织架构啊」):树 → 部门 / 架构图,各自一屏,上面有返回。
  const showTree = !p.phone || (focus === undefined && view !== 'chart');
  const treeApi = !!data?.departmentsApi;
  const openDeptMenu = (dept: Department | null, x: number, y: number, touch: boolean): boolean => {
    if (!deptMenuActions(dept, p.canManageStructure, treeApi).length) return false;
    setDeptMenu({ dept, x, y, touch });
    return true;
  };
  // 同 AgentsScreen:在 document 捕获阶段拦 contextmenu —— 冒泡阶段 WKWebView 可能已经弹了自己的「重新载入」菜单。
  // 只管部门树里面(data-org-dept-tree);行上挂 data-org-dept=部门 id,没有 = 空白处 / 未归属。
  const openRef = useRef(openDeptMenu);
  openRef.current = openDeptMenu;
  useEffect(() => {
    const doc = (globalThis as { document?: { addEventListener?: (t: string, f: (e: any) => void, c: boolean) => void; removeEventListener?: (t: string, f: (e: any) => void, c: boolean) => void } }).document;
    if (Platform.OS !== 'web' || !doc?.addEventListener || !data) return;
    const onContextMenu = (event: any) => {
      if (!event.target?.closest?.('[data-org-dept-tree]')) return;
      const id = event.target.closest('[data-org-dept]')?.getAttribute?.('data-org-dept') ?? null;
      const dept = id ? data.departments.find(d => d.id === id) ?? null : null;
      if (id && !dept) return;
      if (!openRef.current(dept, event.clientX ?? 0, event.clientY ?? 0, false)) return;
      event.preventDefault?.();
      event.stopPropagation?.();
      event.stopImmediatePropagation?.();
    };
    doc.addEventListener('contextmenu', onContextMenu, true);
    return () => doc.removeEventListener?.('contextmenu', onContextMenu, true);
  }, [data]);
  const runMenu = (action: DeptMenuAction, dept: Department | null) => {
    setDeptMenu(null);
    setDeptNote('');
    if (action === 'createRoot') setDeptEditor({ parent: null, mode: 'create' });
    else if (!dept) return;
    else if (action === 'createChild') setDeptEditor({ parent: dept.id, mode: 'create' });
    else if (action === 'rename' || action === 'reparent') setDeptEditor({ dept, parent: dept.parent_id ?? null, mode: action });
    else if (action === 'delete') setDeleting(dept);
  };
  const showDetail = !!data && (p.phone ? focus !== undefined && view !== 'chart' : true);
  // 单个 Agent 换部门:「调整结构」和(整页模式)行上「移动到…」共用。乐观更新,失败回滚。
  const moveOne = (nodeId: string, target: string | null) => {
    if (saving) return;
    const previous = moves.find(m => m.nodeId === nodeId);
    setMoves(prev => [...prev.filter(m => m.nodeId !== nodeId), { nodeId, departmentId: target }]);
    setAdjustNote('');
    setSaving(true);
    void moveAgentDepartment(p.cfg, p.networkId, nodeId, target).then(result => {
      setSaving(false);
      if (result.ok) { setAdjustNote(t('agentOrg.saved')); return; }
      // 失败回滚到这次操作前的状态(没有旧覆盖就不留乐观项)。
      setMoves(prev => {
        const rest = prev.filter(m => m.nodeId !== nodeId);
        return previous ? [...rest, previous] : rest;
      });
      setAdjustNote(t(result.reason === 'forbidden' ? 'agentOrg.saveForbidden'
        : result.reason === 'department' ? 'agentOrg.saveNoDepartment'
        : result.reason === 'node' ? 'agentOrg.saveNoNode'
        : result.reason === 'unsupported' ? 'agentOrg.saveUnsupported'
        : 'agentOrg.saveFailed'));
    });
  };
  const canCreateRoot = !!data && deptMenuActions(null, p.canManageStructure, treeApi).includes('createRoot');
  const editHint = data ? (canEditAnyDepartment(data.departments, p.canManageStructure, treeApi)
    ? <Text testID="agent-org-departments-edit-hint" style={styles.note}>{t(pointerUi() ? 'agentOrg.departmentsEditHint' : 'agentOrg.departmentsEditHint.touch')}</Text>
    : <Text testID="agent-org-departments-elsewhere" style={styles.note}>{t('agentOrg.departmentsElsewhere')}</Text>) : null;
  const infoBody = data ? <View style={{ gap: spacing.xs, paddingBottom: spacing.sm }}>
    {data.agentDepartmentSupported ? <Text testID="agent-org-independent-note" style={styles.note}>{t('agentOrg.independent')}</Text> : null}
    <Text style={styles.note}>{!data.directory ? t('agentOrg.directoryMissing') : !data.departmentsApi ? t('agentOrg.noTree') : t('agentOrg.readOnly')}</Text>
  </View> : null;

  return (
    <View style={p.fill ? styles.fillRoot : undefined}>
      {deptNote && !p.fill ? <Text accessibilityLiveRegion="polite" testID="agent-org-department-result" style={[styles.note, { padding: spacing.md }]}>{deptNote}</Text> : null}
      {phase.kind === 'loading' ? (
        // 管理员 2026-11-15「改成动画吧,那种转圈的」:整页是居中转圈;设置里是带转圈的那一行。
        // 手机「组织」页同样居中转圈(admin 2026-11-16「这也特别丑」:原来是设置风格的一张卡片 + 小转圈)。
        p.fill || p.phone
          ? <View testID="agent-org-loading" style={p.fill ? styles.loadingFill : styles.loadingPhone}><ActivityIndicator size="large" color={colors.accent} /><Text style={styles.note}>{t('agentOrg.loading')}</Text></View>
          : <SettingsGroup testID="agent-org-loading"><SettingsRow label={t('agentOrg.loading')} busy /></SettingsGroup>
      ) : null}
      {phase.kind === 'error' ? (
        // 手机「组织」页 / 整页:居中的说明 + 原因 + 「重试」按钮(admin 2026-11-16「这个感觉也有点太臭了」);设置里仍是一行。
        p.fill || p.phone ? (
          <View testID="agent-org-error" style={p.fill ? styles.loadingFill : styles.loadingPhone}>
            <Ionicons name="cloud-offline-outline" size={36} color={colors.textMuted} />
            <Text style={{ color: colors.text, fontSize: typeScale.body, fontWeight: '600' }}>{t('agentOrg.loadFailedTitle')}</Text>
            <Text testID="agent-org-error-reason" style={[styles.note, { textAlign: 'center', paddingHorizontal: spacing.xl }]}>{t('agentOrg.loadFailedReason', { reason: phase.reason === 'timeout' ? t('agentOrg.reason.timeout') : phase.reason === 'network' ? t('agentOrg.reason.network') : phase.reason })}</Text>
            <Pressable testID="agent-org-retry" accessibilityRole="button" onPress={() => setAttempt(n => n + 1)}
              style={({ pressed }) => [{ marginTop: spacing.sm, minHeight: 40, paddingHorizontal: spacing.xl, borderRadius: radius.control, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' }, pressed && { opacity: 0.8 }]}>
              <Text style={{ color: colors.onAccent, fontSize: typeScale.body, fontWeight: '600' }}>{t('agentOrg.retry')}</Text>
            </Pressable>
          </View>
        ) : (
        <SettingsGroup testID="agent-org-error">
          <SettingsRow label={t('agentOrg.loadFailed')} value={t('agentOrg.retry')} onPress={() => setAttempt(n => n + 1)} testID="agent-org-retry" />
        </SettingsGroup>
        )
      ) : null}
      {phase.kind === 'ready' && data === null ? (
        <SettingsGroup testID="agent-org-empty-hub"><SettingsRow label={t('agentOrg.oldHub')} /></SettingsGroup>
      ) : null}
      {data && (showTree || showDetail || (p.phone && view === 'chart')) ? (
        <View testID="agent-org-tree" style={p.fill ? styles.workspaceFill : p.phone && view === 'chart' ? { flex: 1, minHeight: 0 } : styles.workspace}>
          {/* 手机看架构图:不再套一层外框 + 「16 个部门 · 27 个未归属」工具条(架构图自己就有这些数)。 */}
          {!p.fill && !(p.phone && view === 'chart') ? <View style={styles.toolbar} testID="agent-org-department-actions">
            <View style={styles.toolbarContext}>
              {p.phone && p.title ? null : <Text style={styles.title}>{t('agentOrg.workspaceTitle')}</Text>}
              <Text testID="agent-org-summary" style={styles.note}>{t('agentOrg.summary', { departments: data.departments.length, unowned: agentCount(placed, data, null) })}</Text>
            </View>
            {/* admin 2026-10-24「agent 跟人共用一个组织架构，好像不太好」:部门结构不在这里改。
                这棵树是 Hub 的网络级部门(人和 Agent 共用),增删改统一收在「用户管理 → 成员与部门」;
                这一页只负责 Agent 归属。 */}
            {p.phone && !showTree ? null : editHint}
          </View> : null}
          <View style={!p.phone ? [styles.columns, p.fill && styles.fillColumns] : undefined}>
          {showTree ? (
            <View testID="agent-org-navigation" style={!p.phone ? [styles.navigation, p.fill && styles.navigationFill] : undefined}>
              {p.fill ? <>
                <DepartmentTree fill title={p.title} data={data} placed={placed} focus={view !== 'dept' ? undefined : focus} onFocus={focusDept} collapsed={collapsed} onToggle={toggleCollapsed}
                  nav={[
                    // 管理员 2026-11-15「组织架构图做好看一点，还需要有那种宣传效果」:侧栏第一项「架构图」。
                    { key: 'chart', label: t('agentOrg.showcase.nav'), icon: 'git-network-outline', selected: view === 'chart', onPress: () => setView('chart') },
                    ...(p.renderMembers ? [{ key: 'members', label: t('agentOrg.membersTitle'), icon: 'shield-checkmark-outline' as const, selected: view === 'members', onPress: () => setView('members') }] : []),
                  ]}
                  onMenu={(dept, x, y) => { openDeptMenu(dept, x, y, false); }}
                  summary={t('agentOrg.summary', { departments: data.departments.length, unowned: agentCount(placed, data, null) })}
                  onCreateRoot={canCreateRoot ? () => runMenu('createRoot', null) : undefined} />
                <View testID="agent-org-info" style={styles.treeFooter}>
                  <Pressable testID="agent-org-info-toggle" accessibilityRole="button" accessibilityState={{ expanded: infoOpen }} onPress={() => setInfoOpen(v => !v)} style={styles.treeFooterToggle}>
                    <Ionicons name="information-circle-outline" size={15} color={colors.textMuted} />
                    <Text style={[styles.note, { flex: 1 }]} numberOfLines={1}>{t('agentOrg.aboutTree')}</Text>
                    <Ionicons name={infoOpen ? 'chevron-down' : 'chevron-up'} size={14} color={colors.textMuted} />
                  </Pressable>
                  {infoOpen ? <View style={{ gap: spacing.xs }}>{editHint}<Text style={styles.note}>{t('agentOrg.infoSummary')}</Text>{infoBody}</View> : null}
                </View>
              </> : <>
                {p.phone ? <SettingsGroup testID="agent-org-phone-nav"><SettingsRow label={t('agentOrg.showcase.nav')} onPress={() => setView('chart')} testID="agent-org-chart-open" /></SettingsGroup> : null}
                <DepartmentTree data={data} placed={placed} focus={focus} onFocus={setFocus} onMenu={(dept, x, y) => { openDeptMenu(dept, x, y, true); }} />
              </>}
            </View>
          ) : null}
          {(p.fill || p.phone) && view === 'chart' ? (
            <View style={{ flex: 1, minWidth: 0, minHeight: 0 }} testID="agent-org-chart">
              {p.phone ? (
                <Pressable testID="agent-org-chart-back" accessibilityRole="button" accessibilityLabel={t('agentOrg.back')} onPress={() => setView('dept')} hitSlop={8} style={[styles.phoneBack, { marginHorizontal: spacing.md, marginTop: spacing.sm }]}>
                  <Ionicons name="chevron-back" size={18} color={colors.accent} />
                  <Text style={styles.phoneBackText}>{t('agentOrg.back')}</Text>
                </Pressable>
              ) : null}
              <OrgShowcase compact={!!p.phone} data={data} placed={placed} title={p.title ?? t('agentOrg.workspaceTitle')} onOpenDept={focusDept} onOpenAgent={p.onOpenAgent} />
            </View>
          ) : p.fill && view === 'members' && p.renderMembers ? (
            <View style={{ flex: 1, minWidth: 0, minHeight: 0 }} testID="agent-org-members">
              <View style={styles.detailHeadFill}><Text style={styles.title}>{t('agentOrg.membersTitle')}</Text></View>
              <ScrollView style={{ flex: 1, minHeight: 0 }} contentContainerStyle={{ padding: spacing.md }}>{p.renderMembers()}</ScrollView>
            </View>
          ) : showDetail ? (
            <View style={!p.phone ? { flex: 1, minWidth: 0, minHeight: 0 } : undefined} testID="agent-org-detail">
              <DepartmentDetail key={focus ?? 'unassigned'} data={data} placed={placed} focus={focus ?? null} phone={p.phone} onFocus={setFocus} onBack={() => setFocus(undefined)}
                fill={p.fill}
                note=""
                onMove={p.fill && data.agentDepartmentSupported ? moveOne : undefined}
                moveBusy={saving}
                onOpenAgent={p.fill || p.phone ? p.onOpenAgent : undefined}
                tab={p.fill && p.renderPeople ? deptTab : 'agents'}
                onTab={p.fill && p.renderPeople ? setDeptTab : undefined}
                people={p.fill && p.renderPeople && deptTab === 'people' ? p.renderPeople(focus ?? null, id => focusDept(id)) : null}
                actions={null}
                bulkBusy={saving}
                onBulkAssign={async (departmentId, nodeIds) => {
                  if (bulkPending.current) return;
                  const selected = new Set(nodeIds);
                  const targets = placed.filter(a => a.departmentId === null && selected.has(a.nodeId)).map(a => a.nodeId);
                  if (!targets.length) { setAdjustNote(t('agentOrg.bulkNone')); return; }
                  bulkPending.current = true;
                  setSaving(true);
                  let ok = 0, fail = 0;
                  // 限并发 4：332 个逐个串行要几分钟，全并发又会把 Hub 打满。
                  const queue = [...targets];
                  const worker = async () => {
                    for (let nodeId = queue.shift(); nodeId; nodeId = queue.shift()) {
                      const result = await moveAgentDepartment(p.cfg, p.networkId, nodeId, departmentId);
                      if (result.ok) { ok += 1; setMoves(prev => [...prev.filter(m => m.nodeId !== nodeId), { nodeId: nodeId!, departmentId }]); }
                      else fail += 1;
                    }
                  };
                  await Promise.all([0, 1, 2, 3].map(() => worker()));
                  bulkPending.current = false;
                  setSaving(false);
                  setAdjustNote(t('agentOrg.bulkDone', { ok, fail }));
                }} />
            </View>
          ) : null}
          </View>
        </View>
      ) : null}
      {data && !p.fill ? <View testID="agent-org-info" style={styles.info}>
        <Pressable testID="agent-org-info-toggle" accessibilityRole="button" accessibilityState={{ expanded: infoOpen }} onPress={() => setInfoOpen(v => !v)} style={styles.infoToggle}>
          <Ionicons name="information-circle-outline" size={18} color={colors.textMuted} />
          <Text style={[styles.note, { flex: 1 }]}>{t('agentOrg.infoSummary')}</Text>
          <Ionicons name={infoOpen ? 'chevron-up' : 'chevron-down'} size={16} color={colors.textMuted} />
        </Pressable>
        {infoOpen ? infoBody : null}
      </View> : null}
      {phase.kind === 'ready' && !p.fill ? (
        <DemoAdjust
          data={data}
          placed={placed}
          moves={moves}
          pickAgent={pickAgent}
          pickDept={pickDept}
          note={adjustNote}
          saving={saving || !!deptEditor}
          onPickAgent={setPickAgent}
          onPickDept={setPickDept}
          onApply={() => {
            if (saving) return;
            if (!pickAgent || pickDept === undefined) { setAdjustNote(t('agentOrg.demoNeedPick')); return; }
            moveOne(pickAgent, pickDept);
          }}
        />
      ) : null}
      {toast ? <View pointerEvents="none" style={styles.toastLayer}>
        <View accessibilityLiveRegion="polite" testID="agent-org-toast" style={[styles.toast, !toastOk && { backgroundColor: colors.failed }]}>
          <Ionicons name={toastOk ? 'checkmark-circle' : 'alert-circle'} size={16} color="#ffffff" />
          <Text style={styles.toastText}>{toast}</Text>
        </View>
      </View> : null}
      {data && deptMenu ? <DeptContextMenu target={deptMenu} actions={deptMenuActions(deptMenu.dept, p.canManageStructure, treeApi)} onClose={() => setDeptMenu(null)} onPick={a => runMenu(a, deptMenu.dept)} /> : null}
      {data && deleting ? <DeleteDepartmentDialog cfg={p.cfg} networkId={p.networkId} dept={deleting}
        blockers={deleteBlockers(deleting, data.departments, agentsDirectlyIn(placed, deleting.id).length)}
        onClose={() => setDeleting(null)}
        onDeleted={async () => {
          const gone = deleting;
          const refreshed = await loadAgentOrg(p.cfg, p.networkId);
          if (!refreshed) throw new Error('refresh');
          setPhase({ kind: 'ready', data: refreshed });
          setMoves([]);
          if (focus === gone.id) setFocus(p.phone ? undefined : (gone.parent_id ?? null));
          setDeptNote(t('agentOrg.deleted', { name: gone.name }));
          setDeleting(null);
        }} /> : null}
      {data && deptEditor ? <DepartmentEditor cfg={p.cfg} networkId={p.networkId} data={data} editor={deptEditor} onClose={() => setDeptEditor(null)} onSaved={async department => {
        const refreshed = await loadAgentOrg(p.cfg, p.networkId);
        if (!refreshed?.departmentsApi || !refreshed.departments.some(d => d.id === department.id)) throw new Error('refresh');
        setPhase({ kind: 'ready', data: refreshed });
        setMoves([]);
        setFocus(department.id);
        setDeptNote(t('agentOrg.saved'));
        setDeptEditor(null);
      }} /> : null}
    </View>
  );
}

function OrgAction(p: { label: string; testID: string; onPress: () => void; disabled?: boolean; icon?: 'add'; compact?: boolean }) {
  return <Pressable testID={p.testID} accessibilityRole="button" accessibilityLabel={p.label} accessibilityState={{ disabled: !!p.disabled }} disabled={p.disabled} onPress={p.onPress}
    style={({ pressed }) => [styles.compactAction, p.compact && { minHeight: 34 }, p.disabled && { opacity: 0.45 }, pressed && { opacity: 0.8 }]}>
    {p.icon ? <Ionicons name={p.icon} size={17} color={colors.accent} /> : null}
    <Text style={styles.actionLabel}>{p.label}</Text>
  </Pressable>;
}

function DepartmentEditor(p: { cfg: HubConfig; networkId: string; data: AgentOrgData; editor: { dept?: Department; parent: string | null; mode: 'create' | 'rename' | 'reparent' }; onClose: () => void; onSaved: (dept: Department) => Promise<void> }) {
  const { t } = useTranslation();
  const [name, setName] = useState(p.editor.dept?.name ?? '');
  const [parent, setParent] = useState(p.editor.parent);
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState<Department | null>(null);
  const pending = useRef(false);
  const close = () => { if (!pending.current) p.onClose(); };
  useEffect(() => listenEscapeClose(close), [p.onClose]);
  const tree = orgTree(p.data);
  const excluded = p.editor.dept ? subtreeIds(tree, p.editor.dept.id) : new Set<string>();
  const validName = !!name.trim() && [...name.trim()].length <= 40;
  const validParent = !parent || (!excluded.has(parent) && p.data.departments.some(d => d.id === parent));
  const save = async () => {
    if (pending.current || !validName || !validParent) return;
    pending.current = true;
    setBusy(true); setError('');
    let confirmed = saved;
    try {
      if (!confirmed) {
        // Omitted leader/sort fields are preserved by the Hub, including concurrent changes.
        const result = p.editor.dept
          ? await updateDepartment(p.cfg, p.networkId, p.editor.dept.id, p.editor.mode === 'rename' ? { name: name.trim() } : { parent_id: parent })
          : await createDepartment(p.cfg, p.networkId, { name: name.trim(), parent_id: parent });
        if (!result || typeof result.id !== 'string' || !result.id.trim() || typeof result.name !== 'string' || !result.name.trim() || (p.editor.dept && result.id !== p.editor.dept.id)) throw new Error('invalid response');
        confirmed = result;
        setSaved(result);
      }
      await p.onSaved(confirmed);
    } catch (e) {
      setError(t(confirmed ? 'agentOrg.departmentRefreshFailed'
        : e instanceof OrgRequestError && (e.status === 401 || e.status === 403) ? 'agentOrg.departmentForbidden'
        : e instanceof OrgRequestError && (e.status === 405 || e.status === 501 || (e.status === 404 && e.code !== 'department_not_found')) ? 'agentOrg.departmentUnsupported'
        : e instanceof OrgRequestError && e.status === 409 ? 'agentOrg.departmentConflict'
        : e instanceof OrgRequestError && (e.code === 'department_cycle' || e.code === 'department_too_deep') ? 'agentOrg.departmentHierarchyInvalid'
        : e instanceof OrgRequestError && (e.code === 'parent_not_found' || e.code === 'department_not_found') ? 'agentOrg.saveNoDepartment'
        : 'agentOrg.saveFailed'));
    } finally { pending.current = false; setBusy(false); }
  };
  const rows = flattenTree(tree).filter(row => !excluded.has(row.dept.id));
  return <DialogFrame title={t(p.editor.mode === 'create' ? (p.editor.parent ? 'agentOrg.newChild' : 'agentOrg.newDepartment') : p.editor.mode === 'rename' ? 'agentOrg.renameDepartment' : 'agentOrg.reparentDepartment')} closeLabel={t('agentOrg.close')} onClose={close} height={p.editor.mode === 'rename' ? undefined : 640} testID="agent-org-department-editor"
    footer={<SettingsButton label={t(busy ? 'agentOrg.saving' : saved ? 'agentOrg.retryRefresh' : 'agentOrg.demoApply')} disabled={busy || !validName || !validParent} onPress={() => void save()} testID="agent-org-department-save" />}>
    <Text testID="agent-org-shared-tree-note" style={styles.note}>{t('agentOrg.sharedTree')}</Text>
    {p.editor.mode !== 'reparent' ? <>
      <Text style={styles.note}>{t('agentOrg.departmentName')}</Text>
      <View style={styles.search}><TextInput autoFocus editable={!busy && !saved} testID="agent-org-department-name" value={name} onChangeText={setName} accessibilityLabel={t('agentOrg.departmentName')} placeholder={t('agentOrg.departmentName')} placeholderTextColor={colors.textMuted} style={styles.searchInput} /></View>
      {!validName ? <Text style={styles.note} testID="agent-org-department-validation">{t('agentOrg.departmentNameInvalid')}</Text> : null}
    </> : <Text style={styles.title}>{name}</Text>}
    {p.editor.mode !== 'rename' ? <>
      <Text style={styles.note}>{t('agentOrg.parentDepartment')}</Text>
      <Text testID="agent-org-department-parent-value" style={styles.note}>{parent ? deptPathLabel(tree, parent) : t('agentOrg.networkRoot')}</Text>
      <View style={styles.search}><TextInput value={query} onChangeText={setQuery} accessibilityLabel={t('agentOrg.searchOptions')} placeholder={t('agentOrg.searchOptions')} placeholderTextColor={colors.textMuted} style={styles.searchInput} testID="agent-org-department-parent-search" /></View>
      <SettingsChoiceRow label={t('agentOrg.networkRoot')} selected={parent === null} disabled={busy || !!saved} onPress={() => setParent(null)} testID="agent-org-parent-root" />
      {rows.filter(row => deptPathLabel(tree, row.dept.id).toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())).map(row => <SettingsChoiceRow key={row.dept.id} label={deptPathLabel(tree, row.dept.id)} selected={parent === row.dept.id} disabled={busy || !!saved} onPress={() => setParent(row.dept.id)} testID={`agent-org-parent-${row.dept.id}`} />)}
    </> : null}
    {error ? <Text accessibilityRole="alert" testID="agent-org-department-error" style={[styles.note, { color: colors.failed }]}>{error}</Text> : null}
  </DialogFrame>;
}

function DepartmentTree(p: { data: AgentOrgData; placed: PlacedAgent[]; focus: string | null | undefined; onFocus: (id: string | null) => void; onMenu?: (dept: Department | null, x: number, y: number) => void;
  /** 一级栏整页:列头带统计 / 新建,未归属置顶,可折叠,行更紧,树撑满列高。 */
  fill?: boolean; collapsed?: ReadonlySet<string>; onToggle?: (id: string) => void; summary?: string; onCreateRoot?: () => void;
  title?: string; nav?: { key: string; label: string; icon: 'git-network-outline' | 'shield-checkmark-outline'; selected: boolean; onPress: () => void }[] }) {
  const { t } = useTranslation();
  const rows = flattenTree(orgTree(p.data), p.fill ? { collapsed: p.collapsed } : {});
  const unowned = agentCount(p.placed, p.data, null);
  const unassignedRow = p.data.directory || unowned > 0 ? (
    <DepartmentRow
      testID="agent-org-dept-unassigned"
      label={t('agentOrg.unowned')}
      selected={p.focus === null}
      count={unowned}
      attention={p.fill && unowned > 0}
      dense={p.fill}
      onPress={() => p.onFocus(null)}
      onMenuAt={p.onMenu ? (x, y) => p.onMenu!(null, x, y) : undefined}
    />
  ) : null;
  const deptRows = rows.length ? rows.map(row => (
    <DepartmentRow
      key={row.dept.id}
      testID={`agent-org-dept-${row.dept.id}`}
      label={row.dept.name}
      depth={row.depth}
      selected={p.focus === row.dept.id}
      count={agentCount(p.placed, p.data, row.dept.id)}
      onPress={() => p.onFocus(row.dept.id)}
      deptId={row.dept.id}
      dense={p.fill}
      expanded={p.fill && row.hasChildren ? !p.collapsed?.has(row.dept.id) : undefined}
      onToggle={p.fill && row.hasChildren && p.onToggle ? () => p.onToggle!(row.dept.id) : undefined}
      onMenuAt={p.onMenu ? (x, y) => p.onMenu!(row.dept, x, y) : undefined}
    />
  )) : <SettingsRow label={t('agentOrg.empty')} testID="agent-org-empty" />;
  if (!p.fill) return (
    <View testID="agent-org-departments" style={{ padding: spacing.sm }} {...({ dataSet: { orgDeptTree: '1' } } as object)}>
      <Text style={styles.sectionLabel}>{t('agentOrg.departments')}</Text>
      <ScrollView style={{ maxHeight: 560 }}>
      {deptRows}
      {unassignedRow}
      </ScrollView>
    </View>
  );
  return (
    <View testID="agent-org-departments" style={{ flex: 1, minHeight: 0 }} {...({ dataSet: { orgDeptTree: '1' } } as object)}>
      <View style={styles.treeHead}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={p.title ? styles.sidebarTitle : styles.treeHeadTitle} accessibilityRole={p.title ? 'header' : undefined}>{p.title ?? t('agentOrg.departments')}</Text>
          {p.summary ? <Text testID="agent-org-summary" numberOfLines={1} style={styles.treeHeadSub}>{p.summary}</Text> : null}
        </View>
        {p.onCreateRoot ? <IconAction testID="agent-org-create-root" icon="add" label={t('agentOrg.newDepartmentAction')} onPress={() => p.onCreateRoot!()} /> : null}
      </View>
      <ScrollView style={{ flex: 1, minHeight: 0 }} showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: spacing.sm, paddingBottom: spacing.md }}>
        {p.nav?.length ? <>
          {p.nav.map(item => (
            <Pressable key={item.key} testID={`agent-org-nav-${item.key}`} accessibilityRole="button" accessibilityState={{ selected: item.selected }} aria-selected={item.selected} onPress={item.onPress}
              style={({ pressed, hovered }: PressableStateCallbackType & { hovered?: boolean }) => [styles.departmentRowDense, { paddingLeft: 2 }, (pressed || hovered) && { backgroundColor: colors.rowHover }, item.selected && { backgroundColor: colors.railActiveBg }]}>
              <View style={styles.treeChevron} />
              <Ionicons name={item.icon} size={16} color={item.selected ? colors.accent : colors.textMuted} />
              <Text numberOfLines={1} style={{ flex: 1, minWidth: 0, color: item.selected ? colors.accent : colors.text, fontSize: typeScale.small, fontWeight: '600' }}>{item.label}</Text>
            </Pressable>
          ))}
          <Text style={styles.treeSection}>{t('agentOrg.departments')}</Text>
        </> : null}
        {unassignedRow}
        {unassignedRow ? <View style={styles.treeDivider} /> : null}
        {deptRows}
      </ScrollView>
    </View>
  );
}

function IconAction(p: { testID: string; icon: 'add' | 'ellipsis-horizontal'; label: string; onPress: (x: number, y: number) => void; size?: number }) {
  return <Pressable testID={p.testID} accessibilityRole="button" accessibilityLabel={p.label} {...({ title: p.label } as object)}
    onPress={e => p.onPress(e.nativeEvent.pageX, e.nativeEvent.pageY)}
    style={({ pressed, hovered }: PressableStateCallbackType & { hovered?: boolean }) => [styles.iconAction, (hovered || pressed) && { backgroundColor: colors.rowActive }]}>
    <Ionicons name={p.icon} size={p.size ?? 18} color={colors.textSecondary} />
  </Pressable>;
}

const TREE_INDENT = 14;
function DepartmentRow(p: { testID: string; label: string; depth?: number; selected: boolean; count: number; onPress: () => void; deptId?: string; onMenuAt?: (x: number, y: number) => void;
  dense?: boolean; expanded?: boolean; onToggle?: () => void; attention?: boolean }) {
  const { t } = useTranslation();
  const pointer = pointerUi();
  const unassigned = p.testID === 'agent-org-dept-unassigned';
  if (p.dense) {
    // 整页:行 34 高;左侧固定一格放折叠箭头(没有子部门就空着,文字照样对齐);悬停出「⋯」。
    return <Pressable testID={p.testID} accessibilityRole="button" accessibilityLabel={`${p.label}, ${t('agentOrg.agentsCount', { count: p.count })}`} accessibilityState={{ selected: p.selected, expanded: p.expanded }} aria-selected={p.selected} onPress={p.onPress}
      {...(p.deptId ? ({ dataSet: { orgDept: p.deptId } } as object) : {})}
      onLongPress={pointer ? undefined : p.onMenuAt ? e => p.onMenuAt!(e.nativeEvent.pageX, e.nativeEvent.pageY) : undefined}
      style={({ pressed, hovered }: PressableStateCallbackType & { hovered?: boolean }) => [styles.departmentRowDense, { paddingLeft: 2 + (p.depth ?? 0) * TREE_INDENT }, (pressed || hovered) && { backgroundColor: colors.rowHover }, p.selected && { backgroundColor: colors.railActiveBg }]}>
      {({ hovered }: PressableStateCallbackType & { hovered?: boolean }) => <>
        {p.onToggle ? <Pressable testID={`${p.testID}-toggle`} accessibilityRole="button" accessibilityLabel={t(p.expanded ? 'agentOrg.collapseDept' : 'agentOrg.expandDept', { name: p.label })} aria-expanded={p.expanded}
          onPress={e => { e.stopPropagation?.(); p.onToggle!(); }} hitSlop={4} style={styles.treeChevron}>
          <Ionicons name={p.expanded ? 'chevron-down' : 'chevron-forward'} size={13} color={colors.textMuted} />
        </Pressable> : <View style={styles.treeChevron} />}
        <Ionicons name={unassigned ? 'file-tray-outline' : (p.expanded ? 'folder-open-outline' : 'folder-outline')} size={16} color={p.selected ? colors.accent : p.attention ? colors.blocked : colors.textMuted} />
        <Text testID={`${p.testID}-label`} numberOfLines={1} style={{ flex: 1, minWidth: 0, color: p.selected ? colors.accent : colors.text, fontSize: typeScale.small, fontWeight: p.selected || unassigned ? '600' : '400' }}>{p.label}</Text>
        {/* 数字和「⋯」叠在同一格:悬停时换成「⋯」。按钮一直挂着、只切透明度 —— 悬停时才挂载的按钮在 web 上点不中。 */}
        <View style={styles.countSlot}>
          <Text testID={`${p.testID}-value`} style={[styles.countDense, p.attention && { color: colors.blocked, fontWeight: '600' }, hovered && p.onMenuAt && pointer && { opacity: 0 }]}>{p.count}</Text>
          {p.onMenuAt && pointer ? <View style={[styles.countSlotMore, { opacity: hovered ? 1 : 0 }]}>
            <IconAction testID={`${p.testID}-more`} icon="ellipsis-horizontal" size={15} label={t('agentOrg.moreActions', { name: p.label })} onPress={(x, y) => p.onMenuAt!(x, y)} />
          </View> : null}
        </View>
      </>}
    </Pressable>;
  }
  return <Pressable testID={p.testID} accessibilityRole="button" accessibilityLabel={`${p.label}, ${t('agentOrg.agentsCount', { count: p.count })}`} accessibilityState={{ selected: p.selected }} aria-selected={p.selected} onPress={p.onPress}
    {...(p.deptId ? ({ dataSet: { orgDept: p.deptId } } as object) : {})}
    // 触屏长按出同一份菜单;鼠标(pointer)走右键 —— document 捕获见 OrgBody。
    onLongPress={pointer ? undefined : p.onMenuAt ? e => p.onMenuAt!(e.nativeEvent.pageX, e.nativeEvent.pageY) : undefined}
    style={({ pressed, hovered }: PressableStateCallbackType & { hovered?: boolean }) => [styles.departmentRow, { paddingLeft: spacing.sm + (p.depth ?? 0) * 16 }, (pressed || hovered) && { backgroundColor: colors.rowHover }, p.selected && { backgroundColor: colors.railActiveBg }]}>
    <Ionicons name={unassigned ? 'file-tray-outline' : 'folder-outline'} size={17} color={p.selected ? colors.accent : colors.textMuted} />
    <Text testID={`${p.testID}-label`} numberOfLines={1} style={{ flex: 1, minWidth: 0, color: p.selected ? colors.accent : colors.text, fontSize: typeScale.small, fontWeight: p.selected ? '600' : '400' }}>{p.label}</Text>
    <Text testID={`${p.testID}-value`} style={[styles.count, { flexShrink: 0 }]}>{p.count}</Text>
  </Pressable>;
}

function DepartmentDetail(p: { data: AgentOrgData; placed: PlacedAgent[]; focus: string | null; phone: boolean; onFocus: (id: string) => void; onBack: () => void; actions: ReactNode; onBulkAssign?: (departmentId: string, nodeIds: string[]) => void; bulkBusy?: boolean;
  fill?: boolean; note?: string; onMove?: (nodeId: string, departmentId: string | null) => void; moveBusy?: boolean; onOpenAgent?: (alias: string) => void;
  tab?: 'agents' | 'people'; onTab?: (tab: 'agents' | 'people') => void; people?: ReactNode }) {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const [moving, setMoving] = useState<PlacedAgent | null>(null);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkSelection, setBulkSelection] = useState<{ departmentId: string; nodeIds: string[] } | null>(null);
  const memberScroll = useRef<ScrollView>(null);
  useEffect(() => { memberScroll.current?.scrollTo({ y: 0, animated: false }); }, [p.focus, query]);
  useEffect(() => {
    if (bulkSelection) return listenEscapeClose(() => setBulkSelection(null));
  }, [bulkSelection]);
  const dept = p.focus ? p.data.departments.find(d => d.id === p.focus) : undefined;
  const title = p.focus === null ? t('agentOrg.unowned') : (dept?.name ?? t('agentOrg.unowned'));
  const agents = agentsDirectlyIn(p.placed, p.focus);
  const needle = query.trim().toLocaleLowerCase();
  const filtered = agents.filter(agent => `${agent.alias} ${agent.ownerName ?? ''} ${agent.nodeId}`.toLocaleLowerCase().includes(needle));
  // Codex P2：一个部门可能有几百个 Agent，整组一次性铺出来会拖慢首屏；只先渲染前 60 行，
  // 其余靠上面的搜索缩小范围（不是隐藏数据：搜索范围仍是全部 filtered）。
  const ROW_CAP = 60;
  const shown = filtered.slice(0, ROW_CAP);
  const hidden = filtered.length - shown.length;
  const children = p.focus ? childrenOf(orgTree(p.data), p.focus) : [];
  const deptPath = p.focus ? deptPathLabel(orgTree(p.data), p.focus) : '';
  if (p.fill) return (
    <View testID="agent-org-detail-card" style={styles.detailFill}>
      <View style={styles.detailHeadFill}>
        <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
          <View style={styles.memberTitle}>
            <Text numberOfLines={1} style={[styles.title, { flexShrink: 1 }]}>{title}</Text>
            <Text testID="agent-org-member-count" style={styles.countDense}>{t('agentOrg.agentsCount', { count: agents.length })}</Text>
          </View>
          <Text numberOfLines={1} style={styles.treeHeadSub}>{deptPath && deptPath !== title ? `${deptPath} · ` : ''}{p.tab === 'people' ? t('agentOrg.people.sub') : t('agentOrg.directMembers')}</Text>
        </View>
        {p.onTab ? (
          <View style={styles.segTabs} accessibilityRole="tablist" testID="agent-org-dept-tabs">
            {(['agents', 'people'] as const).map(k => (
              <Pressable key={k} accessibilityRole="tab" accessibilityState={{ selected: p.tab === k }} aria-selected={p.tab === k} onPress={() => p.onTab!(k)} testID={`agent-org-dept-tab-${k}`}
                style={[styles.segTab, p.tab === k && styles.segTabOn]}>
                <Ionicons name={k === 'agents' ? 'sparkles-outline' : 'people-outline'} size={14} color={p.tab === k ? colors.text : colors.textMuted} />
                <Text style={[styles.segTabText, p.tab === k && styles.segTabTextOn]}>{k === 'agents' ? t('agentOrg.tab.agents') : t('agentOrg.tab.people')}</Text>
              </Pressable>
            ))}
          </View>
        ) : null}
        {p.tab !== 'people' ? <View style={[styles.search, styles.searchFill]}>
          <Ionicons name="search-outline" size={15} color={colors.textMuted} />
          <TextInput testID="agent-org-member-search" value={query} onChangeText={setQuery} placeholder={t('agentOrg.searchAgents')} accessibilityLabel={t('agentOrg.searchAgents')} placeholderTextColor={colors.textMuted} style={[styles.searchInput, { minHeight: 34, paddingVertical: 0 }]} />
        </View> : null}
        {p.tab !== 'people' && p.focus === null && filtered.length > 0 && p.onBulkAssign && p.data.departments.length > 0 ? (
          <View style={styles.bulkAction}>
            {needle ? <Text testID="agent-org-bulk-count" style={styles.note}>{t('agentOrg.bulkScope', { count: filtered.length })}</Text> : null}
            <OrgAction label={t('agentOrg.bulkAssign', { count: filtered.length })} disabled={!!p.bulkBusy} testID="agent-org-bulk-assign" onPress={() => setBulkOpen(true)} compact />
          </View>
        ) : null}
      </View>
      {p.note ? <Text accessibilityLiveRegion="polite" testID="agent-org-demo-result" style={[styles.note, { paddingHorizontal: spacing.lg, paddingTop: spacing.sm }]}>{p.note}</Text> : null}
      {bulkOpen ? <StructureSelector title={t('agentOrg.bulkPickDept')} onClose={() => setBulkOpen(false)}
            options={flattenTree(orgTree(p.data)).map(row => ({ id: row.dept.id, label: row.dept.name, testID: `agent-org-bulk-dept-${row.dept.id}` }))}
            selected={undefined}
            onPick={id => { setBulkOpen(false); if (id) setBulkSelection({ departmentId: id, nodeIds: filtered.map(agent => agent.nodeId) }); }} /> : null}
      {bulkSelection ? <DialogFrame title={t('agentOrg.bulkConfirmTitle')} closeLabel={t('agentOrg.close')} onClose={() => setBulkSelection(null)} testID="agent-org-bulk-confirm"
        footer={<SettingsButton label={t('agentOrg.bulkConfirmAction')} disabled={!!p.bulkBusy} testID="agent-org-bulk-confirm-apply" onPress={() => {
          if (p.bulkBusy) return;
          const selection = bulkSelection;
          setBulkSelection(null);
          p.onBulkAssign?.(selection.departmentId, selection.nodeIds);
        }} />}>
        <Text style={styles.note}>{t('agentOrg.bulkConfirm', { count: bulkSelection.nodeIds.length, department: p.data.departments.find(d => d.id === bulkSelection.departmentId)?.name ?? '' })}</Text>
      </DialogFrame> : null}
      {moving && p.onMove ? <StructureSelector title={t('agentOrg.moveToTitle', { name: moving.alias })} onClose={() => setMoving(null)}
        options={[{ id: null, label: t('agentOrg.unowned'), testID: 'agent-org-move-dept-unassigned' }, ...flattenTree(orgTree(p.data)).map(row => ({ id: row.dept.id, label: deptPathLabel(orgTree(p.data), row.dept.id), testID: `agent-org-move-dept-${row.dept.id}` }))]}
        selected={moving.departmentId}
        onPick={id => { const agent = moving; setMoving(null); if (id !== agent.departmentId) p.onMove!(agent.nodeId, id); }} /> : null}
      {p.tab === 'people' ? <View style={{ flex: 1, minHeight: 0 }} testID="agent-org-dept-people">{p.people}</View> : null}
      {p.tab !== 'people' ? <ScrollView ref={memberScroll} testID="agent-org-member-list" style={{ flex: 1, minHeight: 0 }} contentContainerStyle={{ paddingHorizontal: spacing.sm, paddingBottom: spacing.md }} keyboardShouldPersistTaps="handled">
        {children.map(child => (
          <Pressable key={child.id} testID={`agent-org-child-${child.id}`} accessibilityRole="button" onPress={() => p.onFocus(child.id)}
            style={({ hovered, pressed }: PressableStateCallbackType & { hovered?: boolean }) => [styles.agentRowFill, (hovered || pressed) && { backgroundColor: colors.rowHover }]}>
            <View style={styles.folderBadge}><Ionicons name="folder-outline" size={16} color={colors.textSecondary} /></View>
            <Text numberOfLines={1} style={{ flex: 1, minWidth: 0, color: colors.text, fontSize: typeScale.body, fontWeight: '500' }}>{child.name}</Text>
            <Text style={styles.note}>{t('agentOrg.agentsCount', { count: agentCount(p.placed, p.data, child.id) })}</Text>
            <Ionicons name="chevron-forward" size={15} color={colors.textMuted} />
          </Pressable>
        ))}
        {children.length && filtered.length ? <View style={[styles.treeDivider, { marginHorizontal: spacing.sm }]} /> : null}
        {filtered.length ? shown.map(agent => <AgentLine key={agent.nodeId} agent={agent} fill onMove={p.onMove && !p.moveBusy ? () => setMoving(agent) : undefined} onOpen={p.onOpenAgent ? () => p.onOpenAgent!(agent.alias) : undefined} />) : (children.length ? null : <View testID={agents.length ? 'agent-org-no-results' : 'agent-org-no-agents'} style={styles.empty}>
          <Ionicons name={agents.length ? 'search-outline' : 'people-outline'} size={30} color={colors.textMuted} />
          <Text style={styles.note}>{t(agents.length ? 'agentOrg.noResults' : 'agentOrg.noAgents')}</Text>
        </View>)}
        {hidden > 0 ? <Text testID="agent-org-more" style={[styles.note, { padding: spacing.md }]}>{t('agentOrg.moreAgents', { count: hidden })}</Text> : null}
      </ScrollView> : null}
    </View>
  );
  return (
    <View testID="agent-org-detail-card" style={styles.detail}>
      {p.phone ? (
        // 手机(管理员 2026-11-16「手机上的体验提升一下吧」):返回是左上一个小链接,不再是整行「全部部门 >」。
        <Pressable testID="agent-org-back" accessibilityRole="button" accessibilityLabel={t('agentOrg.back')} onPress={p.onBack} hitSlop={8} style={styles.phoneBack}>
          <Ionicons name="chevron-back" size={18} color={colors.accent} />
          <Text style={styles.phoneBackText}>{t('agentOrg.back')}</Text>
        </Pressable>
      ) : null}
      <View style={styles.detailHeading}>
        <View style={styles.memberTitle}>
          <Text numberOfLines={2} style={[styles.title, { flexShrink: 1 }]}>{title}</Text>
          <Text testID="agent-org-member-count" style={styles.count}>{t('agentOrg.agentsCount', { count: agents.length })}</Text>
        </View>
        {p.actions}
        {p.focus === null && filtered.length > 0 && p.onBulkAssign && p.data.departments.length > 0 ? (
          <View style={styles.bulkAction}>
            <Text testID="agent-org-bulk-count" style={styles.note}>{t('agentOrg.bulkScope', { count: filtered.length })}</Text>
            <OrgAction label={t('agentOrg.bulkAssign', { count: filtered.length })} disabled={!!p.bulkBusy} testID="agent-org-bulk-assign" onPress={() => setBulkOpen(true)} />
          </View>
        ) : null}
      </View>
      {p.phone ? (deptPath && deptPath !== title ? <Text numberOfLines={1} testID="agent-org-dept-path" style={styles.note}>{deptPath}</Text> : null) : <Text style={styles.note}>{t('agentOrg.directMembers')}</Text>}
      {bulkOpen ? <StructureSelector title={t('agentOrg.bulkPickDept')} onClose={() => setBulkOpen(false)}
            options={flattenTree(orgTree(p.data)).map(row => ({ id: row.dept.id, label: row.dept.name, testID: `agent-org-bulk-dept-${row.dept.id}` }))}
            selected={undefined}
            onPick={id => { setBulkOpen(false); if (id) setBulkSelection({ departmentId: id, nodeIds: filtered.map(agent => agent.nodeId) }); }} /> : null}
      {bulkSelection ? <DialogFrame title={t('agentOrg.bulkConfirmTitle')} closeLabel={t('agentOrg.close')} onClose={() => setBulkSelection(null)} testID="agent-org-bulk-confirm"
        footer={<SettingsButton label={t('agentOrg.bulkConfirmAction')} disabled={!!p.bulkBusy} testID="agent-org-bulk-confirm-apply" onPress={() => {
          if (p.bulkBusy) return;
          const selection = bulkSelection;
          setBulkSelection(null);
          p.onBulkAssign?.(selection.departmentId, selection.nodeIds);
        }} />}>
        <Text style={styles.note}>{t('agentOrg.bulkConfirm', { count: bulkSelection.nodeIds.length, department: p.data.departments.find(d => d.id === bulkSelection.departmentId)?.name ?? '' })}</Text>
      </DialogFrame> : null}
      <View style={styles.search}>
        <Ionicons name="search-outline" size={17} color={colors.textMuted} />
        <TextInput testID="agent-org-member-search" value={query} onChangeText={setQuery} placeholder={t('agentOrg.searchAgents')} accessibilityLabel={t('agentOrg.searchAgents')} placeholderTextColor={colors.textMuted} style={styles.searchInput} />
      </View>
      <ScrollView ref={memberScroll} testID="agent-org-member-list" style={styles.memberList} contentContainerStyle={{ paddingBottom: spacing.sm }} keyboardShouldPersistTaps="handled">
      {children.map(child => p.phone ? (
        <Pressable key={child.id} testID={`agent-org-child-${child.id}`} accessibilityRole="button" onPress={() => p.onFocus(child.id)}
          style={({ pressed }) => [styles.agentRow, pressed && { backgroundColor: colors.rowHover }]}>
          <View style={styles.folderBadge}><Ionicons name="folder-outline" size={18} color={colors.textSecondary} /></View>
          <Text numberOfLines={1} style={{ flex: 1, minWidth: 0, color: colors.text, fontSize: typeScale.body, fontWeight: '500' }}>{child.name}</Text>
          <Text style={styles.note}>{t('agentOrg.agentsCount', { count: agentCount(p.placed, p.data, child.id) })}</Text>
          <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
        </Pressable>
      ) : (
        <SettingsRow
          key={child.id}
          testID={`agent-org-child-${child.id}`}
          label={child.name}
          value={t('agentOrg.agentsCount', { count: agentCount(p.placed, p.data, child.id) })}
          onPress={() => p.onFocus(child.id)}
        />
      ))}
        {filtered.length ? shown.map(agent => <AgentLine key={agent.nodeId} agent={agent} onOpen={p.onOpenAgent ? () => p.onOpenAgent!(agent.alias) : undefined} />) : <View testID={agents.length ? 'agent-org-no-results' : 'agent-org-no-agents'} style={styles.empty}>
          <Ionicons name={agents.length ? 'search-outline' : 'people-outline'} size={30} color={colors.textMuted} />
          <Text style={styles.note}>{t(agents.length ? 'agentOrg.noResults' : 'agentOrg.noAgents')}</Text>
        </View>}
        {hidden > 0 ? <Text testID="agent-org-more" style={[styles.note, { paddingVertical: spacing.md }]}>{t('agentOrg.moreAgents', { count: hidden })}</Text> : null}
      </ScrollView>
    </View>
  );
}

function AgentLine(p: { agent: PlacedAgent; fill?: boolean; onMove?: () => void; onOpen?: () => void }) {
  const { t } = useTranslation();
  const agent = p.agent;
  const subtitle = agent.ownerName ? t('agentOrg.owner', { name: agent.ownerName }) : t('agentOrg.noOwner');
  if (p.fill) {
    // 整页:一行 48 高;负责人放右侧一列(以前每行第二行都是「负责人 admin」);
    // 有 lifecycle 的 Hub 在头像角上标运行 / 未运行;悬停出「移动到…」。
    const live = agent.lifecycleState == null ? null : agent.lifecycleState === 'active';
    // 整行可点 → 节点页(落在「权限」)。以前行不可点,点上去只会选中文字。
    return <Pressable testID={`agent-org-agent-${agent.nodeId}`} focusable={!!p.onOpen} disabled={!p.onOpen} onPress={p.onOpen}
      accessibilityRole={p.onOpen ? 'button' : undefined} accessibilityLabel={p.onOpen ? t('agentOrg.openAgent', { name: agent.alias }) : undefined}
      style={({ hovered }: PressableStateCallbackType & { hovered?: boolean }) => [styles.agentRowFill, p.onOpen && { cursor: 'pointer' } as object, hovered && { backgroundColor: colors.rowHover }]}>
      {({ hovered }: PressableStateCallbackType & { hovered?: boolean }) => <>
        <View>
          <AliasAvatar alias={agent.alias} size={30} />
          {live !== null ? <View accessibilityLabel={t(live ? 'agentOrg.lifecycleActive' : 'agentOrg.lifecycleIdle')} style={[styles.liveDot, { backgroundColor: live ? colors.running : colors.rest }]} /> : null}
        </View>
        <Text testID={`agent-org-agent-${agent.nodeId}-label`} numberOfLines={1} style={{ flex: 1, minWidth: 0, color: colors.text, fontSize: typeScale.body, fontWeight: '500' }}>{agent.alias}</Text>
        <Text numberOfLines={1} style={[styles.ownerCol, !agent.ownerName && { fontStyle: 'italic' }]}>{agent.ownerName ?? t('agentOrg.noOwner')}</Text>
        <View style={[styles.rowActionSlot, { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 2 }]}>
          {p.onMove ? <Pressable testID={`agent-org-agent-${agent.nodeId}-move`} accessibilityRole="button" accessibilityLabel={`${t('agentOrg.moveTo')} ${agent.alias}`} onPress={e => { e.stopPropagation?.(); p.onMove!(); }}
            style={({ hovered: h, pressed }: PressableStateCallbackType & { hovered?: boolean }) => [styles.moveButton, { opacity: hovered || h ? 1 : 0 }, (h || pressed) && { backgroundColor: colors.rowActive }]}>
            <Ionicons name="return-up-forward-outline" size={14} color={colors.accent} />
            <Text style={{ color: colors.accent, fontSize: typeScale.small, fontWeight: '500' }}>{t('agentOrg.moveTo')}</Text>
          </Pressable> : null}
          {p.onOpen ? <Ionicons name="chevron-forward" size={15} color={colors.textMuted} /> : null}
        </View>
      </>}
    </Pressable>;
  }
  const body = <>
    <AliasAvatar alias={agent.alias} size={36} />
    <View style={{ flex: 1, minWidth: 0, gap: spacing.xs }}>
      <Text testID={`agent-org-agent-${agent.nodeId}-label`} numberOfLines={1} style={{ color: colors.text, fontSize: typeScale.body, fontWeight: '500' }}>{agent.alias}</Text>
      <Text numberOfLines={1} style={styles.note}>{subtitle}</Text>
    </View>
    {p.onOpen ? <Ionicons name="chevron-forward" size={16} color={colors.textMuted} /> : null}
  </>;
  // 手机「组织」页:整行可点 → 节点页(和桌面整页一致);设置里那一页不传 onOpen,仍是静态行。
  if (p.onOpen) return <Pressable testID={`agent-org-agent-${agent.nodeId}`} accessibilityRole="button" accessibilityLabel={t('agentOrg.openAgent', { name: agent.alias })} onPress={p.onOpen}
    style={({ pressed }) => [styles.agentRow, pressed && { backgroundColor: colors.rowHover }]}>{body}</Pressable>;
  return <View testID={`agent-org-agent-${agent.nodeId}`} style={styles.agentRow}>{body}</View>;
}

function DeptContextMenu(p: { target: { dept: Department | null; x: number; y: number; touch: boolean }; actions: DeptMenuAction[]; onClose: () => void; onPick: (a: DeptMenuAction) => void }) {
  const { t } = useTranslation();
  const win = useWindowDimensions();
  useEffect(() => listenEscapeClose(p.onClose), [p.onClose]);
  const safe = useModalSafePadding('fullScreen');
  const m = rowMenuMetrics(p.target.touch, uiScale().densityFactor, uiScale().denseFontMultiplier);
  // 遮罩铺满(按下点是窗口坐标);安全区只用来把菜单夹在刘海 / 手势条以内。
  const pos = anchorRowMenu({ x: p.target.x, y: p.target.y, menuWidth: m.width, menuHeight: rowMenuHeight(m, p.actions.length), viewportWidth: win.width, viewportHeight: win.height,
    insets: p.target.touch ? { top: safe.paddingTop, bottom: safe.paddingBottom, left: safe.paddingLeft, right: safe.paddingRight } : undefined });
  const scrim = p.target.touch ? 'rgba(0,0,0,0.18)' : 'transparent';
  return <Modal visible transparent animationType="none" statusBarTranslucent onRequestClose={p.onClose}>
    <View style={{ flex: 1 }} testID="agent-org-dept-menu-layer">
      <Pressable testID="agent-org-dept-menu-scrim" accessibilityLabel={t('agentOrg.close')} onPress={p.onClose}
        style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, backgroundColor: scrim }}
        {...({ onContextMenu: (e: { preventDefault?: () => void }) => { e?.preventDefault?.(); p.onClose(); } } as object)} />
      <View testID="agent-org-dept-menu" accessibilityRole="menu"
        accessibilityLabel={p.target.dept ? t('agentOrg.menu.label', { name: p.target.dept.name }) : t('agentOrg.menu.rootLabel')}
        style={{ position: 'absolute', left: pos.left, top: pos.top, width: m.width, paddingVertical: m.padY, borderRadius: m.radius, backgroundColor: colors.card, overflow: 'hidden', ...elevated('floating') }}>
        {p.actions.map(a => (
          <Pressable key={a} testID={`agent-org-dept-menu-${a}`} accessibilityRole="menuitem" accessibilityLabel={t(DEPT_MENU_LABEL_KEY[a])} onPress={() => p.onPick(a)}
            style={({ pressed, hovered }: PressableStateCallbackType & { hovered?: boolean }) => ({ height: m.itemHeight, paddingHorizontal: m.padX, justifyContent: 'center', backgroundColor: pressed || hovered ? colors.rowHover : 'transparent' })}>
            <Text dense selectable={false} numberOfLines={1} style={{ color: a === 'delete' ? colors.failed : colors.text, fontSize: m.fontSize }}>{t(DEPT_MENU_LABEL_KEY[a])}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  </Modal>;
}

function blockerText(t: (k: string, o?: Record<string, string | number>) => string, b: DeleteBlockers): string {
  return [b.children ? t('agentOrg.blockChildren', { count: b.children }) : '', b.members ? t('agentOrg.blockMembers', { count: b.members }) : '', b.agents ? t('agentOrg.blockAgents', { count: b.agents }) : '']
    .filter(Boolean).join('、');
}

function DeleteDepartmentDialog(p: { cfg: HubConfig; networkId: string; dept: Department; blockers: DeleteBlockers; onClose: () => void; onDeleted: () => Promise<void> }) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [hubBlockers, setHubBlockers] = useState<DeleteBlockers | null>(null);
  const [done, setDone] = useState(false);
  const pending = useRef(false);
  const close = () => { if (!pending.current) p.onClose(); };
  useEffect(() => listenEscapeClose(close), [p.onClose]);
  const blockers = hubBlockers ?? p.blockers;
  const blocked = isDeleteBlocked(blockers);
  const run = async () => {
    if (pending.current || blocked) return;
    pending.current = true;
    setBusy(true); setError('');
    try {
      if (!done) { await deleteDepartment(p.cfg, p.networkId, p.dept.id); setDone(true); }
      await p.onDeleted();
    } catch (e) {
      if (e instanceof OrgRequestError && e.code === 'department_not_empty') setHubBlockers(blockersFromDetail(e.detail));
      else setError(t(done ? 'agentOrg.departmentRefreshFailed'
        : e instanceof OrgRequestError && (e.status === 401 || e.status === 403) ? 'agentOrg.departmentForbidden'
        : e instanceof OrgRequestError && e.code === 'department_not_found' ? 'agentOrg.saveNoDepartment'
        : e instanceof OrgRequestError && (e.status === 405 || e.status === 501 || e.status === 404) ? 'agentOrg.departmentUnsupported'
        : 'agentOrg.saveFailed'));
    } finally { pending.current = false; setBusy(false); }
  };
  return <DialogFrame title={t('agentOrg.deleteTitle')} closeLabel={t('agentOrg.close')} onClose={close} testID="agent-org-delete-dialog"
    footer={<SettingsButton variant={done ? 'primary' : 'destructive'} label={t(busy ? 'agentOrg.deleting' : done ? 'agentOrg.retryRefresh' : 'agentOrg.deleteAction')} disabled={busy || blocked} onPress={() => void run()} testID="agent-org-delete-confirm" />}>
    {blocked
      ? <Text testID="agent-org-delete-blocked" style={styles.note}>{t('agentOrg.deleteBlocked', { name: p.dept.name, what: blockerText(t, blockers) })}</Text>
      : <Text testID="agent-org-delete-text" style={styles.note}>{t('agentOrg.deleteConfirm', { name: p.dept.name })}</Text>}
    {error ? <Text accessibilityRole="alert" testID="agent-org-delete-error" style={[styles.note, { color: colors.failed }]}>{error}</Text> : null}
  </DialogFrame>;
}

function DemoAdjust(p: {
  data: AgentOrgData | null;
  placed: PlacedAgent[];
  moves: DemoMove[];
  pickAgent: string | null;
  pickDept: string | null | undefined;
  note: string;
  saving: boolean;
  onPickAgent: (id: string) => void;
  onPickDept: (id: string | null) => void;
  onApply: () => void;
}) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const [selector, setSelector] = useState<'agent' | 'department' | null>(null);
  const departments = p.data?.departments ?? [];
  return (
    <View testID="agent-org-demo" style={styles.adjust}>
      <Pressable testID="agent-org-adjust-toggle" accessibilityRole="button" accessibilityState={{ expanded }} aria-expanded={expanded} onPress={() => setExpanded(v => !v)} style={styles.adjustToggle}>
        <Ionicons name="options-outline" size={18} color={colors.textSecondary} />
        <Text style={{ flex: 1, color: colors.text, fontSize: typeScale.body, fontWeight: '500' }}>{t('agentOrg.demoTitle')}</Text>
        <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={16} color={colors.textMuted} />
      </Pressable>
      {expanded ? <View style={{ padding: spacing.md, paddingTop: 0, gap: spacing.md }}>
      <Text style={styles.note}>{t('agentOrg.demoHint')}</Text>
        {p.placed.length === 0 ? <SettingsRow label={t('agentOrg.demoNoAgents')} testID="agent-org-demo-empty" /> : null}
      {p.placed.length ? (
        <View style={styles.selectField}>
          <SettingsRow testID="agent-org-pick-agent" label={t('agentOrg.demoPickAgent')} subtitle={p.placed.find(a => a.nodeId === p.pickAgent)?.alias} disabled={p.saving} onPress={() => setSelector('agent')} />
        </View>
      ) : null}
      {p.placed.length ? (
        <View style={styles.selectField}>
          <SettingsRow testID="agent-org-pick-department" label={t('agentOrg.demoPickDept')} subtitle={p.pickDept === null ? t('agentOrg.unowned') : departments.find(d => d.id === p.pickDept)?.name} disabled={p.saving} onPress={() => setSelector('department')} />
        </View>
      ) : null}
      {p.placed.length ? <SettingsButton label={p.saving ? t('agentOrg.saving') : t('agentOrg.demoApply')} onPress={p.onApply} disabled={p.saving} testID="agent-org-demo-apply" /> : null}
      </View> : null}
      {p.note ? <Text accessibilityLiveRegion="polite" testID="agent-org-demo-result" style={[styles.note, { paddingHorizontal: spacing.md, paddingBottom: spacing.md }]}>{p.note}</Text> : null}
      {selector ? <StructureSelector key={selector} title={t(selector === 'agent' ? 'agentOrg.demoPickAgent' : 'agentOrg.demoPickDept')} onClose={() => setSelector(null)}
        options={selector === 'agent' ? p.placed.map(agent => ({ id: agent.nodeId, label: agent.alias, subtitle: agent.ownerName ?? t('agentOrg.noOwner'), testID: `agent-org-demo-agent-${agent.nodeId}` }))
          : [{ id: null, label: t('agentOrg.unowned'), testID: 'agent-org-demo-dept-unassigned' }, ...flattenTree(orgTree({ departments })).map(row => ({ id: row.dept.id, label: row.dept.name, testID: `agent-org-demo-dept-${row.dept.id}` }))]}
        selected={selector === 'agent' ? p.pickAgent : p.pickDept}
        onPick={id => { if (selector === 'agent' && id !== null) p.onPickAgent(id); else if (selector === 'department') p.onPickDept(id); setSelector(null); }} /> : null}
    </View>
  );
}

export function StructureSelector(p: { title: string; options: { id: string | null; label: string; subtitle?: string; testID: string; disabled?: boolean; disabledReason?: string }[]; selected: string | null | undefined; onPick: (id: string | null) => void; onClose: () => void }) {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  useEffect(() => listenEscapeClose(p.onClose), [p.onClose]);
  const needle = query.trim().toLocaleLowerCase();
  const options = p.options.filter(o => `${o.label} ${o.subtitle ?? ''} ${o.id ?? ''}`.toLocaleLowerCase().includes(needle));
  return <DialogFrame title={p.title} closeLabel={t('agentOrg.close')} onClose={p.onClose} scroll={false} maxWidth={480} testID="agent-org-selector">
        <View style={styles.search}>
          <Ionicons name="search-outline" size={17} color={colors.textMuted} />
          <TextInput autoFocus value={query} onChangeText={setQuery} testID="agent-org-selector-search" placeholder={t('agentOrg.searchOptions')} accessibilityLabel={t('agentOrg.searchOptions')} placeholderTextColor={colors.textMuted} style={styles.searchInput} />
        </View>
        <FlatList data={options} keyExtractor={item => item.testID} style={{ flexGrow: 0, flexShrink: 1, maxHeight: 360 }} keyboardShouldPersistTaps="handled" initialNumToRender={12}
          renderItem={({ item }) => (
            // #4863：不可编辑的部门灰掉并显示原因（不让用户点一个必被 403 的项）；
            // 但**不隐藏**，用户要能看见「它存在，只是我不能动」。
            <SettingsChoiceRow
              testID={item.testID}
              label={item.label}
              subtitle={item.disabled ? `${item.subtitle ? item.subtitle + ' · ' : ''}${item.disabledReason ?? ''}` : item.subtitle}
              disabled={item.disabled}
              selected={p.selected === item.id}
              onPress={() => { if (!item.disabled) p.onPick(item.id); }}
            />
          )}
          ListEmptyComponent={<Text style={[styles.note, { padding: spacing.lg }]}>{t('agentOrg.noResults')}</Text>} />
  </DialogFrame>;
}

const makeStyles = () => StyleSheet.create({
  // admin 2026-10-26「放在中间很奇怪，为什么不放到左侧」：
  // 这页以前是 `alignSelf:'center' + maxWidth:700`，在宽窗口里整块浮在中间、左边一大片空白。
  // 改成从左侧起排并放宽上限：宽窗口用满内容区（外层 SettingsScreen 自己已有 maxWidth:760），
  // 手机/窄窗仍按原有单列布局（`phone` 分支不变）。
  page: { width: '100%', maxWidth: 760, alignSelf: 'stretch' },
  pageFill: { maxWidth: '100%', flex: 1, minHeight: 0 },
  fillRoot: { flex: 1, minHeight: 0 },
  // 整页:不再套卡片 —— 左边是贴着一级栏的整条侧栏(同「Agent」页的列表栏),右边是内容。
  workspaceFill: { flex: 1, minHeight: 0, marginHorizontal: 0, borderWidth: 0, backgroundColor: colors.bg },
  sidebarTitle: { color: colors.text, fontSize: 20, fontWeight: '600' },
  treeSection: { color: colors.textMuted, fontSize: typeScale.small - 1, fontWeight: '600', paddingHorizontal: spacing.sm, paddingTop: spacing.md, paddingBottom: spacing.xs },
  toastLayer: { position: 'absolute', left: 0, right: 0, bottom: spacing.xl, alignItems: 'center' },
  toast: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.pill, backgroundColor: colors.running, ...elevated('floating') },
  toastText: { color: '#ffffff', fontSize: typeScale.small, fontWeight: '500' },
  fillColumns: { flex: 1, minHeight: 0 },
  navigationFill: { width: 272, borderRightWidth: StyleSheet.hairlineWidth },
  treeHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, paddingTop: spacing.lg, paddingBottom: spacing.md },
  treeHeadTitle: { color: colors.text, fontSize: typeScale.body, fontWeight: '600' },
  treeHeadSub: { color: colors.textMuted, fontSize: typeScale.small - 1, marginTop: 1 },
  treeDivider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border, marginVertical: spacing.xs, marginHorizontal: spacing.xs },
  treeFooter: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, paddingHorizontal: spacing.md, paddingVertical: spacing.xs, gap: spacing.xs },
  treeFooterToggle: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, minHeight: 32 },
  treeChevron: { width: 18, height: 22, alignItems: 'center', justifyContent: 'center' },
  iconAction: { width: 28, height: 28, borderRadius: radius.item, alignItems: 'center', justifyContent: 'center' },
  departmentRowDense: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 34, paddingRight: spacing.xs, marginBottom: 1, borderRadius: radius.item },
  countSlot: { width: 32, height: 28, justifyContent: 'center' },
  loadingFill: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.md },
  loadingPhone: { alignItems: 'center', justifyContent: 'center', gap: spacing.md, paddingTop: 160, paddingBottom: 96 },
  segTabs: { flexDirection: 'row', backgroundColor: colors.subtleFill, borderRadius: radius.control, padding: 3, gap: 2 },
  segTab: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: spacing.md, height: 30, borderRadius: radius.item },
  segTabOn: { backgroundColor: colors.card },
  segTabText: { color: colors.textMuted, fontSize: typeScale.small },
  segTabTextOn: { color: colors.text, fontWeight: '600' },
  countSlotMore: { position: 'absolute', right: 0, top: 0 },
  countDense: { color: colors.textMuted, fontSize: typeScale.small - 1, fontVariant: ['tabular-nums'], minWidth: 28, textAlign: 'right', paddingRight: spacing.xs },
  detailFill: { flex: 1, minHeight: 0, minWidth: 0 },
  detailHeadFill: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  searchFill: { width: 260, maxWidth: '100%', minHeight: 34, paddingHorizontal: spacing.sm },
  agentRowFill: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: 48, paddingHorizontal: spacing.sm, borderRadius: radius.item },
  folderBadge: { width: 30, height: 30, borderRadius: radius.pill, backgroundColor: colors.subtleFill, alignItems: 'center', justifyContent: 'center' },
  liveDot: { position: 'absolute', right: -1, bottom: -1, width: 10, height: 10, borderRadius: radius.pill, borderWidth: 2, borderColor: colors.card },
  ownerCol: { width: 140, flexShrink: 1, color: colors.textMuted, fontSize: typeScale.small, textAlign: 'right' },
  rowActionSlot: { width: 112, alignItems: 'flex-end' },
  moveButton: { flexDirection: 'row', alignItems: 'center', gap: 4, height: 28, paddingHorizontal: spacing.sm, borderRadius: radius.item },
  toolbar: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.sm, padding: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border },
  toolbarContext: { flexGrow: 1, flexShrink: 1, minWidth: 160, gap: spacing.xs },
  compactAction: { ...buttonStyle('secondary'), height: 'auto', minHeight: 44, maxWidth: '100%', flexDirection: 'row', gap: spacing.xs, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs, flexShrink: 1 },
  actionLabel: { ...buttonTextStyle('secondary'), fontSize: typeScale.small, flexShrink: 1 },
  workspace: { marginHorizontal: spacing.md, borderWidth: 1, borderColor: colors.border, borderRadius: radius.surface, backgroundColor: colors.card, overflow: 'hidden' },
  columns: { flexDirection: 'row', minHeight: 440 },
  navigation: { width: 240, flexShrink: 0, borderRightWidth: 1, borderRightColor: colors.border, backgroundColor: colors.listBg },
  sectionLabel: { color: colors.textMuted, fontSize: typeScale.small, fontWeight: '600', padding: spacing.sm, marginBottom: spacing.xs },
  departmentRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 44, paddingRight: spacing.sm, marginBottom: 2, borderRadius: radius.item },
  count: { color: colors.textMuted, fontSize: typeScale.small, fontVariant: ['tabular-nums'], backgroundColor: colors.subtleFill, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs, borderRadius: radius.item },
  detail: { padding: spacing.md, gap: spacing.sm, minWidth: 0 },
  phoneBack: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', gap: 2, minHeight: 32, marginLeft: -spacing.xs },
  phoneBackText: { color: colors.accent, fontSize: typeScale.body, fontWeight: '500' },
  detailHeading: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.sm },
  memberTitle: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', flexGrow: 1, flexShrink: 1, gap: spacing.sm, maxWidth: '100%' },
  bulkAction: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.sm, maxWidth: '100%' },
  memberList: { maxHeight: 400, flexGrow: 0, minHeight: 0 },
  title: { color: colors.text, fontSize: typeScale.heading, fontWeight: '600' },
  note: { color: colors.textMuted, fontSize: typeScale.small, lineHeight: 20 },
  info: { marginHorizontal: spacing.md, marginTop: spacing.sm, paddingHorizontal: spacing.sm },
  infoToggle: { flexDirection: 'row', alignItems: 'center', minHeight: 44, gap: spacing.sm },
  search: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, borderWidth: 1, borderColor: colors.border, borderRadius: radius.control, backgroundColor: colors.inputBg, paddingHorizontal: spacing.md },
  searchInput: { flex: 1, minWidth: 0, minHeight: 42, color: colors.text, fontSize: typeScale.small, paddingVertical: spacing.sm },
  agentRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  empty: { minHeight: 220, alignItems: 'center', justifyContent: 'center', gap: spacing.md },
  adjust: { margin: spacing.md, borderWidth: 1, borderColor: colors.border, borderRadius: radius.control, backgroundColor: colors.card, overflow: 'hidden' },
  adjustToggle: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 52, paddingHorizontal: spacing.md },
  selectField: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.control, overflow: 'hidden' },
});
let styles = makeStyles();
onThemeChange(() => { styles = makeStyles(); });
