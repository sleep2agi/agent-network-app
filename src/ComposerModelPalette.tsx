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
  type OpenCodeCatalogPoll,
} from './api';
import { catalogErrorText, isOpenCodeV2Node, mergeReportedVariants, peerCatalogWithVariants, reportedCatalogWithVariants } from './opencode-v2-model-list';
import {
  acpModelChoices,
  acpModelErrorText,
  classifyAcpSaveOutcome,
  filterAndGroupAgyModels,
  isAcpModelRuntime,
  isAgyRuntime,
  normalizeAcpModelId,
} from './acp-model-edit';
import { nodeProviderDaemon } from './node-provider-target';
import { modelControlAvailability } from './node-model-change';
import { buildConfigPatch, variantAfterModelSwitch, variantValueError, variantWritable } from './node-variant-patch';
import { composerVariantLabel } from './composer-model-label';
import { composerAgentCurrent, composerAgentSectionVisible, composerAgentSwitchable, composerAgents, confirmComposerAgentSwitch } from './composer-agent';
import './i18n-composer-agent';
import {
  confirmComposerModelSwitch,
  composerModelSwitchUnsupported,
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
  onOpenModelSettings?: () => void;
}

const CATALOG_POLL_MS = 1000;
const CATALOG_MAX_POLLS = 15;
// #4976 —— 单次排队 / 单次轮询各自的上限。轮询本身最多 15 秒，这两个兜住「请求发出去
// 但对端不返回 / 网络挂住」的情况：到点按 unavailable 落终态，而不是永远 loading。
const CATALOG_QUEUE_TIMEOUT_MS = 8000;
const CATALOG_POLL_TIMEOUT_MS = 6000;

