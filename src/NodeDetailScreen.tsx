// Per-node detail screen — issue #8 row 4 (V1 health card only).
//
// SCOPE (per 通信龙 71ee862d + d349e514 V1 decision):
//   Health card: alias + status chip + updated_at + current task preview +
//   team + server + avatar. V2 progressively adds masked config facts and
//   lifecycle controls when GET /api/nodes supplies an authoritative node_id.
//   Session-only aliases remain read-only. Logs stay in the Server workspace.
//
// TASK vs NODE distinction (author-厘清 → 通信龙 5a8783bd 认为镜像镜镜):
//   task = one dispatched task's status/result/reply
//     (that's demo马's TaskDetailScreen in row 5 — NOT this file)
//   node = one agent's health/config/log stream
//     (that's this file for the health slice; config = V2, log = row 6)
//
// HARD REQUIREMENTS from dispatch (do NOT change without lead sign):
//   1. Avatar: use src/lib/avatars.ts (djb2 pool). Do NOT roll own hash —
//      the h*31 in AliasAvatar is the letter-pill color palette, a
//      DIFFERENT hash from the pool pick (author corrected lead on this
//      once already; the memo-vs-source hash confusion is the exact
//      trap this file avoids by delegating to AliasAvatar).
//   2. Styles: `import { styles } from './app-styles'` — do NOT
//      destructure, do NOT copy. See app-styles.ts header comment
//      explaining ES-module live binding: styles is `export let`,
//      onThemeChange reassigns the whole object, importers get the new
//      one via live binding. Any local copy freezes on first paint's
//      colors — screen "works but wrong color" after theme switch,
//      undetectable in a single screen review.
//   3. Three visible states — loading, empty (session not found in
//      fleet), error (fetch failed) — separated on screen, not merged
//      into a blank canvas.
//
// ENTRY: `AgentsScreen` row `onLongPress` (pending PR #14 merge — do NOT
//   touch AgentsScreen until lead greenlights). Existing tap → chat is
//   a high-frequency path, preserved unchanged.
//
// WIRING: App.tsx adds one route case + one prop. Coordinated with
//   demo马's Tasks tab that also touches App.tsx (lead-mediated order:
//   this PR lands first, demo马 wires after).
//
// V1 uses ONLY `Session` fields already exposed by fetchStatus
// (alias / status / agent / task / server / updated_at). No new API
// fetcher. If the alias vanishes from the fleet between refreshes, we
// render "empty" not "error" — the caller (App.tsx router) can offer a
// back navigation. Missing field values render "—" so the user can tell
// "field absent" apart from "screen broken" (lead 71ee862d
// verification bullet).

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { layoutGeneration, releaseOnUnmount, takeHandoff } from './layout-handoff';
import { ActivityIndicator, BackHandler, Keyboard, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StatusBar, StyleSheet, Text, TextInput, View, useWindowDimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import AliasAvatar from './AliasAvatar';
import AvatarEditSection from './AvatarEditSection';
import { teamOf } from './agents-list';
import { fetchHubNodes, fetchNodeStatus, runNodeLifecycleAction, type HubConfig, type HubNode, type NodeLifecycleAction, type Session } from './api';
import { styles } from './app-styles';
import { colors, onThemeChange, radius, spacing, statusColor, type as typeScale, weight } from './theme';
import { formatTime } from './time';
import { usePoll } from './usePoll';
import NodeTasksSection from './NodeTasksSection';
import { nodeActionVisual, type NodeActionTone } from './node-action-visual';
import { nodeInfoFacts, type NodeInfoFact } from './node-info';
import { nodeIdentityNotice, taskSectionTitle } from './node-identity';
import NodeRulesSection from './NodeRulesSection';
import { rulesFileTarget } from './node-rules';
import NodeModelSection from './NodeModelSection';
import NodeSkillsSection from './NodeSkillsSection';
import NodeFilesSection from './NodeFilesSection';
import { filesTreeMode, nodePageColumnMaxWidth } from './node-files-tree';
import { NODE_PAGE_COMPACT_WIDTH, NODE_SECTIONS, factText, headerChips, leaveNeedsConfirm, nodePageChrome, nodePageContentWidth, nodePageScrolls, overviewFactColumns, resolveActiveSection, splitOverviewFacts, visibleNodeSections, type NodeSectionKey } from './node-page-model';

const POLL_MS = 10_000; // same cadence as AgentsScreen — hub-friendly, felt-live

function NodeActionButton({
  label,
  tone,
  onPress,
  disabled,
}: {
  label: string;
  tone: NodeActionTone;
  onPress: () => void;
  /** app#196 —— 置灰而不是隐藏（Vincent 定）：隐藏会让人以为功能不存在，
   *  置灰 + 底下一句说明能告诉他为什么、以及替代做法。 */
  disabled?: boolean;
}) {
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const visual = nodeActionVisual(colors, tone);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled }}
      accessibilityHint={disabled ? '此节点不支持远程生命周期操作' : tone === 'danger' ? '需要输入节点别名再次确认' : '打开确认窗口'}
      onHoverIn={() => setHovered(true)}
      onHoverOut={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onPress={disabled ? undefined : onPress}
      disabled={disabled}
      style={({ pressed }) => [
        localStyles.actionButton,
        { borderColor: visual.borderColor, backgroundColor: visual.backgroundColor },
        !disabled && (hovered || focused) && { backgroundColor: colors.inputBg },
        !disabled && focused && { borderColor: visual.textColor },
        !disabled && pressed && localStyles.actionButtonPressed,
        disabled && { opacity: 0.35 },
      ]}
    >
      <Text style={[localStyles.actionButtonText, { color: visual.textColor }]}>{label}</Text>
    </Pressable>
  );
}

