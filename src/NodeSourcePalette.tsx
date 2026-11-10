// 节点来源浮层：新建会话 / 接入已有会话 / 独立 fork —— 与模型选择器同一套命令面板语言。
//
// 数据只来自真后端：
//   · fork 源 = full /api/status 里带 ses_ 的受管会话（读不到就显示真实原因，不编名单）；
//   · 目录 = /api/node-session-control/source/directory 的只读快照（oprj_ 新建 / oses_ 接入）。
// 合同（一个字段都不改）：
//   · project/attach：selection_scope + snapshot_id + child_name + intent_id，再加 project_id **或** session_id；
//   · fork：network_id + source_node_id + session_id(ses_) + mode=fork_independent + child_name + intent_id；
//   · oses_ 是目录 ID，永远不能变成 fork 的 session_id；
//   · 404 = gate 未开放：显示「未开放」，绝不 fallback 普通创建；unknown 不新开意图。
import { useEffect, useMemo, useRef, useState } from 'react';
import { Platform, Pressable, View } from 'react-native';
import { Text, TextInput } from './ui-text';
import { Ionicons } from './icons';
import {
  fetchNodeStatus,
  fetchHubNodes,
  getSessionSourceFork,
  getSourceDirectory,
  postSessionSourceFork,
  postSourceDirectory,
  postSourceProjectCreate,
  getSourceProjectCreate,
  type HubConfig,
} from './api';
import {
  classifyProjectCreate,
  projectCreateLabel,
} from './session-project-create';
import {
  classifyStatus,
  gateClosedMessage,
  newIntentId,
  type SourceForkReceipt,
} from './session-source-fork';
import {
  gateClosedDirectoryMessage,
  sessionBadge,
  type DirectorySnapshot,
} from './session-source-directory';
import { canUseSnapshotForNewSession } from './session-project-create';
import {
  activeSourceKey,
  buildPaletteSubmission,
  childNameIssue,
  currentSourceKey,
  directoryRows,
  forkRows,
  paletteModeLabel,
  paletteRowSummary,
  sourcePaletteView,
  stepActiveKey,
  suggestChildName,
  suggestForkChildName,
  isSourceBusyStatus,
  targetOfRow,
  type ForkCandidate,
  type PaletteTarget,
  type SourceRow,
} from './node-source-palette';
import {
  PaletteEmpty,
  PaletteError,
  PaletteGroupHeader,
  PaletteList,
  PaletteLoading,
  PaletteOverlay,
  PaletteRow,
  PaletteSearch,
  PaletteSectionLabel,
  makePaletteStyles,
  type PaletteKey,
} from './palette-kit';
import { t } from './i18n';
import './i18n-node-source';
import { colors } from './theme';
import { nodeProviderDaemon } from './node-provider-target';

interface Props {
  cfg: HubConfig;
  /** 受管 source 节点（fork 的 source_node_id / 目录请求的 source_node_id）。 */
  sourceNodeId: string;
  networkId: string | null;
  /** 当前节点会话（ses_）。有它就默认选中并进入 fork 确认。 */
  sessionId: string | null;
  /** 调用方已有的受管会话名单（可选）。不给就自己读 full /api/status。 */
  forkSessions?: readonly ForkCandidate[];
  title?: string;
  onClose: () => void;
  daemonNodeId?: string;
  /** Chat entry is scoped to its real current session, not directory/create. */
  forkOnly?: boolean;
  forkSourceError?: string | null;
}

type DirectoryState =
  | { kind: 'idle' | 'pending' }
  | { kind: 'ready'; snapshot: DirectorySnapshot; selectionScope: string | null }
  | { kind: 'failed' | 'unavailable' | 'denied'; error: string };

interface ForkState {
  kind: 'loading' | 'ready' | 'error';
  candidates: ForkCandidate[];
  error: string | null;
}

const DIRECTORY_POLL_MS = 1500;
const FORK_POLL_MS = 2000;

