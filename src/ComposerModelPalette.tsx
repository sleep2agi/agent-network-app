// #4130 follow-up —— 聊天页「选模型」浮层命令面板（OpenCode 风格）。
//
// 只做三件事：
//  1) 搜索 + provider 分组列表（数据只来自这台节点的 read_opencode_catalog 快照）；
//  2) 点一行 → 走现有 canonical 配置写入（baseRevision + update_node_config）；
//  3) 本次 update_id 的终局 ACK **且** 真实 config 读回匹配，才把新值交给 footer。
//
// 读不到目录就显示真实原因；没有当前模型就不打勾；不编 provider、不编档位。
import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, ScrollView, useWindowDimensions, View } from 'react-native';
import { Text, TextInput } from './ui-text';

import { Ionicons } from './icons';
import { t } from './i18n';
import { colors, radius, spacing } from './theme';
import { ds } from './ui-scale';
import {
  fetchHubNodes,
  fetchNodeConfig,
  pollOpenCodeCatalog,
  queueOpenCodeCatalog,
  updateNodeConfig,
  type HubConfig,
  type HubNode,
  type NodeConfigRead,
} from './api';
import { catalogErrorText, isOpenCodeV2Node, mergeReportedVariants, peerCatalogWithVariants, reportedCatalogWithVariants } from './opencode-v2-model-list';
import { nodeProviderDaemon } from './node-provider-target';
import { modelControlAvailability } from './node-model-change';
import { variantValueError, variantWritable } from './node-variant-patch';
import { composerVariantLabel } from './composer-model-label';
import { composerAgentCurrent, composerAgentSectionVisible, composerAgentSwitchable, composerAgents, confirmComposerAgentSwitch } from './composer-agent';
import './i18n-composer-agent';
import {
  confirmComposerModelSwitch,
  confirmComposerVariantSwitch,
  paletteCatalogModels,
  paletteCurrentKey,
  paletteVariantChoices,
  paletteView,
  type PaletteCatalogSnapshot,
  type PaletteRow,
} from './composer-model-palette';

interface Props {
  cfg: HubConfig;
  /** 解析到的受权目标节点；null = 还在解析或没有唯一目标。 */
  node: HubNode | null;
  /** node=null 时的真实原因（无绑定 / 歧义 / 读取失败）。 */
  targetError?: string | null;
  /** 可信当前模型（上报或同 scope config 读回），可能为 null（未知）。 */
  currentModel: string | null;
  /** 可信当前档位：undefined=未知，null=明确默认，string=选中档。 */
  currentVariant: string | null | undefined;
  onReadback: (value: NodeConfigRead | null) => void;
  onClose: () => void;
}

const CATALOG_POLL_MS = 1000;
const CATALOG_MAX_POLLS = 15;
/** 写后读回：心跳间隔内等 model_effective（约 6s）。 */
const READBACK_POLLS = 4;
const READBACK_POLL_MS = 1500;

const INTERNAL_AGENTS = new Set(['compaction', 'title', 'summary']);