/** 概览网格里的一格:小号灰色标签在上,值在下;空值显示「—」(分得清「没上报」和「坏了」)。 */
function FactCell({ fact, columns }: { fact: NodeInfoFact; columns: number }) {
  return (
    <View style={{ width: `${100 / columns}%`, paddingVertical: spacing.sm, paddingRight: spacing.lg, gap: 2 }}>
      <Text style={{ color: colors.textMuted, fontSize: typeScale.small }}>{fact.label}</Text>
      <Text style={{ color: colors.text, fontSize: typeScale.body }} selectable numberOfLines={2}>{factText(fact.value)}</Text>
    </View>
  );
}

/** 分区标题 + 一句说明;分区之间不画框,靠留白和标题分层(0.2.85 极简语言)。 */
function SectionTitle({ title, hint }: { title: string; hint?: string }) {
  return (
    <View style={{ marginBottom: spacing.md, gap: 4 }}>
      <Text style={{ color: colors.text, fontSize: typeScale.title, fontWeight: weight.strong }}>{title}</Text>
      {hint ? <Text style={{ color: colors.textMuted, fontSize: typeScale.small, lineHeight: 18 }}>{hint}</Text> : null}
    </View>
  );
}

type LoadState =
  | { kind: 'loading' }
  | { kind: 'ready'; session: Session }
  | { kind: 'not_found' } // alias no longer in the fleet
  | { kind: 'error' };    // fetch itself failed (network / auth / server)