export default function NodeSourcePalette({ cfg, sourceNodeId, networkId, sessionId, forkSessions, title, onClose, daemonNodeId: suppliedDaemon, forkOnly = false, forkSourceError }: Props) {
  const styles = makePaletteStyles();
  const [query, setQuery] = useState('');
  const [fork, setFork] = useState<ForkState>({ kind: 'loading', candidates: [], error: null });
  const [directory, setDirectory] = useState<DirectoryState>({ kind: 'idle' });
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [childName, setChildName] = useState('');
  // 名字是用户改过的就不再被自动建议覆盖；没改过时换目标行跟着换（fork-… / …-new / …-attach）。
  const [childNameTouched, setChildNameTouched] = useState(false);
  // fork 的默认名按「XXX N号」往上编（admin 2026-11-10）：要知道网络里已有哪些名字。读不到就退回旧建议。
  const [existingAliases, setExistingAliases] = useState<string[] | null>(null);
  useEffect(() => {
    let live = true;
    fetchHubNodes(cfg).then(r => { if (live) setExistingAliases((r.nodes ?? []).map(n => n.alias).filter(Boolean)); })
      .catch(() => { if (live) setExistingAliases([]); });
    return () => { live = false; };
  }, [cfg]);
  const nameFor = (kind: Parameters<typeof suggestChildName>[0], label: string, id: string) =>
    (kind === 'fork' ? suggestForkChildName(label, existingAliases ?? []) : null) ?? suggestChildName(kind, label, id);
  const [busy, setBusy] = useState(false);
  const [projectUnresolved, setProjectUnresolved] = useState(false);
  const [daemonId, setDaemonId] = useState<string | null>(suppliedDaemon ?? null);
  const [daemonError, setDaemonError] = useState<string | null>(null);
  const directoryRequestRef = useRef<string | null>(null);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<SourceForkReceipt | null>(null);
  const intentRef = useRef<{ target: PaletteTarget; key: string; id: string; name: string } | null>(null);
  const submittingRef = useRef(false);
  const autoScopedRef = useRef<string | null>(null);
  const liveRef = useRef(true);
  useEffect(() => { liveRef.current = true; return () => { liveRef.current = false; }; }, []);

  useEffect(() => {
    if (forkOnly) return;
    let live = true;
    setDaemonId(suppliedDaemon ?? null);
    setDaemonError(null);
    if (!suppliedDaemon) void fetchHubNodes(cfg).then(result => {
      if (!live) return;
      const node = result.nodes.find(item => item.node_id === sourceNodeId);
      const id = node ? nodeProviderDaemon(node) : null;
      setDaemonId(id);
      if (!id) setDaemonError('source_daemon_unavailable');
    }).catch(error => { if (live) setDaemonError(String(error?.message ?? error)); });
    return () => { live = false; };
  }, [cfg, sourceNodeId, suppliedDaemon, forkOnly]);

  // ── fork 名单：调用方给了就用；否则读 full /api/status（只保留 ses_ + 本网络）──
  useEffect(() => {
    if (forkSessions !== undefined) {
      setFork({ kind: 'ready', candidates: [...forkSessions], error: forkSourceError ?? null });
      return;
    }
    let live = true;
    setFork({ kind: 'loading', candidates: [], error: null });
    if (!cfg.networkId) {
      setFork({ kind: 'error', candidates: [], error: '缺少 network_id：读不到受管会话名单' });
      return () => { live = false; };
    }
    Promise.all([fetchNodeStatus(cfg), fetchHubNodes(cfg)])
      .then(([data, managed]) => {
        if (!live) return;
        const rows = (data?.sessions ?? [])
          .filter(s => !!s?.node_id && typeof s.session_id === 'string' && s.session_id.startsWith('ses_'))
          .filter(s => s.network_id === networkId)
          .filter(s => managed.nodes.some(node => node.node_id === s.node_id && node.runtime === 'opencode-cli' && node.opencode_generation === 'v2'))
          .map(s => ({ sessionId: s.session_id as string, nodeId: s.node_id as string, label: s.alias || (s.session_id as string), path: s.project_dir ?? null }));
        setFork({ kind: 'ready', candidates: rows, error: null });
      })
      .catch((e: unknown) => {
        if (!live) return;
        setFork({ kind: 'error', candidates: [], error: String((e as Error)?.message ?? e) });
      });
    return () => { live = false; };
  }, [cfg.serverUrl, cfg.token, cfg.networkId, cfg.profileId, forkSessions, networkId, forkSourceError]);

  // ── 目录（只读）：POST → 轮询 GET；单 Server 时自动选一次拿 selection_scope ──
  useEffect(() => {
    if (forkOnly) { setDirectory({ kind: 'idle' }); return; }
    if (!networkId || !sourceNodeId || !daemonId) {
      setDirectory(daemonError ? { kind: 'failed', error: daemonError } : { kind: 'pending' }); return;
    }
    let live = true;
    let timer: ReturnType<typeof setInterval> | undefined;
    let requestId: string | null = null;
    autoScopedRef.current = null;
    setDirectory({ kind: 'pending' });
    void (async () => {
      const posted = await postSourceDirectory(cfg, { networkId, sourceNodeId, daemonNodeId: daemonId });
      if (!live) return;
      if (!posted.ok) {
        setDirectory({
          kind: posted.unavailable ? 'unavailable' : posted.denied ? 'denied' : 'failed',
          error: posted.unavailable ? `${posted.error} · ${gateClosedDirectoryMessage()}` : posted.error,
        });
        return;
      }
      requestId = posted.requestId;
      directoryRequestRef.current = requestId;
      const tick = async () => {
        if (!live || !requestId) return;
        const result = await getSourceDirectory(cfg, requestId, networkId);
        if (!live) return;
        if (result.kind === 'ready') {
          if (timer) clearInterval(timer);
          setDirectory({ kind: 'ready', snapshot: result.snapshot, selectionScope: autoScopedRef.current });
          // 合同：selection_scope 必须是「选过 Server 并返回 projects」的那次请求；单 Server 自动选它。
          const servers = result.snapshot.servers ?? [];
          if (servers.length === 1 && !autoScopedRef.current) {
            const selected = await postSourceDirectory(
              cfg,
              { networkId, sourceNodeId, daemonNodeId: daemonId },
              servers[0].serverId,
              requestId ?? undefined,
            );
            if (!live) return;
            if (selected.ok) {
              autoScopedRef.current = selected.requestId;
              directoryRequestRef.current = selected.requestId;
              requestId = selected.requestId;
              // Keep the initial authorized rows on screen (they are disabled, with the real
              // reason) while the selected scope is read once — no blank flash, no replay of
              // the initial snapshot as if it had a selection_scope.
              const scoped = await getSourceDirectory(cfg, selected.requestId, networkId);
              if (!live) return;
              if (scoped.kind === 'ready') setDirectory({ kind: 'ready', snapshot: scoped.snapshot, selectionScope: selected.requestId });
              else if (scoped.kind === 'failed' || scoped.kind === 'denied' || scoped.kind === 'unavailable') setDirectory({ kind: scoped.kind, error: scoped.error });
            } else setDirectory({ kind: 'failed', error: selected.error });
          }
          return;
        }
        if (result.kind === 'failed' || result.kind === 'unavailable' || result.kind === 'denied') {
          if (timer) clearInterval(timer);
          setDirectory({ kind: result.kind, error: result.kind === 'unavailable' ? `${result.error} · ${gateClosedDirectoryMessage()}` : result.error });
        }
      };
      // 第一次不要白等一个轮询周期；行一就绪就先画出来（没拿到 selection_scope 时是禁用态）。
      void tick();
      timer = setInterval(() => { void tick(); }, DIRECTORY_POLL_MS);
    })();
    return () => { live = false; if (timer) clearInterval(timer); };
  }, [cfg.serverUrl, cfg.token, cfg.networkId, cfg.profileId, networkId, sourceNodeId, daemonId, daemonError, forkOnly]);

  // ── fork 回执轮询：unknown 继续用同一 request_id 收敛（不新开意图）──
  useEffect(() => {
    if (!receipt || !networkId) return;
    const outcome = classifyStatus(receipt.status);
    if (outcome.kind !== 'progress' && outcome.kind !== 'unknown') return;
    let live = true;
    const timer = setInterval(async () => {
      const next = await getSessionSourceFork(cfg, receipt.requestId, networkId);
      if (!live) return;
      if (!next.ok) { setErrorText(next.error); return; }
      setReceipt(next.receipt);
    }, FORK_POLL_MS);
    return () => { live = false; clearInterval(timer); };
  }, [receipt, cfg, networkId]);

  const snapshot = directory.kind === 'ready' ? directory.snapshot : null;
  const gate = useMemo(() => ({
    networkId,
    sourceNodeId,
    selectionScope: directory.kind === 'ready' ? directory.selectionScope : null,
    snapshotId: snapshot?.snapshotId ?? null,
    selectionExpiresAt: snapshot?.selectionExpiresAt ?? null,
    hasProjectCreateCapability: true,
  }), [networkId, sourceNodeId, directory, snapshot]);

  // 名单读不到时，当前节点会话仍然是真实存在的 fork 源（只有 id 与标题）。
  const forkCandidates = useMemo<ForkCandidate[]>(() => {
    const listed = fork.kind === 'ready' ? [...fork.candidates] : [];
    if (sessionId && !listed.some(c => c.sessionId === sessionId)) {
      listed.unshift({ sessionId, nodeId: sourceNodeId, label: sessionId, path: null });
    }
    return listed;
  }, [fork, sessionId, sourceNodeId]);

  const forkRowList = useMemo(() => forkRows(forkCandidates, gate), [forkCandidates, gate]);
  const directoryRowList = useMemo(() => directoryRows(snapshot, gate), [snapshot, gate]);
  const rows = useMemo(() => [...forkRowList, ...directoryRowList], [forkRowList, directoryRowList]);
  const view = useMemo(() => sourcePaletteView({
    forkRows: forkRowList,
    directoryRows: directoryRowList,
    snapshot,
    query,
    selectedKey,
    directoryLoading: !forkOnly && (directory.kind === 'idle' || directory.kind === 'pending'),
    directoryError: directory.kind === 'failed' || directory.kind === 'unavailable' || directory.kind === 'denied' ? directory.error : null,
    forkLoading: fork.kind === 'loading',
    forkError: fork.kind === 'error' ? fork.error : null,
  }), [forkRowList, directoryRowList, snapshot, query, selectedKey, directory, fork, forkOnly]);

  const selectedRow = rows.find(row => row.key === selectedKey) ?? null;
  const target: PaletteTarget | null = selectedRow ? targetOfRow(selectedRow) : null;

  // 默认选中当前节点会话（fork），并给一个可改的初始名。
  useEffect(() => {
    if (selectedKey || !sessionId) return;
    const key = `fork:${sessionId}`;
    if (!rows.some(row => row.key === key)) return;
    const candidate = forkCandidates.find(item => item.sessionId === sessionId);
    setSelectedKey(key);
    setChildName(prev => prev || nameFor('fork', candidate?.label ?? sessionId, sessionId));
  }, [rows, selectedKey, sessionId, forkCandidates]);

  useEffect(() => {
    if (!existingAliases || childNameTouched || !selectedRow || selectedRow.kind !== 'fork') return;
    setChildName(nameFor(selectedRow.kind, selectedRow.title, selectedRow.id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [existingAliases]);

  const pick = (row: SourceRow) => {
    if (busy || projectUnresolved || (receipt && classifyStatus(receipt.status).kind !== 'registration-receipt')) return;
    setNotice(null);
    if (row.disabledReason) {
      setErrorText(row.disabledReason);
      return;
    }
    setErrorText(null);
    setSelectedKey(row.key);
    setActiveKey(row.key);
    setReceipt(null);
    if (!childNameTouched) setChildName(nameFor(row.kind, row.title, row.id));
  };

  const chooseServer = async (serverId: string) => {
    if (directory.kind !== 'ready' || !networkId || !daemonId || busy) return;
    const selected = await postSourceDirectory(cfg, { networkId, sourceNodeId, daemonNodeId: daemonId }, serverId, directoryRequestRef.current ?? undefined);
    if (!selected.ok) {
      setErrorText(selected.unavailable ? gateClosedDirectoryMessage() : selected.error);
      return;
    }
    setDirectory({ kind: 'pending' });
    for (let i = 0; i < 26; i++) {
      await new Promise(resolve => setTimeout(resolve, DIRECTORY_POLL_MS));
      if (!liveRef.current) return;
      const result = await getSourceDirectory(cfg, selected.requestId, networkId);
      if (result.kind === 'ready') { setDirectory({ kind: 'ready', snapshot: result.snapshot, selectionScope: selected.requestId }); break; }
      if (result.kind === 'failed' || result.kind === 'denied' || result.kind === 'unavailable') { setDirectory({ kind: result.kind, error: result.error }); break; }
    }
    setErrorText(null);
  };

  /** 源节点空闲（或读不到状态）才放行；最多等 10 分钟，关掉弹窗即停止。 */
  const waitForSourceIdle = async (alias: string): Promise<boolean> => {
    const deadline = Date.now() + 10 * 60_000;
    let waited = false;
    for (;;) {
      if (!liveRef.current) return false;
      const data = await fetchNodeStatus(cfg, alias).catch(() => null);
      const row = (data?.sessions ?? []).find(item => item?.node_id === sourceNodeId || item?.alias === alias);
      if (!isSourceBusyStatus(row?.status)) {
        if (waited) await new Promise(resolve => setTimeout(resolve, 2000)); // 让这一轮的落盘先完成
        if (waited && liveRef.current) setNotice(null);
        return liveRef.current;
      }
      if (Date.now() >= deadline) { setErrorText('源节点一直在工作（等了 10 分钟），请稍后再 fork'); return false; }
      waited = true;
      setNotice('源节点正在工作，这一轮结束后会自动提交 fork…');
      await new Promise(resolve => setTimeout(resolve, 3000));
    }
  };

  const submit = async () => {
    if (submittingRef.current || busy || projectUnresolved) return;
    if (!selectedRow) { setErrorText(t('sourcePalette.confirmHint')); return; }
    if (selectedRow.kind !== 'fork') {
      const usable = canUseSnapshotForNewSession({ snapshot: { expiresAt: null, selectionExpiresAt: snapshot?.selectionExpiresAt ?? null }, hasProjectCreateCapability: true });
      if (!usable.ok) { setErrorText(usable.reason); return; }
    }
    if (receipt && selectedRow.kind === 'fork') { setErrorText(`已有请求 ${receipt.requestId}：仅查询回执，不重新提交`); return; }
    if (intentRef.current?.key === selectedRow.key && intentRef.current.name !== childName) {
      setErrorText('intent_payload_changed：原意图名称不可修改，请先确认原请求终局'); return;
    }
    const key = selectedRow.key;
    const intent = intentRef.current && intentRef.current.target === target && intentRef.current.key === key
      ? intentRef.current.id
      : newIntentId(`${sourceNodeId}_${selectedRow.id}`);
    const ready = directory.kind === 'ready' ? directory : null;
    const submission = buildPaletteSubmission({
      row: selectedRow,
      networkId,
      sourceNodeId,
      selectionScope: ready?.selectionScope ?? '',
      snapshotId: ready?.snapshot.snapshotId ?? '',
      childName,
      intentId: intent,
    });
    if (!submission.ok) { setErrorText(submission.error); return; }
    intentRef.current = { target: submission.target, key, id: intent, name: childName };
    submittingRef.current = true;
    setBusy(true);
    setErrorText(null);
    setNotice(null);
    try {
      if (submission.target === 'fork') {
        // 源会话正在跑一轮时，fork 的第一步（读会话证据）一定被拒，而 Hub 只回一个笼统的
        // unknown_rotation_required（admin 2026-11-10 实测）。所以先等源节点这一轮结束再提交。
        const idle = await waitForSourceIdle(selectedRow.title);
        if (!idle) return;
        const result = await postSessionSourceFork(cfg, submission.selection);
        if (!result.ok) {
          if (result.unavailable) { setErrorText(`${result.error} · ${gateClosedMessage()}`); return; }
          setErrorText(result.error);
          return;
        }
        setReceipt(result.receipt);
        return;
      }
      const result = await postSourceProjectCreate(cfg, submission.selection);
      if (!result.ok) {
        setErrorText(`${result.error}${result.unavailable ? ' · 该通道未开放（不会退回普通创建）' : ''}`);
        return;
      }
      // 只 GET 收敛同一个请求；unknown 不重放、不换 intent。
      setProjectUnresolved(true);
      let status = result.status;
      let sessionCreation = result.sessionCreation;
      let childNodeId: string | undefined;
      for (let i = 0; i < 26 && status !== 'registration_confirmed' && status !== 'unknown_rotation_required'; i++) {
        if (!liveRef.current) return;
        await new Promise(resolve => setTimeout(resolve, FORK_POLL_MS));
        const polled = await getSourceProjectCreate(cfg, result.requestId, networkId ?? '');
        if (!polled.ok) { setErrorText(polled.error); return; }
        status = polled.status;
        sessionCreation = polled.sessionCreation;
        childNodeId = polled.childNodeId;
      }
      setNotice(projectCreateLabel(classifyProjectCreate(status as Parameters<typeof classifyProjectCreate>[0], sessionCreation, childNodeId)));
      if (status === 'registration_confirmed') setProjectUnresolved(false);
    } catch (error) {
      if (liveRef.current) setErrorText(String((error as Error)?.message ?? error));
    } finally {
      submittingRef.current = false;
      if (liveRef.current) setBusy(false);
    }
  };

  const handleKey = (key: PaletteKey) => {
    if (key === 'escape') { onClose(); return; }
    if (key === 'enter') {
      const focused = Platform.OS === 'web' ? (globalThis as { document?: Document }).document?.activeElement : null;
      const isNameInput = (focused as { getAttribute?: (name: string) => string | null } | null)?.getAttribute?.('data-testid');
      if (isNameInput === 'source-fork-child-name' || isNameInput === 'project-create-child-name') { void submit(); return; }
      // active 可能停在已经被搜索过滤掉的行上；Enter 只能选当前可见行。
      const visibleActive = activeSourceKey(view.order, activeKey);
      if (visibleActive && visibleActive !== selectedKey) {
        const row = rows.find(item => item.key === visibleActive);
        if (row) pick(row);
      }
      return;
    }
    const next = stepActiveKey(view.order, activeKey ?? selectedKey, key === 'down' ? 1 : -1);
    if (next) setActiveKey(next);
  };

  const nameIssue = target ? childNameIssue(childName) : null;
  const newSessionGate = canUseSnapshotForNewSession({
    snapshot: { expiresAt: null, selectionExpiresAt: snapshot?.selectionExpiresAt ?? null },
    hasProjectCreateCapability: true,
  });
  const newSessionUsable = newSessionGate.ok;
  const newSessionReason = newSessionGate.reason;
  const scopeMissing = !!target && target !== 'fork' && (!(directory.kind === 'ready') || !directory.selectionScope);
   const canSubmit = !!selectedRow && !selectedRow.disabledReason && !nameIssue && !busy && !projectUnresolved && !scopeMissing && !(target === 'fork' && receipt);
  const forkOutcome = receipt ? classifyStatus(receipt.status) : null;
  const servers = snapshot?.servers ?? [];

  return (
    <PaletteOverlay testID="source-fork-frame" onClose={onClose} onKey={handleKey}>
      <View style={styles.header}>
        <Text style={styles.headerTitle} numberOfLines={1} testID="source-palette-title">{title ?? t('sourcePalette.title')}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel={t('sourcePalette.close')} onPress={onClose} hitSlop={8} style={styles.closeBtn} testID="source-fork-frame-close">
          <Ionicons name="close" size={18} color={colors.textSecondary} />
        </Pressable>
      </View>
      <Text style={styles.headerSub} numberOfLines={1} testID="source-fork-network">
        {t('sourcePalette.sourceLine', { network: networkId ?? '—', node: sourceNodeId })}
      </Text>
      <PaletteSearch
        value={query}
        onChangeText={setQuery}
        placeholder={t('sourcePalette.search')}
        accessibilityLabel={t('sourcePalette.searchLabel')}
        testID="source-palette-search"
        autoFocus={Platform.OS === 'web'}
      />

      {busy ? <PaletteLoading text={t('sourcePalette.submitting')} testID="source-palette-busy" /> : null}
      {forkOnly && forkSourceError ? <PaletteError text={forkSourceError} testID="chat-fork-source-error" /> : null}

      <View testID="source-directory-section" style={{ flexShrink: 1, minHeight: 0 }}>
        {view.status === 'loading' ? <PaletteLoading text={t('sourcePalette.loading')} testID="source-palette-loading" /> : null}
        {view.status === 'error' ? <PaletteError text={view.errorText ?? ''} testID="source-palette-error" /> : null}
        {view.status === 'ready' && view.total === 0 ? (
          view.catalogTotal === 0 ? (
            <PaletteEmpty
              title={t('sourcePalette.catalogEmpty')}
              hint={view.directoryError ?? null}
              testID="source-palette-empty"
            />
          ) : (
            <PaletteEmpty title={t('sourcePalette.noMatch', { query })} testID="source-palette-no-match" />
          )
        ) : null}
        {view.status === 'ready' && view.total > 0 ? (
          <PaletteList testID="source-palette-list">
            {(['fork', 'directory'] as const).map(section => {
              const groups = view.groups.filter(group => group.section === section);
              const sectionError = section === 'fork' ? view.forkError : view.directoryError;
              if (!groups.length && !sectionError) return null;
              return (
                <View key={section}>
                  {section === 'directory' ? <View style={styles.divider} /> : null}
                  <PaletteSectionLabel
                    title={section === 'fork' ? t('sourcePalette.forkSection') : t('sourcePalette.directorySection')}
                    testID={`source-palette-section-${section}`}
                  />
                  {sectionError ? (
                    <PaletteError
                      text={sectionError}
                      testID={section === 'fork' ? 'source-palette-fork-error' : 'source-directory-failed'}
                    />
                  ) : null}
                  {groups.map(group => (
                    <View key={group.key} style={styles.group}>
                      <PaletteGroupHeader
                        title={group.title}
                        count={group.count}
                        path={group.path}
                        testID={`source-palette-group-${group.key}`}
                      />
                      {group.rows.map(row => (
                        <PaletteRow
                          key={row.key}
                          testID={row.kind === 'project'
                            ? `project-create-pick-${row.id}`
                            : row.kind === 'session'
                              ? `project-create-attach-${row.id}`
                              : `source-palette-row-${row.id}`}
                          label={row.kind === 'project' ? `新建空会话 · ${row.title}` : row.title}
                          detail={row.disabledReason ?? row.detail}
                          current={row.key === view.currentKey}
                          active={row.key === activeKey}
                          disabled={!!row.disabledReason}
                          onPress={() => pick(row)}
                          accessibilityLabel={`${row.title} ${row.id}${row.disabledReason ? `（${t('sourcePalette.rowDisabled')}：${row.disabledReason}）` : ''}`}
                        />
                      ))}
                    </View>
                  ))}
                </View>
              );
            })}
          </PaletteList>
        ) : null}
        {directory.kind === 'unavailable' ? <PaletteError text={directory.error} testID="source-directory-unavailable" /> : null}
        {directory.kind === 'pending' ? <PaletteLoading text={t('sourcePalette.loading')} testID="source-directory-pending" /> : null}
      </View>

      {servers.length > 1 && directory.kind === 'ready' && !directory.selectionScope ? (
        <View style={styles.confirm} testID="source-palette-server-picker">
          <Text style={styles.confirmMode}>{t('sourcePalette.needsServer')}</Text>
          <View style={styles.chipRow}>
            {servers.map(server => (
              <Pressable key={server.serverId} testID={`source-palette-server-${server.serverId}`} onPress={() => void chooseServer(server.serverId)} style={styles.chip} accessibilityRole="button">
                <Text style={styles.chipText}>{server.title || server.serverId}</Text>
              </Pressable>
            ))}
          </View>
        </View>
      ) : null}

      <View style={styles.confirm} testID="source-palette-confirm">
        <View style={styles.confirmHead}>
          <Text style={styles.confirmMode} numberOfLines={2} testID="source-palette-mode">
            {target ? paletteModeLabel(target) : t('sourcePalette.confirmHint')}
          </Text>
          {selectedRow && !selectedRow.disabledReason ? (
            <Pressable
              testID={target === 'fork' ? 'source-fork-submit' : 'project-create-submit'}
              accessibilityRole="button"
              accessibilityState={{ disabled: !canSubmit }}
              disabled={!canSubmit}
              onPress={() => void submit()}
              style={[styles.primaryBtn, !canSubmit && { opacity: 0.4 }]}
            >
              <Text style={styles.primaryBtnText}>{busy ? t('sourcePalette.submitting') : t('sourcePalette.submit')}</Text>
            </Pressable>
          ) : null}
        </View>
        {selectedRow ? (
          <Text style={styles.confirmSelection} numberOfLines={1} testID="source-palette-selected">{paletteRowSummary(selectedRow)}</Text>
        ) : null}
        {target ? (
          <View style={styles.confirmRow}>
            <TextInput
              testID={target === 'fork' ? 'source-fork-child-name' : 'project-create-child-name'}
              value={childName}
              onChangeText={value => { setChildName(value); setChildNameTouched(true); setErrorText(null); }}
              placeholder={t('sourcePalette.childName')}
              placeholderTextColor={colors.textMuted}
              editable={!busy}
              autoCapitalize="none"
              autoCorrect={false}
              accessibilityLabel={t('sourcePalette.childName')}
              style={[styles.confirmInput, !!nameIssue && childName.length > 0 && { borderColor: colors.failed }]}
            />
            <Pressable
              testID="source-palette-cancel"
              accessibilityRole="button"
              onPress={onClose}
              style={styles.ghostBtn}
            >
              <Text style={styles.ghostBtnText}>{t('sourcePalette.cancel')}</Text>
            </Pressable>
          </View>
        ) : null}
        {target && nameIssue && childName.length > 0 ? (
          <Text style={styles.errorDetail} testID="source-palette-name-error">{nameIssue}</Text>
        ) : null}
        {receipt ? (
          <Text style={styles.confirmSelection} testID="source-fork-status">
            {forkOutcome?.kind === 'registration-receipt'
              ? `注册回执（非原生接受/存活）：${receipt.status}`
              : `状态：${receipt.status}${receipt.childSessionId ? ` · child ${receipt.childSessionId}` : ''}${receipt.status === 'unknown_rotation_required' ? ' · 未能完成，最常见的原因是提交时源节点正在工作；等它空闲后换个名字重试' : ''}`}
          </Text>
        ) : null}
        {notice ? <Text style={styles.notice} testID="project-create-status">{notice}</Text> : null}
        {/* 兼容旧证据驱动：新建/接入的失败同时挂在 project-create-status 上（fork 仍走 source-fork-message）；
            真实错误码原样显示，不做 fallback、不吞成成功。 */}
        {errorText ? (
          <PaletteError
            text={errorText}
            testID={target === 'fork' ? 'source-fork-message' : 'project-create-status'}
            textTestID="source-palette-action-error"
          />
        ) : null}
      </View>

      {view.status === 'ready' && view.catalogTotal > 0 ? (
        <Text style={styles.source} numberOfLines={2} testID="source-palette-source">
          {forkOnly ? 'fork 源：当前节点的实时 /api/status 上报' : fork.kind === 'ready' && fork.candidates.length
            ? `fork 源：full /api/status 的受管会话（${fork.candidates.length}）· 目录：只读快照 ${snapshot?.snapshotId ?? '—'}`
            : `目录：只读快照 ${snapshot?.snapshotId ?? '—'}（${snapshot?.completeness ?? 'authorized_scope_only'}）`}
        </Text>
      ) : null}
      {!snapshot && !forkOnly ? (
        <Text style={styles.source} testID="source-fork-gate">
          没有目录快照：只能 fork 当前受管会话（新建/接入需要只读目录授权）
        </Text>
      ) : !forkOnly && !newSessionUsable ? (
        <Text style={styles.source} testID="source-fork-gate">
          {newSessionReason}
        </Text>
      ) : null}
      {snapshot && snapshot.sessions.length ? (
        <Text style={styles.source} numberOfLines={1} testID="source-palette-session-badge">
          {`目录会话口径：${sessionBadge({ sessionId: snapshot.sessions[0].sessionId, projectId: snapshot.sessions[0].projectId, title: snapshot.sessions[0].title, activity: snapshot.sessions[0].activity, binding: 'unknown', attachAuthorized: false })}`}
        </Text>
      ) : null}
    </PaletteOverlay>
  );
}