export default function ComposerModelPalette({ cfg, node, targetError, currentModel, currentVariant, onReadback, onClose }: Props) {
  const styles = makeStyles();
  const { height: windowHeight } = useWindowDimensions();
  const [query, setQuery] = useState('');
  // 清单不是这台节点自己的（来自同类节点）时的说明；null = 来源就是这台节点。
  const [catalogNote, setCatalogNote] = useState<string | null>(null);
  const [catalog, setCatalog] = useState<{ snapshot: PaletteCatalogSnapshot | null; loading: boolean; error: string | null }>({
    snapshot: null,
    loading: true,
    error: null,
  });
  // undefined = 正在读；null = Hub 没这个接口/读失败；对象 = 真实读回。
  const [config, setConfig] = useState<NodeConfigRead | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [errorDetail, setErrorDetail] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const lock = useRef(false);
  const scope = useMemo(() => ({}), [node?.node_id, cfg.serverUrl, cfg.networkId, cfg.profileId, cfg.token]);
  const scopeRef = useRef<object | null>(scope);
  const [agentConfigScope, setAgentConfigScope] = useState<object | null>(null);
  scopeRef.current = scope;
  useEffect(() => () => { if (scopeRef.current === scope) scopeRef.current = null; }, [scope]);
  const cfgRef = useRef(cfg);
  cfgRef.current = cfg;
  const readbackRef = useRef(onReadback);
  readbackRef.current = onReadback;
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof document === 'undefined') return;
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); closeRef.current(); }
    };
    document.addEventListener('keydown', escape);
    return () => document.removeEventListener('keydown', escape);
  }, []);

  // 打开面板就读一次受权配置：footer 的基准值与写入用的 baseRevision 都来自它。
  // 这不是「乐观值」：它只是节点当前真实配置，切没切成仍由写后的 ACK+读回决定。
  useEffect(() => {
    if (!node) { setConfig(undefined); return; }
    let live = true;
    setConfig(undefined);
    fetchNodeConfig(cfgRef.current, node.node_id)
      .then(value => {
        if (!live) return;
        setConfig(value);
        setAgentConfigScope(scope);
        readbackRef.current(value);
      })
      .catch(() => {
        if (!live) return;
        setConfig(null);
        readbackRef.current(null);
      });
    return () => { live = false; };
  }, [node?.node_id, cfg.serverUrl, cfg.networkId, cfg.profileId, cfg.token, scope]);

  // 目录：只读这台节点的 OpenCode V2 服务器。没有 daemon 绑定 / 不是 V2 / 超时
  // 都显示真实原因，不换别的节点目录、不退回内置清单。
  useEffect(() => {
    if (!node) { setCatalog({ snapshot: null, loading: true, error: null }); return; }
    let live = true;
    setCatalog({ snapshot: null, loading: true, error: null });
    if (!isOpenCodeV2Node(node)) {
      setCatalog({ snapshot: null, loading: false, error: catalogErrorText('not_opencode_v2') });
      return () => { live = false; };
    }
    // 节点自己上报到 Hub 的模型清单（GET /api/nodes 的 `opencode_catalog`）—— 真实来源，不是内置清单。
    // 档位也来自节点自报（opencode_catalog_variants，admin 2026-11-11「有没有让他正常上报」）。
    const reported = reportedCatalogWithVariants(node.opencode_catalog, node.opencode_catalog_variants);
    const reportedSnapshot = reported.length ? { models: reported } as PaletteCatalogSnapshot : null;
    // daemon 代读失败时：有上报清单就用它（收编来的节点 Hub 上没有「daemon 创建」记录，代读会被拒
    // node_not_found —— admin 2026-11-11 截图），没有才显示**翻译过的**原因，不再露原始错误码。
    setCatalogNote(null);
    const failWith = (error: string | undefined) => {
      if (reportedSnapshot) { setCatalog({ snapshot: reportedSnapshot, loading: false, error: null }); return; }
      // admin 2026-11-11（天马总运维截图）：手动启动、旧版本的节点既没人代读也没自报，面板只剩一段红字，
      // 连换模型都做不到。先用同 runtime 其他节点自报的清单兜底，并写明来源；都没有才显示原因。
      void fetchHubNodes(cfgRef.current).then(result => {
        if (!live) return;
        const peers = peerCatalogWithVariants(result.nodes, { runtime: node.runtime, excludeNodeId: node.node_id });
        if (peers.models.length) {
          setCatalog({ snapshot: { models: peers.models } as PaletteCatalogSnapshot, loading: false, error: null });
          setCatalogNote(t('chat.modelPicker.peerCatalogSource', { count: peers.nodes }));
        } else {
          setCatalog({ snapshot: null, loading: false, error: catalogErrorText(error) });
        }
      }).catch(() => { if (live) setCatalog({ snapshot: null, loading: false, error: catalogErrorText(error) }); });
    };
    // admin 2026-11-13：V2 节点有 daemon 时代读要排队 + 轮询（最长 15s），转圈很久。节点早已自报过清单，
    // 先把它画出来，代读回来再静默换成更新鲜的快照；代读失败就保持自报清单（failWith 同口径）。
    if (reportedSnapshot) setCatalog({ snapshot: reportedSnapshot, loading: false, error: null });
    const daemonNodeId = nodeProviderDaemon(node);
    if (!daemonNodeId) {
      // A node started by hand (`anet node start`, opencode-cli co-presence) has no daemon
      // binding, so the daemon relay cannot read its catalogue. The Hub still carries what the
      // node itself reported. Show it, never a builtin list.
      failWith('catalog_unmanaged_unreported');
      return () => { live = false; };
    }
    void (async () => {
      const queued = await queueOpenCodeCatalog(cfgRef.current, { nodeId: node.node_id, daemonNodeId });
      if (!live) return;
      if (!queued.ok) { failWith(queued.error); return; }
      for (let i = 0; i < CATALOG_MAX_POLLS; i++) {
        await new Promise(resolve => setTimeout(resolve, CATALOG_POLL_MS));
        if (!live) return;
        const polled = await pollOpenCodeCatalog(cfgRef.current, queued.request_id);
        if (!live) return;
        if (!polled.ok) { failWith(polled.error); return; }
        if (polled.status === 'ready') {
          // #4610：快照优先（更新鲜），但快照没给档位的模型用 Hub 自报的档位补上 ——
          // 否则老 daemon 的快照只有模型 id，档位 pill 永远「未知」。
          const merged = mergeReportedVariants(polled.snapshot as unknown as PaletteCatalogSnapshot, reported);
          setCatalog({ snapshot: (merged ?? polled.snapshot) as unknown as PaletteCatalogSnapshot, loading: false, error: null });
          return;
        }
      }
      if (live) failWith('unavailable');
    })();
    return () => { live = false; };
  }, [node?.node_id, node?.runtime, node?.lifecycle_daemon_node_id, node?.adoption?.status, node?.adoption?.daemon_node_id, (node?.opencode_catalog ?? []).join('|'), (node?.opencode_catalog_variants ?? []).join('|'), cfg.serverUrl, cfg.networkId, cfg.profileId, cfg.token]);

  const view = paletteView({
    snapshot: catalog.snapshot,
    query,
    currentModel,
    loading: catalog.loading && !targetError,
    error: targetError ?? catalog.error,
  });
  const catalogModels = useMemo(() => paletteCatalogModels(catalog.snapshot), [catalog.snapshot]);
  const currentKey = paletteCurrentKey(currentModel, catalogModels);
  const choices = paletteVariantChoices(catalog.snapshot, currentKey);
  const v2 = !!node && isOpenCodeV2Node(node);
  // #1428 审阅意见（通信客户端欧 2026-11-13）：只在**明确不是 V2** 时才锁成只读卡。
  // 「未知」不是「不支持」—— 老 Hub / 字段没读到时 runtime 可能为空，那时 `!v2` 成立，
  // 但那是「没读到」，不该按「明确不是 OpenCode V2」处理（会把这个节点整个面板锁死）。
  // 明确证据只有两种：代际字段说 v1；或者 runtime 有值且确实不在 OpenCode 名单里。
  const generation = node?.opencode_generation ?? node?.config_snapshot?.flags?.opencodeGeneration;
  const knownNonV2 = !!node && (generation === 'v1' || (!!node.runtime && !v2));
  const availability = modelControlAvailability(config ?? null, { hotModel: v2 });
  const variantGate = variantWritable({
    variantCapable: config?.opencode_variant_config_capable === true || config?.variant_capable === true,
    runtime: node?.runtime ?? null,
  });
  const agentConfig = agentConfigScope === scope ? config : null;
  // admin 2026-11-11（手机截图）：compaction / title / summary 是 OpenCode 内部用的 agent，
  // 用户不会去切；只在它恰好是当前值时才显示。
  const agents = composerAgents(agentConfig).filter(id => !INTERNAL_AGENTS.has(id) || id === agentConfig?.agent);
  const agentWritable = composerAgentSwitchable(agentConfig);
  const currentAgent = composerAgentCurrent(agentConfig);
  const showAgentSection = composerAgentSectionVisible(agentConfig);
  // admin 2026-11-11「切换模型的体验太差」：agent 改成一行芯片后，模型列表不再让出一半高度。
  // 面板整体（搜索 + 列表 + 来源 + 档位 + agent）必须落在屏幕内：手机上原来列表独占半屏，
  // 再加下面两段，顶端顶进了状态栏（admin 2026-11-11 手机截图）。列表高度扣掉下面那几段。
  const belowList = 90 + (agents.length ? 40 + 36 * Math.ceil(agents.length / 4) : 0);
  const listMax = Math.max(140, Math.min(430, Math.round((windowHeight || 800) * 0.62) - 140 - belowList));
  const [activeAgent, setActiveAgent] = useState<string | null>(null);

  const applyAgent = async (agent: string) => {
    if (!node || !config || !agentWritable || lock.current || !agents.includes(agent) || config.agent === agent) return;
    const requestScope = scope;
    const requestCfg = cfg;
    const live = () => scopeRef.current === requestScope;
    lock.current = true;
    setBusy(true);
    setErrorText(null);
    setErrorDetail(null);
    setNotice(null);
    try {
      const res = await updateNodeConfig(requestCfg, { nodeId: node.node_id, baseRevision: config.config_revision, patch: { agent } });
      if (!live()) return;
      if (!res.ok) { setErrorText(res.error); return; }
      // Acceptance is not application. Read only, never replay a timed-out write.
      for (let i = 0; i < 12; i++) {
        if (!live()) return;
        const after = await fetchNodeConfig(requestCfg, node.node_id);
        if (!live()) return;
        const verdict = confirmComposerAgentSwitch({ after, updateId: res.update_id, requested: agent });
        if (verdict.confirmed) {
          setConfig(after);
          readbackRef.current(after);
          setNotice(t('composerAgent.applied', { value: agent }));
          return;
        }
        const ack = after?.last_update;
        if (!res.update_id || (ack?.update_id === res.update_id && (ack.terminal || ack.status === 'applied' || ack.status === 'failed' || ack.status === 'timeout'))) {
          setErrorText(verdict.reason); return;
        }
        if (i < 11) await new Promise(resolve => setTimeout(resolve, 500));
      }
      if (live()) setErrorText('timeout');
    } catch (error) {
      if (live()) setErrorText(error instanceof Error ? error.message : String(error));
    } finally {
      lock.current = false;
      if (live()) setBusy(false);
    }
  };

  // 冲突提示说「已重新加载」，就得真的重新读：否则下次还拿旧 baseRevision，永远冲突。
  const reloadConfig = async () => {
    if (!node) return;
    const fresh = await fetchNodeConfig(cfgRef.current, node.node_id).catch(() => null);
    if (fresh) { setConfig(fresh); readbackRef.current(fresh); }
  };

  const applyModel = async (row: PaletteRow) => {
    if (!node || lock.current) return;
    if (row.key === currentKey) { closeRef.current(); return; }
    if (!config) {
      setErrorText(t('chat.modelPicker.noConfig'));
      setErrorDetail(null);
      return;
    }
    if (!availability.enabled) {
      setErrorText(availability.hint);
      setErrorDetail(null);
      return;
    }
    lock.current = true;
    setBusy(true);
    setErrorText(null);
    setErrorDetail(null);
    setNotice(null);
    try {
      const res = await updateNodeConfig(cfgRef.current, {
        nodeId: node.node_id,
        baseRevision: config.config_revision,
        patch: { model: row.key },
      });
      if (!res.ok) {
        if (res.conflict) await reloadConfig();
        setErrorText(res.conflict ? t('chat.modelPicker.conflict') : t('chat.modelPicker.failed', { message: res.error }));
        return;
      }
      // 热切换的 ACK 很快，但 model_effective 跟着下一次心跳才到：短轮询，别拿第一次读回下结论。
      let after = await fetchNodeConfig(cfgRef.current, node.node_id);
      let verdict = confirmComposerModelSwitch({ after, updateId: res.update_id, requested: row.key });
      for (let i = 0; !verdict.confirmed && i < READBACK_POLLS; i += 1) {
        await new Promise(r => setTimeout(r, READBACK_POLL_MS));
        after = await fetchNodeConfig(cfgRef.current, node.node_id);
        verdict = confirmComposerModelSwitch({ after, updateId: res.update_id, requested: row.key });
      }
      // 无论结果如何都换上最新配置：revision 已经抬高，留着旧的下次必撞冲突。
      if (after) setConfig(after);
      if (!verdict.confirmed && !verdict.ackOnly) {
        setErrorText(t('chat.modelPicker.failed', { message: t('chat.modelPicker.acceptedUnconfirmed') }));
        setErrorDetail(verdict.reason);
        return;
      }
      if (verdict.ackOnly) {
        // 没有会话级读回，footer 不能冒充 model_effective；只给明确的回执提示，不关面板。
        setNotice(t('chat.modelPicker.appliedNoReadback', { model: row.key }));
        return;
      }
      readbackRef.current(after);
      closeRef.current();
    } catch (error) {
      setErrorText(t('chat.modelPicker.failed', { message: error instanceof Error ? error.message : String(error) }));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };

  const applyVariant = async (next: string | null) => {
    if (!node || lock.current) return;
    if (!config) {
      setErrorText(t('chat.modelPicker.noConfig'));
      setErrorDetail(null);
      return;
    }
    if (!variantGate.ok) {
      setErrorText(variantGate.reason);
      setErrorDetail(null);
      return;
    }
    const effectiveModel = (config.model_effective ?? '').trim();
    if (!effectiveModel) {
      setErrorText(t('chat.modelPicker.noConfig'));
      setErrorDetail(t('chat.modelPicker.effectiveModelUnknown'));
      return;
    }
    const invalid = variantValueError(next);
    if (invalid) {
      setErrorText(t('chat.modelPicker.failed', { message: invalid }));
      return;
    }
    lock.current = true;
    setBusy(true);
    setErrorText(null);
    setErrorDetail(null);
    setNotice(null);
    try {
      const res = await updateNodeConfig(cfgRef.current, {
        nodeId: node.node_id,
        baseRevision: config.config_revision,
        patch: { model: effectiveModel, modelVariant: next },
      });
      if (!res.ok) {
        if (res.conflict) await reloadConfig();
        setErrorText(res.conflict ? t('chat.modelPicker.conflict') : t('chat.modelPicker.failed', { message: res.error }));
        return;
      }
      const after = await fetchNodeConfig(cfgRef.current, node.node_id);
      if (after) setConfig(after);
      const verdict = confirmComposerVariantSwitch({
        after,
        updateId: res.update_id,
        requestedModel: effectiveModel,
        requestedVariant: next,
      });
      if (!verdict.confirmed) {
        setErrorText(t('chat.modelPicker.failed', { message: t('chat.modelPicker.variantAcceptedUnconfirmed') }));
        setErrorDetail(t('chat.modelPicker.variantUnknownDetail', { reason: verdict.reason }));
        return;
      }
      setConfig(after);
      readbackRef.current(after);
      setNotice(t('chat.modelPicker.variantApplied', { value: next ?? t('chat.variantDefaultShort') }));
    } catch (error) {
      setErrorText(t('chat.modelPicker.failed', { message: error instanceof Error ? error.message : String(error) }));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };

  // admin 2026-11-13（营销神明等 claude-code 节点截图）：不是 OpenCode V2 的节点在聊天里切不了模型，
  // 以前照样弹出整个搜索面板，再给一段红字「不是 OpenCode V2」。现在只给一张说明卡：当前模型 + 原因，
  // 不出搜索框 / 列表 / 档位 / agent。
  if (knownNonV2) {
    return (
      <View style={styles.card} testID="composer-model-sheet">
        <View style={styles.searchBar} testID="model-palette-readonly">
          <Ionicons name="cube-outline" size={16} color={colors.textMuted} />
          <Text style={styles.searchInput} numberOfLines={1} testID="model-palette-readonly-model">
            {currentModel || t('chat.modelUnknown')}
          </Text>
          <Pressable
            testID="model-palette-close"
            accessibilityRole="button"
            accessibilityLabel={t('chat.modelPicker.close')}
            hitSlop={8}
            onPress={() => closeRef.current()}
            style={{ marginLeft: 8, padding: 2 }}
          >
            <Ionicons name="close" size={18} color={colors.textMuted} />
          </Pressable>
        </View>
        <Text style={styles.source} testID="model-palette-readonly-note">
          {t('chat.modelPicker.runtimeReadOnly', { runtime: node.runtime || t('chat.modelUnknown') })}
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.card} testID="composer-model-sheet">
      <View style={styles.searchBar}>
        <Ionicons name="search-outline" size={16} color={colors.textMuted} />
        <TextInput
          testID="model-palette-search"
          value={query}
          onChangeText={setQuery}
          placeholder={t('chat.modelPicker.search')}
          placeholderTextColor={colors.textMuted}
          accessibilityLabel={t('chat.modelPicker.searchLabel')}
          style={[styles.searchInput, Platform.OS === 'web' && ({ outlineStyle: 'none' } as object)]}
          autoCapitalize="none"
          autoCorrect={false}
          autoFocus
        />
        <Ionicons name="options-outline" size={16} color={colors.textMuted} />
        <Pressable
          testID="model-palette-close"
          accessibilityRole="button"
          accessibilityLabel={t('chat.modelPicker.close')}
          hitSlop={8}
          onPress={() => closeRef.current()}
          style={{ marginLeft: 8, padding: 2 }}
        >
          <Ionicons name="close" size={18} color={colors.textMuted} />
        </Pressable>
      </View>

      {busy ? (
        <View style={styles.statusRow} testID="model-palette-busy">
          <ActivityIndicator size="small" color={colors.accent} />
          <Text style={styles.statusText}>{t('chat.modelPicker.switching')}</Text>
        </View>
      ) : null}

      {view.status === 'error' ? (
        <View style={styles.errorBox} testID="model-palette-error">
          <Text style={styles.errorText}>{view.errorText}</Text>
        </View>
      ) : view.status === 'loading' ? (
        <View style={styles.statusRow} testID="model-palette-loading">
          <ActivityIndicator size="small" color={colors.textMuted} />
          <Text style={styles.statusText}>{t('chat.modelPicker.loading')}</Text>
        </View>
      ) : view.total === 0 ? (
        <View style={styles.emptyBox} testID="model-palette-empty">
          <Text style={styles.emptyTitle}>
            {view.catalogTotal === 0 ? t('chat.modelPicker.catalogEmpty') : t('chat.modelPicker.empty')}
          </Text>
          {view.catalogTotal === 0 ? null : <Text style={styles.emptyHint}>{t('chat.modelPicker.emptyHint')}</Text>}
        </View>
      ) : (
        <ScrollView
          style={{ maxHeight: listMax }}
          keyboardShouldPersistTaps="handled"
          nestedScrollEnabled
          showsVerticalScrollIndicator
          testID="model-palette-list"
        >
          {view.groups.map(group => (
            <View key={group.provider} style={styles.group}>
              <View style={styles.groupHeader}>
                <Text style={styles.groupName} numberOfLines={1} testID={`model-palette-group-${group.provider}`}>{group.provider}</Text>
                <Text style={styles.groupCount} testID={`model-palette-group-count-${group.provider}`}>{group.count}</Text>
              </View>
              {group.rows.map(row => (
                <Pressable
                  key={row.key}
                  testID={`model-palette-row-${row.key}`}
                  accessibilityRole="button"
                  accessibilityState={{ selected: row.current }}
                  accessibilityLabel={t('chat.modelPicker.modelA11y', { value: row.key })}
                  disabled={busy}
                  onPress={() => void applyModel(row)}
                  style={({ pressed }) => [
                    styles.row,
                    row.current && styles.rowCurrent,
                    pressed && { opacity: 0.7 },
                  ]}
                >
                  <Text style={styles.rowLabel} numberOfLines={1}>{row.id}</Text>
                  {row.current ? (
                    <Ionicons name="checkmark" size={18} color={colors.textSecondary} testID={`model-palette-check-${row.key}`} />
                  ) : null}
                </Pressable>
              ))}
            </View>
          ))}
        </ScrollView>
      )}

      {view.status === 'ready' && view.catalogTotal > 0 ? (
        <Text style={styles.source} testID="model-palette-source">{catalogNote ?? t('chat.modelPicker.catalogSource')}</Text>
      ) : null}

      {notice ? <Text style={styles.notice} testID="model-palette-applied">{notice}</Text> : null}

      {config !== undefined ? (
        <View style={styles.variantRow} testID="node-variant-row">
          <Text style={styles.variantTitle}>{t('chat.modelPicker.variantTitle')}</Text>
          {!variantGate.ok ? (
            <Text style={styles.variantNote} testID="node-variant-disabled">{variantGate.reason}</Text>
          ) : choices.kind === 'unknown' ? (
            <Text style={styles.variantNote} testID="node-variant-unknown">{t('chat.modelPicker.variantUnknown', { value: currentVariant ?? t('chat.variantDefaultShort') })}</Text>
          ) : choices.kind === 'none' ? (
            <Text style={styles.variantNote} testID="node-variant-none">{t('chat.modelPicker.variantNone')}</Text>
          ) : (
            <>
              <Pressable
                key="__default"
                testID="node-variant-chip-default"
                disabled={busy || !variantGate.ok || currentVariant === null}
                onPress={() => void applyVariant(null)}
                style={({ pressed }) => [styles.variantChip, currentVariant === null && styles.variantChipOn, pressed && { opacity: 0.7 }]}
              >
                <Text style={[styles.variantChipText, currentVariant === null && { color: colors.accent }]}>{t('chat.variantDefaultShort')}{currentVariant === null ? `（${t('chat.modelPicker.currentMark')}）` : ''}</Text>
              </Pressable>
              {choices.options.map(value => {
                const selected = value === currentVariant;
                return (
                  <Pressable
                    key={value}
                    testID={`node-variant-chip-${value}`}
                    disabled={busy || !variantGate.ok}
                    onPress={() => void applyVariant(selected ? null : value)}
                    style={({ pressed }) => [styles.variantChip, selected && styles.variantChipOn, pressed && { opacity: 0.7 }]}
                  >
                    <Text style={[styles.variantChipText, selected && { color: colors.accent }]}>{value}{selected ? `（${t('chat.modelPicker.currentMark')}）` : ''}</Text>
                  </Pressable>
                );
              })}
              {currentVariant ? (
                <Pressable testID="node-variant-clear" disabled={busy || !variantGate.ok} onPress={() => void applyVariant(null)}>
                  <Text style={styles.variantClear}>{t('chat.modelPicker.clearVariant')}</Text>
                </Pressable>
              ) : null}
            </>
          )}
        </View>
      ) : null}

      {showAgentSection ? (
        <View testID="composer-agent-section" style={styles.variantRow}>
          <Text style={styles.variantTitle}>{t('composerAgent.title')}</Text>
          {currentAgent === undefined ? <Text testID="composer-agent-unknown" style={styles.variantNote}>{t('composerAgent.unknown')}</Text> : null}
          {!agentWritable ? (
            <Text testID="composer-agent-readonly" style={styles.variantNote}>{t('composerAgent.readOnly', { value: currentAgent ?? t('composerAgent.unknownShort') })}</Text>
          ) : null}
          {agentWritable ? <View style={styles.agentChips} testID="composer-agent-list"
            {...(Platform.OS === 'web' ? { onKeyDown: (event: { key: string; preventDefault: () => void }) => {
              if (event.key === 'Escape') { event.preventDefault(); closeRef.current(); return; }
              if (busy) return;
              if (event.key === 'Enter') { event.preventDefault(); if (activeAgent) void applyAgent(activeAgent); return; }
              if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
              event.preventDefault();
              const index = agents.indexOf(activeAgent ?? config?.agent ?? '');
              const next = agents[(index + (event.key === 'ArrowDown' ? 1 : -1) + agents.length) % agents.length];
              setActiveAgent(next);
              if (typeof document !== 'undefined') {
                const el = document.querySelector<HTMLElement>(`[data-testid="composer-agent-row-${encodeURIComponent(next)}"]`);
                el?.focus(); el?.scrollIntoView({ block: 'nearest' });
              }
            } } : {})}>
            {agents.map(agent => <Pressable key={agent} testID={`composer-agent-row-${encodeURIComponent(agent)}`} accessibilityRole="button"
              accessibilityLabel={agent} accessibilityState={{ selected: config?.agent === agent, disabled: busy }} disabled={busy}
              onFocus={() => setActiveAgent(agent)} onPress={() => void applyAgent(agent)}
              style={[styles.variantChip, styles.agentChip, config?.agent === agent && styles.variantChipOn, activeAgent === agent && config?.agent !== agent && styles.rowCurrent]}>
              <Text style={[styles.variantChipText, config?.agent === agent && { color: colors.accent }]} numberOfLines={1}>{agent}</Text>
              {config?.agent === agent ? <Ionicons testID={`composer-agent-check-${encodeURIComponent(agent)}`} name="checkmark" size={12} color={colors.accent} /> : null}
            </Pressable>)}
          </View> : null}
        </View>
      ) : null}

      {errorText ? (
        <View style={styles.errorBox} testID="model-palette-action-error">
          <Text style={styles.errorText}>{errorText}</Text>
          {errorDetail ? <Text style={styles.errorDetail} testID="model-palette-error-detail">{errorDetail}</Text> : null}
        </View>
      ) : null}
    </View>
  );
}

const makeStyles = () => ({
  card: {
    width: '100%' as const,
    maxWidth: 560,
    alignSelf: 'center' as const,
    padding: 8,
    borderRadius: radius.surface,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    elevation: 12,
    shadowColor: '#000',
    shadowOpacity: 0.16,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 6 },
  },
  searchBar: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 8,
    height: 40,
    paddingHorizontal: 10,
    borderRadius: radius.control,
    backgroundColor: colors.inputBg,
  },
  searchInput: { flex: 1, fontSize: ds(13), color: colors.text, paddingVertical: 0 },
  statusRow: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 8, padding: 12 },
  statusText: { fontSize: ds(12), color: colors.textMuted },
  group: { paddingTop: 10 },
  groupHeader: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 8, paddingHorizontal: 10, paddingVertical: 6 },
  groupName: { fontSize: ds(12), color: colors.textMuted, maxWidth: '80%' as const },
  groupCount: { fontSize: ds(12), color: colors.textMuted },
  row: {
    minHeight: 38,
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'space-between' as const,
    paddingHorizontal: 10,
    borderRadius: radius.item,
  },
  rowCurrent: { backgroundColor: colors.inputBg },
  rowLabel: { fontSize: ds(14), color: colors.text, flexShrink: 1 },
  emptyBox: { paddingHorizontal: 12, paddingVertical: 18, gap: 6 },
  emptyTitle: { fontSize: ds(13), color: colors.text },
  emptyHint: { fontSize: ds(12), color: colors.textMuted, lineHeight: 18 },
  source: { fontSize: ds(11), color: colors.textMuted, paddingHorizontal: 10, paddingTop: 8, paddingBottom: 2 },
  variantRow: { flexDirection: 'row' as const, alignItems: 'center' as const, flexWrap: 'wrap' as const, gap: 6, paddingHorizontal: 10, paddingTop: 8, borderTopWidth: 1, borderTopColor: colors.border, marginTop: 6 },
  variantTitle: { fontSize: ds(11), color: colors.textMuted, marginRight: 2 },
  variantChip: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border },
  variantChipOn: { borderColor: colors.accent },
  variantChipText: { fontSize: ds(11), color: colors.text },
  variantClear: { fontSize: ds(11), color: colors.textMuted },
  variantNote: { fontSize: ds(11), color: colors.textMuted, flexShrink: 1 },
  agentChips: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: 6, width: '100%' as const, paddingTop: 2 },
  agentChip: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 4 },
  errorBox: { marginTop: 8, paddingHorizontal: 10, paddingVertical: 8, borderRadius: radius.item, backgroundColor: colors.inputBg, gap: 4 },
  errorText: { fontSize: ds(12), color: colors.failed, lineHeight: 18 },
  errorDetail: { fontSize: ds(11), color: colors.textMuted, lineHeight: 16 },
  notice: { fontSize: ds(11), color: colors.running, paddingHorizontal: 10, paddingTop: 6 },
});