export default function NodeDetailScreen({
  cfg,
  alias,
  onBack,
  readOnly = false,
  layoutWidth,
  touch = false,
}: {
  cfg: HubConfig;
  alias: string;
  onBack: () => void;
  readOnly?: boolean;
  /** Android two-pane: the width this screen actually gets (window minus the list).
   *  Omitted everywhere else, where the window width decides as before. */
  layoutWidth?: number;
  /** Android two-pane: finger-sized section rail rows (≥ 48 dp) when the rail shows. */
  touch?: boolean;
}) {
  const [state, setState] = useState<LoadState>({ kind: 'loading' });
  const [node, setNode] = useState<HubNode | null>(null);
  const [nodeListState, setNodeListState] = useState<'loading' | 'loaded' | 'failed'>('loading');
  const [pendingAction, setPendingAction] = useState<NodeLifecycleAction | null>(null);
  const [confirmAlias, setConfirmAlias] = useState('');
  const [actionBusy, setActionBusy] = useState(false);
  const [actionMessage, setActionMessage] = useState('');
  const [activeSection, setActiveSection] = useState<NodeSectionKey>('overview');
  // Fold/unfold remounts this screen; keep the selected tab (概览/规则文件/技能/…)
  // across that remount only (see layout-handoff.ts).
  const sectionHandoffKey = `nodeSection:${readOnly ? 'info' : 'detail'}:${cfg.profileId ?? cfg.serverUrl}:${alias}`;
  const activeSectionRef = useRef(activeSection);
  activeSectionRef.current = activeSection;
  useLayoutEffect(() => {
    const mountedGeneration = layoutGeneration();
    const handed = takeHandoff<NodeSectionKey>(sectionHandoffKey);
    if (handed) setActiveSection(handed);
    return () => releaseOnUnmount(sectionHandoffKey, activeSectionRef.current, mountedGeneration);
  }, [sectionHandoffKey]);
  const [showMoreFacts, setShowMoreFacts] = useState(false);
  // 规则文件草稿没保存时,切分区 / 返回之前先问(草稿只活在 NodeRulesSection 里,一卸载就没了)。
  const [rulesDirty, setRulesDirty] = useState(false);
  const [pendingLeave, setPendingLeave] = useState<null | (() => void)>(null);
  // 软键盘弹起(原生端):规则分区里收起头部卡片,把高度让给编辑框;web / 桌面没有这些事件,恒 false。
  const [keyboardVisible, setKeyboardVisible] = useState(false);
  useEffect(() => {
    if (Platform.OS === 'web') return;
    const show = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow', () => setKeyboardVisible(true));
    const hide = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide', () => setKeyboardVisible(false));
    return () => { show.remove(); hide.remove(); };
  }, []);
  // 返回(页头 ‹ 和 Android 系统返回键)也要过确认。needConfirm 在下面算(要先有 section),这里用 ref 读最新值。
  const onBackRef = useRef(onBack);
  onBackRef.current = onBack;
  const confirmLeaveRef = useRef(false);
  const guardedBack = () => { if (confirmLeaveRef.current) setPendingLeave(() => onBackRef.current); else onBackRef.current(); };
  useEffect(() => {
    if (!rulesDirty) return;
    // 只在有草稿时挂:它比 App.tsx 的返回处理晚注册 ⇒ 先被调用(BackHandler 后注册先调)。
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (!confirmLeaveRef.current) return false;
      setPendingLeave(() => onBackRef.current);
      return true;
    });
    return () => sub.remove();
  }, [rulesDirty]);
  const { width: windowWidth } = useWindowDimensions();
  const width = layoutWidth ?? windowWidth;
  const compact = width < NODE_PAGE_COMPACT_WIDTH;
  // 右栏实测宽度(左侧还有服务器侧栏/分区栏,窗口宽≠右栏宽);没量到之前按窗口估。
  const [paneWidth, setPaneWidth] = useState(0);
  const contentPadding = compact ? spacing.lg : spacing.xl;
  const factColumns = compact ? 1 : overviewFactColumns(nodePageContentWidth(paneWidth || width, contentPadding));
  // 项目文件夹右侧文件树(node-files-tree.ts filesTreeMode):按内容列**封顶前**能拿到的宽度决定并排 / 抽屉;
  // 手机单栏(窄且不是安卓双栏)不挂,手机布局不变。右栏没量到之前按抽屉算,不先挂出来再收回去。
  const filesTree = filesTreeMode({ contentWidth: paneWidth > 0 ? paneWidth - 2 * contentPadding : 0, phone: compact && layoutWidth === undefined });
  // Force re-render on theme switch. `styles` reassigns via live binding
  // (see app-styles.ts header) but child style props are captured at
  // render — a manual bump is how the sibling screens do it too.
  const [, setThemeTick] = useState(0);
  useEffect(() => onThemeChange(() => setThemeTick(t => t + 1)), []);

  const load = useCallback(async () => {
    try {
      const data = await fetchNodeStatus(cfg);
      const found = (data.sessions ?? []).find(s => s.alias === alias);
      // 拉取失败时**保留上一次的 node**:否则一次超时就让操作区/规则区整块消失,
      // 文案还会说「没有权威节点 ID」,和上面显示的 ID 自相矛盾(Vincent 09-03 截图)。
      void fetchHubNodes(cfg)
        .then(result => { setNode((result.nodes ?? []).find(candidate => candidate.alias === alias) ?? null); setNodeListState('loaded'); })
        .catch(() => setNodeListState('failed'));
      if (found) setState({ kind: 'ready', session: found });
      else setState(prev => (prev.kind === 'ready' ? prev : { kind: 'not_found' }));
      // If we previously had the session and it's now gone, we keep the
      // last-known snapshot rather than flashing "not_found" — the alias
      // may have gone offline momentarily. `not_found` only wins when we
      // never had it (initial fetch missed it).
    } catch {
      setState(prev => (prev.kind === 'ready' ? prev : { kind: 'error' }));
      // Same "keep last-known" policy on fetch error, mirroring
      // AgentsScreen's behavior.
    }
  }, [cfg, alias]);

  useEffect(() => {
    void load();
  }, [load]);

  // Foreground-only 10s polling. usePoll pauses in background and
  // instant-refreshes on resume — same hook AgentsScreen uses.
  usePoll(load, POLL_MS, [load]);

  const header = (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: spacing.lg,
        paddingVertical: spacing.md,
        borderBottomWidth: 1,
        borderBottomColor: colors.border,
        gap: spacing.md,
      }}
    >
      <Pressable onPress={guardedBack} hitSlop={12} accessibilityRole="button" accessibilityLabel="返回">
        <Text style={{ color: colors.accent, fontSize: 28 }}>‹</Text>
      </Pressable>
      <Text style={{ color: colors.text, fontSize: 17, fontWeight: '600' }}>{readOnly ? '节点信息' : '节点详情'}</Text>
    </View>
  );

  if (state.kind === 'loading') {
    return (
      <View style={styles.root}>
        {header}
        <View style={styles.center}>
          <ActivityIndicator color={colors.accent} />
        </View>
      </View>
    );
  }

  if (state.kind === 'error') {
    return (
      <View style={styles.root}>
        {header}
        <View style={styles.center}>
          <Text style={styles.errorTitle}>加载失败</Text>
          <Text style={styles.errorHint}>网络不稳定或服务器未响应</Text>
          <Pressable
            style={({ pressed }) => [styles.retryBtn, pressed && { opacity: 0.7 }]}
            onPress={() => {
              setState({ kind: 'loading' });
              void load();
            }}
          >
            <Text style={styles.retryBtnText}>重试</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  if (state.kind === 'not_found') {
    return (
      <View style={styles.root}>
        {header}
        <View style={styles.center}>
          <Text style={styles.errorTitle}>找不到节点</Text>
          <Text style={styles.errorHint}>
            别名 <Text style={{ color: colors.text }}>{alias}</Text> 已不在当前网络的会话列表里
          </Text>
        </View>
      </View>
    );
  }

  const s = state.session;
  const rulesTarget = rulesFileTarget({ readOnly, node, session: s });
  const online = s.status !== 'offline';
  const chipColor = statusColor(s.status, online);
  const team = teamOf(s.alias);
  const executeLifecycle = async () => {
    if (!pendingAction || !node || actionBusy) return;
    setActionBusy(true);
    setActionMessage('');
    const result = await runNodeLifecycleAction(cfg, pendingAction, node);
    setActionBusy(false);
    if (!result.ok) {
      setActionMessage(result.error === 'node_busy_in_flight'
        ? `节点仍有 ${result.in_flight_count ?? 1} 个处理中任务，未强制操作`
        : result.error);
      return;
    }
    setActionMessage(pendingAction === 'restart_node' ? '重启请求已提交' : pendingAction === 'stop_node' ? '停止请求已提交' : '删除请求已提交');
    setPendingAction(null);
    setConfirmAlias('');
    void load();
  };

  const facts: NodeInfoFact[] = [
    ...nodeInfoFacts(s, node, cfg.serverUrl),
    { label: '所属 team', value: team },
    { label: '最后更新', value: formatTime(s.updated_at) },
    { label: '生命周期', value: node?.lifecycle_state },
    { label: '配置版本', value: typeof node?.config_revision === 'number' ? String(node.config_revision) : undefined },
  ];
  const { primary, secondary } = splitOverviewFacts(facts);
  const chips = headerChips(facts);
  const skillsCapable = (s as Session & { skills_capable?: boolean }).skills_capable === true;
  const visibleSections = visibleNodeSections({ readOnly, hasRulesTarget: !!rulesTarget, skillsCapable });
  const section = resolveActiveSection(activeSection, visibleSections);
  const sectionMeta = NODE_SECTIONS.filter(item => visibleSections.includes(item.key));
  const needConfirm = leaveNeedsConfirm({ section, rulesDirty });
  confirmLeaveRef.current = needConfirm;
  // 要离开规则分区 / 这一页:有没保存的草稿就先弹确认,确认了才真的走。
  const guardLeave = (go: () => void) => { if (needConfirm) setPendingLeave(() => go); else go(); };
  const chrome = nodePageChrome({ section, keyboardVisible });
  const pageScrolls = nodePageScrolls(section);
  const runtimeFacts = facts.filter(f => ['Runtime', 'Agent', '模型', '版本', '节点类型'].includes(f.label));

  // 头部卡片:头像 + 名字 + 在线状态 + 运行时/模型/版本/主机小标签。常驻,切分区不动。
  const headerCard = (
    <View style={[localStyles.headerCard, { borderBottomColor: colors.border }]}>
      <AliasAvatar alias={s.alias} size={compact ? 44 : 56} />
      <View style={{ flex: 1, minWidth: 0, gap: 6 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap' }}>
          <Text style={{ color: colors.text, fontSize: typeScale.heading, fontWeight: weight.strong }} selectable numberOfLines={1}>
            {s.alias}
          </Text>
          <View style={[localStyles.statusPill, { borderColor: colors.border }]}>
            <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: chipColor }} />
            <Text style={{ color: colors.textSecondary, fontSize: typeScale.small }}>{online ? s.status : 'offline'}</Text>
          </View>
        </View>
        {chips.length ? (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>
            {chips.map(chip => (
              <View key={chip} style={[localStyles.chip, { backgroundColor: colors.subtleFill }]}>
                <Text style={{ color: colors.textSecondary, fontSize: typeScale.small }} numberOfLines={1}>{chip}</Text>
              </View>
            ))}
          </View>
        ) : null}
      </View>
    </View>
  );

  // 分区导航:宽窗左栏(同设置页),窄窗顶部一排分段标签。
  const nav = (
    <View style={compact ? [localStyles.tabsWrap, { borderBottomColor: colors.border }] : [localStyles.rail, { borderRightColor: colors.border }]} testID="node-section-nav">
      <ScrollView horizontal={compact} showsHorizontalScrollIndicator={false} contentContainerStyle={compact ? localStyles.tabsRow : localStyles.railList}>
        {sectionMeta.map(item => {
          const isActive = item.key === section;
          const danger = item.key === 'danger';
          return (
            <Pressable
              key={item.key}
              accessibilityRole="tab"
              accessibilityState={{ selected: isActive }}
              accessibilityLabel={item.label}
              onPress={() => { if (item.key !== section) guardLeave(() => setActiveSection(item.key)); }}
              style={({ pressed, hovered }: any) => [
                compact ? localStyles.tab : localStyles.railItem,
                touch && (compact ? localStyles.tabTouch : localStyles.railItemTouch),
                (hovered || pressed) && { backgroundColor: colors.rowHover },
                isActive && { backgroundColor: colors.rowActive },
              ]}
            >
              {!compact ? <Ionicons name={item.icon as any} size={16} color={danger ? colors.failed : isActive ? colors.text : colors.textMuted} /> : null}
              <Text style={{ color: danger ? colors.failed : isActive ? colors.text : colors.textSecondary, fontSize: typeScale.body, fontWeight: isActive ? weight.strong : weight.regular }} numberOfLines={1}>
                {item.label}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );

  const card = { backgroundColor: colors.card, borderRadius: radius.lg, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm } as const;

  const content = (() => {
    if (section === 'overview') return (
      <View style={{ gap: spacing.xl }}>
        <View>
          <SectionTitle title="概览" />
          <View style={[card, { flexDirection: 'row', flexWrap: 'wrap' }]}>
            {primary.map(fact => <FactCell key={fact.label} fact={fact} columns={factColumns} />)}
          </View>
          {secondary.length ? (
            <View style={{ marginTop: spacing.sm }}>
              <Pressable onPress={() => setShowMoreFacts(v => !v)} accessibilityRole="button" accessibilityState={{ expanded: showMoreFacts }} hitSlop={8} style={{ paddingVertical: spacing.xs }}>
                <Text style={{ color: colors.accent, fontSize: typeScale.small, fontWeight: weight.strong }}>{showMoreFacts ? '收起更多信息' : `更多信息(${secondary.length})`}</Text>
              </Pressable>
              {showMoreFacts ? (
                <View style={[card, { flexDirection: 'row', flexWrap: 'wrap', marginTop: spacing.xs }]}>
                  {secondary.map(fact => <FactCell key={fact.label} fact={fact} columns={factColumns} />)}
                </View>
              ) : null}
            </View>
          ) : null}
        </View>
        <View>
          <SectionTitle title={taskSectionTitle(s.status)} />
          <View style={[card, { paddingVertical: spacing.md }]}>
            {s.task && s.task.trim().length > 0 ? (
              <Text style={{ color: colors.text, fontSize: typeScale.body, lineHeight: 20 }} selectable>{s.task}</Text>
            ) : (
              <Text style={{ color: colors.textMuted, fontSize: typeScale.small }}>节点还没有上报任务。完整记录见「任务」分区。</Text>
            )}
          </View>
        </View>
        {/* R2 avatar editor (pool picker + custom URL; pre-disclosure for session-only) */}
        {!readOnly ? <AvatarEditSection cfg={cfg} alias={s.alias} /> : null}
      </View>
    );
    if (section === 'model') return (
      <View>
        <SectionTitle title="模型与运行时" hint={readOnly ? '只读视图:在节点详情里可以直接改模型。' : '改模型会让节点重启一次,不经过大模型。'} />
        <View style={[card, { flexDirection: 'row', flexWrap: 'wrap' }]}>
          {runtimeFacts.map(fact => <FactCell key={fact.label} fact={fact} columns={factColumns} />)}
        </View>
        {/* RFC-024 —— 不经 LLM 直接改模型;需要权威 node_id。 */}
        {!readOnly && node ? <NodeModelSection cfg={cfg} node={node} /> : null}
      </View>
    );
    if (section === 'rules') return (
      <View style={{ flex: 1 }}>
        {/* 说明收进规则区工具条的 ⓘ(09-25 紧凑化),标题下不再常驻一行。 */}
        {chrome.sectionTitle ? <SectionTitle title="规则文件" /> : null}
        {/* app#225 —— 节点规则文件（CLAUDE.md / AGENTS.md）查看/编辑。显示条件与请求目标见
            node-rules.ts rulesFileTarget:会话上报 rules_file_capable 时详情/只读页都显示
            (claude-code 会话没有 nodes 行也能按 alias 发);否则保持原行为。 */}
        {rulesTarget ? <NodeRulesSection cfg={cfg} node={rulesTarget} session={s} onDirtyChange={setRulesDirty} /> : null}
      </View>
    );
    if (section === 'skills') return (
      <View>
        <SectionTitle title="技能" />
        <NodeSkillsSection cfg={cfg} alias={alias} node={rulesTarget} session={s} readOnly={readOnly} />
      </View>
    );
    if (section === 'files') return (
      <View>
        <SectionTitle title="项目文件夹" />
        {/* 节点工作目录的只读文件树。有 nodes 行按 node_id 发(rulesTarget 带权威 node_id),否则按 alias。 */}
        <NodeFilesSection cfg={cfg} alias={alias} node={rulesTarget} session={s} treeMode={filesTree} />
      </View>
    );
    if (section === 'tasks') return (
      <View>
        <SectionTitle title="任务" hint="发给这个节点的任务。自己发给自己的定时提醒单独一组,不算运行中。" />
        {/* app#157 —— 这个节点正在跑什么、前面排着几条(只读视图也显示,它不改任何东西) */}
        <NodeTasksSection cfg={cfg} alias={alias} embedded />
      </View>
    );
    // danger
    return (
      <View>
        <SectionTitle title="危险操作" hint="操作通过公开 CommHub/anet 契约执行。停止不会删除配置；有任务处理中时服务器会拒绝，不会自动强制。" />
        {!readOnly ? <View style={[localStyles.dangerZone, { borderColor: colors.failed }]}>
          {node ? (
            <View style={{ gap: spacing.md }}>
              {/* app#196 —— hub 明确说不可控时置灰。
                  🔴 undefined（旧 hub 没这个字段）按可控渲染：与升级前行为逐字相同，
                  真不行的话提交时 hub 会拒绝并显示错误 —— 宁可多让用户点一次，
                  也不能因为 hub 旧就把 11 个真正可控的节点全灰掉。 */}
              <View style={localStyles.actionRow}>
                <NodeActionButton label="重启节点" tone="neutral" disabled={node?.lifecycle_controllable === false} onPress={() => setPendingAction('restart_node')} />
                <NodeActionButton label="停止节点" tone="caution" disabled={node?.lifecycle_controllable === false} onPress={() => setPendingAction('stop_node')} />
                <NodeActionButton label="删除节点" tone="danger" disabled={node?.lifecycle_controllable === false} onPress={() => setPendingAction('delete_node')} />
              </View>
              {node?.lifecycle_controllable === false ? (
                <Text style={{ color: colors.textMuted, fontSize: typeScale.small, lineHeight: 18 }}>
                  此节点不是由 daemon 创建的，无法远程停止/删除。请在它所在的机器上执行 `anet node stop {alias}`。
                </Text>
              ) : null}
              {actionMessage ? <Text style={{ color: actionMessage.includes('已提交') ? colors.running : colors.failed, fontSize: typeScale.small }}>{actionMessage}</Text> : null}
            </View>
          ) : (
            <Text style={{ color: colors.textMuted, fontSize: typeScale.small }}>{nodeIdentityNotice(s, node, nodeListState)}</Text>
          )}
        </View> : null}
      </View>
    );
  })();

  const column = (
    <View style={{ flexGrow: 1, width: '100%', maxWidth: nodePageColumnMaxWidth(section, filesTree), alignSelf: 'center' }} testID="node-page-content">
      {content}
    </View>
  );
  return (
    // 规则分区在原生端打字时:键盘把页面底部顶上来(Android edge-to-edge 下 adjustResize 不生效,同 ChatScreen 的做法),
    // 编辑框底边和光标所在行不被键盘盖住;别的分区不启用,行为不变。
    <KeyboardAvoidingView
      style={styles.root}
      enabled={Platform.OS !== 'web' && section === 'rules'}
      behavior="padding"
      keyboardVerticalOffset={Platform.OS === 'android' ? (StatusBar.currentHeight ?? 0) : 0}
    >
      {header}
      {chrome.headerCard ? headerCard : null}
      <View style={{ flex: 1, flexDirection: compact ? 'column' : 'row', minHeight: 0 }}>
        {nav}
        {/* 内容列随窗口变宽、到 NODE_PAGE_CONTENT_MAX_WIDTH 封顶并居中(Vincent 09-24「空了」:
            原来 maxWidth 880 贴左,2000px 宽窗右边空一大片)。
            规则文件分区整页不滚(nodePageScrolls):工具条钉在上面,阅读区 / 编辑框自己滚 ——
            包在 ScrollView 里时手机上一滑就把「阅读/编辑」「保存」滚出屏幕(2026-09-26 小米折叠屏)。 */}
        {pageScrolls ? (
          <ScrollView style={{ flex: 1 }} onLayout={e => setPaneWidth(e.nativeEvent.layout.width)}
            contentContainerStyle={{ flexGrow: 1, padding: contentPadding, paddingBottom: spacing.xl * 2 }}>
            {column}
          </ScrollView>
        ) : (
          <View style={{ flex: 1, minHeight: 0, padding: contentPadding }} onLayout={e => setPaneWidth(e.nativeEvent.layout.width)} testID="node-page-fixed">
            {column}
          </View>
        )}
      </View>

      {/* 规则文件有没保存的草稿,又要切分区 / 返回。 */}
      <Modal transparent visible={!!pendingLeave} onRequestClose={() => setPendingLeave(null)} animationType="fade">
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center', padding: spacing.xl }}>
          <View style={{ width: '100%', maxWidth: 420, borderRadius: 14, backgroundColor: colors.card, padding: spacing.xl, gap: spacing.md }} accessibilityViewIsModal>
            <Text style={{ color: colors.text, fontSize: 17, fontWeight: '600' }}>放弃未保存的修改？</Text>
            <Text style={{ color: colors.textSecondary, fontSize: 13, lineHeight: 19 }}>规则文件的改动还没有保存到节点。离开后这些改动会丢失。</Text>
            <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.sm, flexWrap: 'wrap' }}>
              <Pressable style={styles.retryBtn} accessibilityRole="button" onPress={() => setPendingLeave(null)}><Text style={styles.retryBtnText}>继续编辑</Text></Pressable>
              <Pressable
                style={[styles.retryBtn, { borderColor: colors.failed }]}
                accessibilityRole="button"
                onPress={() => { const go = pendingLeave; setPendingLeave(null); setRulesDirty(false); go?.(); }}
              >
                <Text style={{ color: colors.failed, fontWeight: '600' }}>放弃修改</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      <Modal transparent visible={!readOnly && !!pendingAction} onRequestClose={() => setPendingAction(null)} animationType="fade">
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center', padding: spacing.xl }}>
          <View style={{ width: '100%', maxWidth: 420, borderRadius: 14, backgroundColor: colors.card, padding: spacing.xl, gap: spacing.md }}>
            <Text style={{ color: colors.text, fontSize: 17, fontWeight: '600' }}>
              {pendingAction === 'restart_node' ? '重启节点？' : pendingAction === 'stop_node' ? '停止节点？' : '删除节点？'}
            </Text>
            <Text style={{ color: colors.textSecondary, fontSize: 13, lineHeight: 19 }}>
              {pendingAction === 'delete_node' ? `删除会撤销节点身份。请输入别名“${alias}”确认；节点配置默认备份保留。` : `目标：${alias}。请求提交后请等待节点状态刷新。`}
            </Text>
            {pendingAction === 'delete_node' ? (
              <TextInput value={confirmAlias} onChangeText={setConfirmAlias} autoCapitalize="none" placeholder={alias} placeholderTextColor={colors.textMuted} style={{ color: colors.text, borderWidth: 1, borderColor: colors.border, borderRadius: 8, padding: spacing.md }} />
            ) : null}
            <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.sm }}>
              <Pressable style={styles.retryBtn} onPress={() => { setPendingAction(null); setConfirmAlias(''); }}><Text style={styles.retryBtnText}>返回</Text></Pressable>
              <Pressable
                style={[styles.retryBtn, pendingAction === 'delete_node' && { borderColor: colors.failed }, (actionBusy || (pendingAction === 'delete_node' && confirmAlias !== alias)) && { opacity: 0.4 }]}
                disabled={actionBusy || (pendingAction === 'delete_node' && confirmAlias !== alias)}
                onPress={() => void executeLifecycle()}
              >
                <Text style={{ color: pendingAction === 'delete_node' ? colors.failed : colors.accent, fontWeight: '600' }}>{actionBusy ? '提交中…' : '确认'}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </KeyboardAvoidingView>
  );
}

const localStyles = StyleSheet.create({
  headerCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.lg,
    borderBottomWidth: 1,
  },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  chip: {
    borderRadius: 6,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    maxWidth: 260,
  },
  rail: {
    width: 200,
    borderRightWidth: 1,
    paddingTop: spacing.md,
  },
  railList: { paddingHorizontal: spacing.sm, gap: 2 },
  railItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
    borderRadius: 10,
  },
  // Android two-pane (touch): Material's 48 dp minimum for the rail, 40 dp for the chip row.
  railItemTouch: { minHeight: 48 },
  tabTouch: { minHeight: 40, justifyContent: 'center' },
  tabsWrap: {
    borderBottomWidth: 1,
    paddingVertical: spacing.sm,
  },
  tabsRow: { flexDirection: 'row', paddingHorizontal: spacing.md, gap: spacing.xs },
  tab: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs + 2,
    borderRadius: 10,
  },
  dangerZone: {
    borderWidth: 1,
    borderRadius: 14,
    padding: spacing.lg,
  },
  actionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: spacing.sm,
  },
  actionButton: {
    minWidth: 92,
    height: 34,
    borderRadius: 7,
    borderWidth: 1,
    paddingHorizontal: spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionButtonPressed: {
    opacity: 0.68,
    transform: [{ scale: 0.98 }],
  },
  actionButtonText: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '600',
  },
});