/** 超时或异常都返回 null（调用方统一落 unavailable），成功才给回真实结果。 */
async function raceCatalogTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<null>(resolve => { timer = setTimeout(() => resolve(null), ms); }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
/** 写后读回：心跳间隔内等 model_effective（约 6s）。 */
const READBACK_POLLS = 4;
const READBACK_POLL_MS = 1500;
// #4823 review（负责人）：ACK applied 但 variant 未回填时，UI 不能停在「等待」不管。
// 每 30 秒重读一次，最多 60 分钟；读到目标值→已确认，读到别的值→不一致，超时→提示可刷新。
const VARIANT_CONFIRM_POLL_MS = 30_000;
const VARIANT_CONFIRM_MAX_MS = 60 * 60 * 1000;

const INTERNAL_AGENTS = new Set(['compaction', 'title', 'summary']);

export default function ComposerModelPalette({ cfg, node, targetError, currentModel, currentVariant, onReadback, onClose, onOpenModelSettings }: Props) {
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
  // #4976 —— 终态是错误时必须能重来一次（超时/节点暂时没回），不要求用户关掉面板重开。
  const [catalogAttempt, setCatalogAttempt] = useState(0);
  // 2026-11-21 admin：ACP runtime 没有目录可读，改为「输入模型 id + 写节点配置」。
  const [acpDraft, setAcpDraft] = useState('');
  const [acpSaving, setAcpSaving] = useState(false);
  const [acpNotice, setAcpNotice] = useState<string | null>(null);
  const [acpError, setAcpError] = useState<string | null>(null);
  const [acpPrefilled, setAcpPrefilled] = useState(false);
  const [agyCustomOpen, setAgyCustomOpen] = useState(false);
  // #4976 跟进：loading 超过 4 秒就换成「还剩多少秒会出结果」，别让人对着同一句话干等。
  const [loadingElapsedSec, setLoadingElapsedSec] = useState(0);
  useEffect(() => {
    if (!catalog.loading) { setLoadingElapsedSec(0); return; }
    const started = Date.now();
    const timer = setInterval(() => setLoadingElapsedSec(Math.floor((Date.now() - started) / 1000)), 1000);
    return () => clearInterval(timer);
  }, [catalog.loading, catalogAttempt]);
  // undefined = 正在读；null = Hub 没这个接口/读失败；对象 = 真实读回。
  const [config, setConfig] = useState<NodeConfigRead | null | undefined>(undefined);
  // ACP 面板：非 agy（无目录手输）配置读到后把当前模型填进输入框（只填一次，别覆盖用户正在改的内容）。
  useEffect(() => {
    if (acpPrefilled || config === undefined) return;
    if (!isAgyRuntime(node?.runtime)) {
      const current = (config?.model ?? '').trim();
      if (current) setAcpDraft(current);
    }
    setAcpPrefilled(true);
  }, [config, acpPrefilled, node?.runtime]);
  const [busy, setBusy] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [modelSwitchUnsupported, setModelSwitchUnsupported] = useState(false);
  const [errorDetail, setErrorDetail] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // 正在等节点回填档位的那次切换（panel 关闭/切节点时随之丢弃，不跨面板残留）。
  const [pendingVariant, setPendingVariant] = useState<{ nodeId: string; updateId?: string; model: string; variant: string; startedAt: number } | null>(null);
  // 超时后进入「无法确认」：给一个显式的「重新读取」入口，不写成失败。
  const [variantUnconfirmed, setVariantUnconfirmed] = useState(false);
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
      // #4976 —— 面板不允许「永久转圈」：排队和每一次轮询都套一层超时，异常也归到
      // 可读终态（节点清单没有 → unavailable 原因 + 重试入口），别让 UI 停在 loading。
      let queued: OpenCodeCatalogPoll | null = null;
      try {
        queued = await raceCatalogTimeout(queueOpenCodeCatalog(cfgRef.current, { nodeId: node.node_id, daemonNodeId }), CATALOG_QUEUE_TIMEOUT_MS);
      } catch { queued = null; }
      if (!live) return;
      if (!queued) { failWith('unavailable'); return; }
      if (!queued.ok) { failWith(queued.error); return; }
      for (let i = 0; i < CATALOG_MAX_POLLS; i++) {
        await new Promise(resolve => setTimeout(resolve, CATALOG_POLL_MS));
        if (!live) return;
        let polled: OpenCodeCatalogPoll | null = null;
        try {
          polled = await raceCatalogTimeout(pollOpenCodeCatalog(cfgRef.current, queued.request_id), CATALOG_POLL_TIMEOUT_MS);
        } catch { polled = null; }
        if (!live) return;
        if (!polled) { failWith('unavailable'); return; }
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
  }, [catalogAttempt, node?.node_id, node?.runtime, node?.lifecycle_daemon_node_id, node?.adoption?.status, node?.adoption?.daemon_node_id, (node?.opencode_catalog ?? []).join('|'), (node?.opencode_catalog_variants ?? []).join('|'), cfg.serverUrl, cfg.networkId, cfg.profileId, cfg.token]);

  const view = paletteView({
    snapshot: catalog.snapshot,
    query,
    currentModel,
    loading: catalog.loading && !targetError,
    error: targetError ?? catalog.error,
  });
  // 上限口径：排队 8s + 单次轮询 6s（见 CATALOG_QUEUE_TIMEOUT_MS / CATALOG_POLL_TIMEOUT_MS）+ 1s 余量。
  const loadingSlow = catalog.loading && loadingElapsedSec >= 4;
  const loadingRemainingSec = Math.max(0, 15 - loadingElapsedSec);
  const catalogModels = useMemo(() => paletteCatalogModels(catalog.snapshot), [catalog.snapshot]);
  const currentKey = paletteCurrentKey(currentModel, catalogModels);
  const choices = paletteVariantChoices(catalog.snapshot, currentKey);
  const v2 = !!node && isOpenCodeV2Node(node);
  // #1428 审阅意见（通信客户端欧 2026-11-13）：只在**明确不是 V2** 时才锁成只读卡。
  // 「未知」不是「不支持」—— 老 Hub / 字段没读到时 runtime 可能为空，那时 `!v2` 成立，
  // 但那是「没读到」，不该按「明确不是 OpenCode V2」处理（会把这个节点整个面板锁死）。
  // 明确证据只有两种：代际字段说 v1；或者 runtime 有值且确实不在 OpenCode 名单里。
  const generation = node?.opencode_generation ?? node?.config_snapshot?.flags?.opencodeGeneration;
  // 2026-11-21：ACP runtime（grok/agy）没有目录，但**可以在 App 里设模型**（输入 + 写节点配置），
  // 所以不能按「非 V2」锁成只读卡 —— 那是 admin 截图里「选不了模型」的直接原因。
  const acpRuntime = !!node && isAcpModelRuntime(node.runtime);
  const knownNonV2 = !!node && !acpRuntime && (generation === 'v1' || (!!node.runtime && !v2));
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
    setModelSwitchUnsupported(false);
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
    setModelSwitchUnsupported(false);
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
        // 同样走契约 helper：model-only 补丁 = 省略 modelVariant（不改档）。
        patch: buildConfigPatch({ model: row.key }),
      });
      if (!res.ok) {
        if (res.conflict) await reloadConfig();
        if (v2 && !res.conflict && composerModelSwitchUnsupported(res.error)) {
          setModelSwitchUnsupported(true);
          return;
        }
        setErrorText(res.conflict ? t('chat.modelPicker.conflict') : t('chat.modelPicker.failed', { message: res.error }));
        return;
      }
      // 热切换的 ACK 很快，但 model_effective 跟着下一次心跳才到：短轮询，别拿第一次读回下结论。
      let after = await fetchNodeConfig(cfgRef.current, node.node_id);
      let verdict = confirmComposerModelSwitch({ after, updateId: res.update_id, requested: row.key });
      const rejected = () => v2 && composerModelSwitchUnsupported(null, { updateId: res.update_id, last: after?.last_update });
      for (let i = 0; !verdict.confirmed && !rejected() && i < READBACK_POLLS; i += 1) {
        await new Promise(r => setTimeout(r, READBACK_POLL_MS));
        after = await fetchNodeConfig(cfgRef.current, node.node_id);
        verdict = confirmComposerModelSwitch({ after, updateId: res.update_id, requested: row.key });
      }
      // 无论结果如何都换上最新配置：revision 已经抬高，留着旧的下次必撞冲突。
      if (after) setConfig(after);
      if (rejected()) {
        setModelSwitchUnsupported(true);
        return;
      }
      if (!verdict.confirmed && res.update_id && after?.last_update?.update_id === res.update_id
          && after.last_update.status === 'restarting') {
        setNotice(t('chat.modelPicker.switchRestarting'));
        return;
      }
      if (!verdict.confirmed && !verdict.ackOnly) {
        setErrorText(t('chat.modelPicker.failed', { message: t('chat.modelPicker.acceptedUnconfirmed') }));
        setErrorDetail(verdict.reason);
        return;
      }
      // #4822/#4823：档位是独立字段；换模型**不自动清除**档位（省略=不改），也不把“未知”当默认。
      // 若原档位在新模型上不成立，就如实提示重选（不静默写 modelVariant:null）。
      const carry = variantAfterModelSwitch({
        previousModel: currentKey,
        nextModel: row.key,
        currentVariant,
        nextModelVariants: row.choices.kind === 'unknown' ? undefined : row.choices.kind === 'none' ? [] : row.choices.options,
      });
      // #4823 review —— 顺序很重要：ackOnly 的意思是「只收到 ACK、没读回到新模型」，
      // 这时连「模型已切换」都不能断言。所以 ackOnly 必须先判，再谈档位要不要重选。
      if (verdict.ackOnly) {
        // 没有会话级读回，footer 不能冒充 model_effective；只给明确的回执提示，不关面板。
        setNotice(t('chat.modelPicker.appliedNoReadback', { model: row.key }));
        return;
      }
      if (carry.action === 'must-reselect') {
        // 提示里只说「为什么要重选」，不展示 helper 的 reason 原文（那是开发判据，且中文会插进英文界面）。
        setNotice(t(`chat.modelPicker.variantNeedsReselect.${carry.code}`));
        readbackRef.current(after);
        return;   // 不关面板：让用户当场重选深度
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
    setModelSwitchUnsupported(false);
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
        // 走契约 helper：null=清除 / 省略=不改 的语义只有一处定义，避免生产代码另拼一份。
        // #4823 —— **只发档位，不带 model**：这里只是换档位，模型没变。
        //   daemon 侧 writeStock 判的是 `patch.model !== undefined`（key 在不在，不是值变没变），
        //   所以固定带上当前 model 会让「单改档位」在**旧 agent-node** 上被拒 unsupported。
        //   客户端不知道对面 agent-node 版本 ⇒ 发最小补丁在任何版本都安全。
        patch: buildConfigPatch({ modelVariant: next }),
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
        // #4823（负责人 2026-11-19）：ACK 已 applied 但节点还没回填 variant ⇒ 显示「已下发，等待节点确认」，
        // 不当失败。生产实测回填可能延迟到几十分钟（模型字段是即时的）。
        if (verdict.pending) {
          setErrorText(null);
          setErrorDetail(null);
          setNotice(t('chat.modelPicker.variantPending', { value: next ?? t('chat.variantDefaultShort') }));
          // 进入「等节点确认」：由下面的 effect 持续轮询，直到确认 / 不一致 / 超时。
          if (next) {
            setVariantUnconfirmed(false);
          setPendingVariant({ nodeId: node.node_id, updateId: res.update_id, model: effectiveModel, variant: next, startedAt: Date.now() });
          }
          return;
        }
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

  // #4823 review（负责人）：pending 不能永远挂着。每 30s 重读一次，最多 60 分钟；
  // 面板关闭（组件卸载）或切节点时停掉，绝不跨会话继续轮询。
  useEffect(() => {
    if (!pendingVariant) return;
    if (!node || node.node_id !== pendingVariant.nodeId) { setPendingVariant(null); return; }
    let alive = true;
    const tick = async () => {
      if (!alive) return;
      if (Date.now() - pendingVariant.startedAt > VARIANT_CONFIRM_MAX_MS) {
        setPendingVariant(null);
        setErrorText(null);
        setErrorDetail(null);
        // review（负责人）：超时不是失败 —— 显示「无法确认（节点未回读）」，面板里仍有重新读取入口。
        setNotice(t('chat.modelPicker.variantPendingTimeout'));
        setVariantUnconfirmed(true);
        return;
      }
      try {
        const after = await fetchNodeConfig(cfgRef.current, pendingVariant.nodeId);
        if (!alive || !after) return;
        setConfig(after);
        const verdict = confirmComposerVariantSwitch({
          after,
          updateId: pendingVariant.updateId,
          requestedModel: pendingVariant.model,
          requestedVariant: pendingVariant.variant,
        });
        if (verdict.confirmed) {
          setPendingVariant(null);
          setVariantUnconfirmed(false);
          setErrorText(null);
          setErrorDetail(null);
          readbackRef.current(after);
          setNotice(t('chat.modelPicker.variantApplied', { value: pendingVariant.variant }));
          return;
        }
        if (!verdict.pending) {
          // 回填了但值不对 —— 这是真失败，不再继续等。
          setPendingVariant(null);
          setNotice(null);
          setErrorText(t('chat.modelPicker.failed', { message: t('chat.modelPicker.variantAcceptedUnconfirmed') }));
          setErrorDetail(t('chat.modelPicker.variantUnknownDetail', { reason: verdict.reason }));
        }
      } catch { /* 网络抖动不算失败：等下一次 tick */ }
    };
    const timer = setInterval(() => { void tick(); }, VARIANT_CONFIRM_POLL_MS);
    return () => { alive = false; clearInterval(timer); };
  }, [pendingVariant, node?.node_id]);

  // admin 2026-11-13（营销神明等 claude-code 节点截图）：不是 OpenCode V2 的节点在聊天里切不了模型，
  // 以前照样弹出整个搜索面板，再给一段红字「不是 OpenCode V2」。现在只给一张说明卡：当前模型 + 原因，
  // 不出搜索框 / 列表 / 档位 / agent。
  if (acpRuntime) {
    const agyRuntime = isAgyRuntime(node?.runtime);
    const agyHotCapable = config?.agy_hot_model_capable === true || node?.agy_hot_model_capable === true;
    const acpChoices = acpModelChoices({ runtime: node?.runtime, agyModels: node?.agy_models });
    const configuredModel = (config?.model ?? '').trim();
    const activeAcpModel = (configuredModel || currentModel || '').trim();
    const saveAcpModel = async (explicitModel?: string, opts?: { closeOnHotApplied?: boolean }) => {
      if (!node || acpSaving) return;
      const checked = normalizeAcpModelId(explicitModel ?? acpDraft);
      if (!checked.ok) { setAcpError(acpModelErrorText(checked.error)); return; }
      if (explicitModel !== undefined && checked.value === activeAcpModel && (!currentModel || checked.value === currentModel.trim())) {
        closeRef.current();
        return;
      }
      setAcpSaving(true);
      setAcpError(null);
      setAcpNotice(null);
      try {
        let activeConfig = config ?? null;
        if (!activeConfig) {
          activeConfig = await fetchNodeConfig(cfgRef.current, node.node_id).catch(() => null);
          if (activeConfig) { setConfig(activeConfig); readbackRef.current(activeConfig); }
        }
        if (!activeConfig) {
          setAcpError(t('chat.modelPicker.noConfig'));
          return;
        }
        const baseRevision = activeConfig.config_revision;
        const res = await updateNodeConfig(cfgRef.current, {
          nodeId: node.node_id,
          baseRevision,
          patch: buildConfigPatch({ model: checked.value }),
        });
        if (!res.ok) {
          if (res.conflict) {
            await reloadConfig();
            setAcpError(t('chat.modelPicker.conflict'));
            return;
          }
          setAcpError(t('chat.modelPicker.failed', { message: res.error }));
          return;
        }
        const effectiveApplyMode = res.apply_mode ?? (agyRuntime && agyHotCapable ? 'hot' : 'restart');
        const expectHot = effectiveApplyMode === 'hot';
        const pollDelays = expectHot ? [300, 600, 900, 1200] : [200];
        let after: NodeConfigRead | null = null;
        let outcome = classifyAcpSaveOutcome({
          applyMode: effectiveApplyMode,
          after: null,
          updateId: res.update_id,
          requested: checked.value,
          baseRevision,
        });
        for (let i = 0; i < pollDelays.length; i += 1) {
          await new Promise(resolve => setTimeout(resolve, pollDelays[i]));
          after = await fetchNodeConfig(cfgRef.current, node.node_id).catch(() => null);
          outcome = classifyAcpSaveOutcome({
            applyMode: effectiveApplyMode,
            after,
            updateId: res.update_id,
            requested: checked.value,
            baseRevision,
          });
          if (outcome.kind === 'applied' || outcome.kind === 'failed') break;
        }
        // 无论终局如何都换上最新配置：revision 已抬高，留旧值下次必撞 revision_conflict。
        if (after) {
          setConfig(after);
          readbackRef.current(after);
        }
        if (outcome.kind === 'failed') {
          setAcpError(t('chat.modelPicker.failed', { message: outcome.reason }));
          return;
        }
        if (outcome.kind === 'applied') {
          setAcpDraft('');
          if (outcome.hot) {
            setAcpNotice(t('chat.modelPicker.acpHotApplied', { value: checked.value }));
            if (opts?.closeOnHotApplied) { closeRef.current(); return; }
          } else {
            setAcpNotice(t('chat.modelPicker.acpSaved', { value: checked.value }));
          }
          return;
        }
        setAcpDraft('');
        setAcpNotice(t('chat.modelPicker.acpRestarting', { value: checked.value }));
      } catch (e) {
        setAcpError(t('chat.modelPicker.failed', { message: e instanceof Error ? e.message : String(e) }));
      } finally {
        setAcpSaving(false);
      }
    };

    const draftTrim = acpDraft.trim();
    if (agyRuntime) {
      const agyView = filterAndGroupAgyModels({
        models: acpChoices.models,
        query,
        currentModel: activeAcpModel,
      });
      const unlistedCustom = draftTrim.length > 0 && !acpChoices.models.includes(draftTrim);
      const sourceText = acpChoices.source === 'reported'
        ? t('chat.modelPicker.agySourceReported', { count: acpChoices.models.length })
        : t('chat.modelPicker.agySourceFallback', { count: acpChoices.models.length });
      const modeText = agyHotCapable ? t('chat.modelPicker.agyModeHot') : t('chat.modelPicker.agyModeRestart');
      const configDiffers = !!configuredModel && !!currentModel && configuredModel !== currentModel.trim();
      return (
        <View style={styles.card} testID="composer-model-sheet">
          <View style={styles.searchBar} testID="model-palette-acp">
            <Ionicons name="search-outline" size={16} color={colors.textMuted} />
            <TextInput
              testID="model-palette-agy-search"
              value={query}
              onChangeText={text => { setQuery(text); setAcpError(null); }}
              placeholder={t('chat.modelPicker.search')}
              placeholderTextColor={colors.textMuted}
              accessibilityLabel={t('chat.modelPicker.searchLabel')}
              style={[styles.searchInput, Platform.OS === 'web' && ({ outlineStyle: 'none' } as object)]}
              autoCapitalize="none"
              autoCorrect={false}
              autoFocus
            />
            {query ? (
              <Pressable
                testID="model-palette-search-clear"
                accessibilityRole="button"
                hitSlop={6}
                onPress={() => setQuery('')}
                style={{ padding: 2 }}
              >
                <Ionicons name="close-circle" size={16} color={colors.textMuted} />
              </Pressable>
            ) : null}
            <Pressable
              testID="model-palette-close"
              accessibilityRole="button"
              accessibilityLabel={t('chat.modelPicker.close')}
              hitSlop={8}
              onPress={() => closeRef.current()}
              style={{ marginLeft: 4, padding: 2 }}
            >
              <Ionicons name="close" size={18} color={colors.textMuted} />
            </Pressable>
          </View>

          {acpSaving ? (
            <View style={styles.statusRow} testID="model-palette-busy">
              <ActivityIndicator size="small" color={colors.accent} />
              <Text style={styles.statusText}>{t('chat.modelPicker.switching')}</Text>
            </View>
          ) : null}

          {agyView.total === 0 ? (
            <View style={styles.emptyBox} testID="model-palette-empty">
              <Text style={styles.emptyTitle}>{t('chat.modelPicker.empty')}</Text>
              <Text style={styles.emptyHint}>{t('chat.modelPicker.agyEmptyHint')}</Text>
            </View>
          ) : (
            <ScrollView
              style={{ maxHeight: listMax }}
              keyboardShouldPersistTaps="handled"
              nestedScrollEnabled
              showsVerticalScrollIndicator
              testID="model-palette-list"
            >
              {agyView.groups.map(group => (
                <View key={group.group} style={styles.group}>
                  <View style={styles.groupHeader}>
                    <Text style={styles.groupName} numberOfLines={1} testID={`model-palette-group-${group.group}`}>{group.group}</Text>
                    <Text style={styles.groupCount} testID={`model-palette-group-count-${group.group}`}>{group.count}</Text>
                  </View>
                  {group.rows.map(row => (
                    <Pressable
                      key={row.id}
                      testID={`model-palette-acp-suggest-${row.id}`}
                      accessibilityRole="button"
                      accessibilityState={{ selected: row.current, disabled: acpSaving }}
                      accessibilityLabel={t('chat.modelPicker.modelA11y', { value: row.id })}
                      disabled={acpSaving}
                      onPress={() => { void saveAcpModel(row.id, { closeOnHotApplied: true }); }}
                      style={({ pressed }) => [
                        styles.row,
                        row.current && styles.rowCurrent,
                        pressed && { opacity: 0.7 },
                      ]}
                    >
                      <View style={styles.agyRowMain}>
                        <View style={styles.agyRowTitleLine}>
                          <Text style={styles.rowLabel} numberOfLines={1}>{row.label}</Text>
                          {row.level ? (
                            <View style={[styles.agyLevelPill, row.current && styles.agyLevelPillCurrent]}>
                              <Text style={[styles.agyLevelText, row.current && { color: colors.accent }]}>{row.level}</Text>
                            </View>
                          ) : null}
                        </View>
                        {row.label !== row.id ? (
                          <Text style={styles.agyRowSlug} numberOfLines={1}>{row.id}</Text>
                        ) : null}
                      </View>
                      {row.current ? (
                        <Ionicons name="checkmark" size={18} color={colors.accent} testID={`model-palette-check-${row.id}`} />
                      ) : null}
                    </Pressable>
                  ))}
                </View>
              ))}
            </ScrollView>
          )}

          <Text style={styles.source} testID="model-palette-source">
            {`${sourceText} · ${modeText}`}
          </Text>
          {configDiffers ? (
            <Text style={styles.source} testID="model-palette-acp-configured">
              {t('chat.modelPicker.acpConfigured', { value: configuredModel })}
            </Text>
          ) : null}

          <View style={styles.agyCustomSection}>
            <Pressable
              testID="model-palette-agy-custom-toggle"
              accessibilityRole="button"
              onPress={() => setAgyCustomOpen(v => !v)}
              style={styles.agyCustomToggle}
            >
              <Text style={styles.agyCustomToggleText}>{t('chat.modelPicker.agyCustomToggle')}</Text>
              <Ionicons name={agyCustomOpen ? 'chevron-up' : 'chevron-down'} size={14} color={colors.textMuted} />
            </Pressable>
            {agyCustomOpen ? (
              <View style={styles.agyCustomBody}>
                <TextInput
                  testID="model-palette-acp-input"
                  value={acpDraft}
                  onChangeText={text => { setAcpDraft(text); setAcpError(null); setAcpNotice(null); }}
                  placeholder={activeAcpModel || 'claude-opus-5-5-high'}
                  placeholderTextColor={colors.textMuted}
                  autoCapitalize="none"
                  autoCorrect={false}
                  style={styles.acpInput}
                />
                {unlistedCustom ? (
                  <Text style={styles.agyCustomWarn} testID="model-palette-agy-custom-warn">
                    {t('chat.modelPicker.agyCustomUnlisted', { value: draftTrim })}
                  </Text>
                ) : null}
                <Pressable
                  testID="model-palette-acp-save"
                  accessibilityRole="button"
                  accessibilityState={{ busy: acpSaving, disabled: acpSaving || !draftTrim }}
                  disabled={acpSaving || !draftTrim}
                  onPress={() => { void saveAcpModel(acpDraft, { closeOnHotApplied: true }); }}
                  style={[styles.acpSave, (!draftTrim || acpSaving) && { opacity: 0.55 }]}
                >
                  <Text style={styles.acpSaveText}>{acpSaving ? t('chat.modelPicker.acpSaving') : t('chat.modelPicker.acpSave')}</Text>
                </Pressable>
              </View>
            ) : null}
          </View>

          {acpError ? (
            <View style={styles.errorBox} testID="model-palette-acp-error">
              <Text style={styles.errorText}>{acpError}</Text>
            </View>
          ) : null}
          {acpNotice ? <Text style={styles.notice} testID="model-palette-acp-notice">{acpNotice}</Text> : null}
        </View>
      );
    }

    return (
      <View style={styles.card} testID="composer-model-sheet">
        <View style={styles.searchBar} testID="model-palette-acp">
          <Ionicons name="cube-outline" size={16} color={colors.textMuted} />
          <Text style={styles.searchInput} numberOfLines={1} testID="model-palette-acp-current">
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
        <Text style={styles.source} testID="model-palette-acp-note">
          {t('chat.modelPicker.acpHint', { runtime: node?.runtime || t('chat.modelUnknown') })}
        </Text>
        {/* 配置值 vs 运行时上报值分开写：写进去但还没重启时，两个值会不一样，别让人误会保存没生效。 */}
        <Text style={styles.source} testID="model-palette-acp-configured">
          {t('chat.modelPicker.acpConfigured', { value: configuredModel || t('chat.modelUnknown') })}
        </Text>
        <TextInput
          testID="model-palette-acp-input"
          value={acpDraft}
          onChangeText={text => { setAcpDraft(text); setAcpError(null); setAcpNotice(null); }}
          placeholder={currentModel || 'claude-opus-5-5-high'}
          placeholderTextColor={colors.textMuted}
          autoCapitalize="none"
          style={styles.acpInput}
          onSubmitEditing={() => { void saveAcpModel(); }}
        />
        <ScrollView style={{ maxHeight: 196 }} contentContainerStyle={styles.acpChips} keyboardShouldPersistTaps="handled">
          {acpChoices.models.map(id => {
            const active = id === draftTrim || (!draftTrim && id === currentModel);
            return (
              <Pressable
                key={id}
                testID={`model-palette-acp-suggest-${id}`}
                accessibilityRole="button"
                onPress={() => { setAcpDraft(id); setAcpError(null); setAcpNotice(null); }}
                style={[styles.acpChip, active && { borderColor: colors.accent }]}
              >
                <Text style={[styles.acpChipText, active && { color: colors.accent }]}>{id}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
        <Pressable
          testID="model-palette-acp-save"
          accessibilityRole="button"
          accessibilityState={{ busy: acpSaving, disabled: acpSaving }}
          onPress={() => { void saveAcpModel(); }}
          style={styles.acpSave}
        >
          <Text style={styles.acpSaveText}>{acpSaving ? t('chat.modelPicker.acpSaving') : t('chat.modelPicker.acpSave')}</Text>
        </Pressable>
        {acpError ? (
          <View style={styles.errorBox} testID="model-palette-acp-error">
            <Text style={styles.errorText}>{acpError}</Text>
          </View>
        ) : null}
        {acpNotice ? <Text style={styles.notice} testID="model-palette-acp-notice">{acpNotice}</Text> : null}
      </View>
    );
  }

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
          <Pressable
            testID="model-palette-retry"
            accessibilityRole="button"
            onPress={() => setCatalogAttempt(n => n + 1)}
            style={styles.retryButton}
          >
            <Text style={styles.retryLabel}>{t('chat.modelPicker.retry')}</Text>
          </Pressable>
        </View>
      ) : view.status === 'loading' ? (
        <View style={styles.statusRow} testID="model-palette-loading">
          <ActivityIndicator size="small" color={colors.textMuted} />
          <Text style={styles.statusText}>
            {loadingSlow ? t('chat.modelPicker.loadingSlow', { s: String(loadingRemainingSec) }) : t('chat.modelPicker.loading')}
          </Text>
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
          {/* #4823（通信欧 2026-11-19）：档位是 live-session-only，不能让人以为已持久化。 */}
          <Text style={styles.variantNote} testID="node-variant-live-only">{t('chat.modelPicker.variantLiveOnly')}</Text>
          {variantUnconfirmed ? (
            <Pressable
              testID="composer-variant-recheck"
              accessibilityRole="button"
              onPress={() => { setVariantUnconfirmed(false); void reloadConfig().then(() => setNotice(null)); }}
              style={({ pressed }) => [pressed && { opacity: 0.7 }]}
            >
              <Text style={styles.variantClear}>{t('chat.modelPicker.variantRecheck')}</Text>
            </Pressable>
          ) : null}
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

      {modelSwitchUnsupported ? (
        <View style={styles.errorBox} testID="model-palette-switch-unsupported">
          <Text style={styles.errorText}>{t('chat.modelPicker.switchUnsupported')}</Text>
          {onOpenModelSettings ? (
            <Pressable accessibilityRole="button" onPress={onOpenModelSettings} testID="model-palette-open-model-settings">
              <Text style={styles.statusText}>{t('chat.modelPicker.openModelSettings')}</Text>
            </Pressable>
          ) : null}
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
  // ACP runtime：输入框 + 候选 chip + 保存。
  acpInput: { marginHorizontal: 10, marginTop: 8, fontSize: ds(13), color: colors.text, borderWidth: 1, borderColor: colors.border, borderRadius: radius.control, paddingHorizontal: 10, paddingVertical: 8 },
  acpChips: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: 6, paddingHorizontal: 10, paddingTop: 8 },
  acpChip: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: radius.item, backgroundColor: colors.inputBg },
  acpChipText: { fontSize: ds(11), color: colors.textMuted },
  acpSave: { marginHorizontal: 10, marginTop: 10, marginBottom: 10, paddingVertical: 9, borderRadius: radius.control, backgroundColor: colors.accent, alignItems: 'center' as const },
  acpSaveText: { fontSize: ds(13), color: '#fff', fontWeight: '600' as const },
  agyRowMain: { flex: 1, minWidth: 0, paddingVertical: 5, gap: 2, paddingRight: 8 },
  agyRowTitleLine: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 6 },
  agyLevelPill: { paddingHorizontal: 6, paddingVertical: 1, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.inputBg },
  agyLevelPillCurrent: { borderColor: colors.accent },
  agyLevelText: { fontSize: ds(10), color: colors.textMuted, fontWeight: '500' as const },
  agyRowSlug: { fontSize: ds(11), color: colors.textMuted },
  agyCustomSection: { marginTop: 6, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 4 },
  agyCustomToggle: { flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'space-between' as const, paddingHorizontal: 10, paddingVertical: 6 },
  agyCustomToggleText: { fontSize: ds(12), color: colors.textMuted },
  agyCustomBody: { paddingBottom: 2 },
  agyCustomWarn: { fontSize: ds(11), color: colors.failed, paddingHorizontal: 10, paddingTop: 4, lineHeight: 16 },
  // #4976 —— 错误终态给一个明确的「重试」，别只留一段红字。
  retryButton: { alignSelf: 'flex-start' as const, marginTop: 8, paddingHorizontal: 10, paddingVertical: 5, borderRadius: radius.item, backgroundColor: colors.inputBg },
  retryLabel: { fontSize: ds(12), color: colors.accent },
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
