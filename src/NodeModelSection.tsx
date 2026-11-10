// 节点详情页「模型」区:读 GET /api/nodes/:id/config,选一个建议模型或手输 id,
// 走 update_node_config(RFC-024)下发,然后轮询 config 直到 revision 抬高且
// model 命中,或 90 s 超时。状态机在 node-model-change.ts(纯,可测)。
//
// 样式约定同 NodeDetailScreen:`styles` 用 live binding、不解构;卡片
// colors.card / 12 圆角 / spacing.lg;按钮沿用 retryBtn。
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';
import { Text, TextInput } from './ui-text';

import {
  describeVariantOutcome,
  variantAfterModelSwitch,
  variantChoices,
  variantPhaseBusy,
  variantPhaseText,
  variantValueError,
  variantWritable,
  VARIANT_MAX_POLLS,
  VARIANT_POLL_MS,
  VARIANT_TIMEOUT_MS,
  type VariantChangePhase,
  type VariantOutcome,
} from './node-variant-patch';
import { fetchHubNodes, fetchNodeConfig, pollOpenCodeCatalog, queueOpenCodeCatalog, updateNodeConfig, type HubConfig, type HubNode, type NodeConfigRead } from './api';
import { styles } from './app-styles';
import {
  lastUpdateApplied,
  afterPoll,
  afterSubmit,
  recheckAfterTimeout,
  catalogHint,
  filterModels,
  modelNotOnMachineNote,
  groupCountLabel,
  groupCountLabelFor,
  providerGroupSummary,
  groupModelsByProvider,
  orderGroupsByCurrent,
  modelChips,
  modelControlAvailability,
  phaseIsBusy,
  modelChangeDiag,
  phaseText,
  RESTART_POLL_MS,
  RESTART_TIMEOUT_MS,
  validateModelId,
  type ModelChangePhase,
} from './node-model-change';
import { suggestedModels } from './runtime-catalog';
import { catalogStatusLine, catalogErrorText, isOpenCodeV2Node, modelIdsFromCatalog, peerCatalogSources, reportedCatalogModels, reportsCatalogSince } from './opencode-v2-model-list';
import { opencodeFlagsOf,
  generationOf,
} from './node-info';
import { nodeProviderDaemon } from './node-provider-target';
import { colors, spacing, radius } from './theme';

/**
 * #2293 —— 这台机器**自己上报**的模型清单（`GET /api/nodes` 的 `opencode_catalog`）。
 * 只在这条 daemon 中继链走不通时用：手工 `anet node start` 起的 opencode 节点没有
 * daemon 绑定，`read_opencode_catalog` 永远拿不到列表 → admin 只能手填。
 * 读失败/旧 Hub 一律返回 []（不编内置清单，不假装有）。
 */
/**
 * 这台机器没上报清单时，退而用**同 runtime 其他节点**报过的模型当候选
 * （2026-11-01 admin 截图那台 V2 节点：目录一直没上报，「建议」只剩「当前」一项）。
 */
async function peerModelList(cfg: HubConfig, node: HubNode): Promise<{ models: string[]; nodes: number }> {
  try {
    const { nodes } = await fetchHubNodes(cfg);
    return peerCatalogSources(nodes as { node_id?: string; runtime?: string | null; opencode_catalog?: string[] | null }[] | null, {
      runtime: node.runtime,
      excludeNodeId: node.node_id,
    });
  } catch {
    return { models: [], nodes: 0 };
  }
}

async function reportedModelList(cfg: HubConfig, nodeId: string): Promise<string[]> {
  try {
    const { nodes } = await fetchHubNodes(cfg);
    return reportedCatalogModels((nodes ?? []).find(n => n.node_id === nodeId)?.opencode_catalog);
  } catch {
    return [];
  }
}

/**
 * #4099 一次档位写入的读回判定（观测窗口与「再检查一次」共用，避免两条判定走样）。
 *
 * 双条件：Hub 的 `last_update` 必须真的 applied 且 update_id 与本次提交对齐，
 * **且**顶层 `modelVariant` 已经等于目标（清除档位时目标是 null）。
 * 顶层 modelVariant 才是 server 的真相；config_snapshot 的兼容投影滞后更多，不当判据。
 */
function variantOutcomeOf(
  v: NodeConfigRead | null,
  write: { target: string | null; effectiveModel?: string | null; updateId?: string },
): VariantOutcome {
  const ack = lastUpdateApplied(v?.last_update, write.updateId, write.effectiveModel);
  return describeVariantOutcome({
    applied: ack.applied,
    variantMatches: !!v && v.modelVariant !== undefined && v.modelVariant === write.target,
    target: write.target,
    // 有 error 就原样给；没有就把 last_update 的对齐原因说清楚（比一个裸 status 好读）。
    lastError: v?.last_update?.error ?? (ack.applied ? null : ack.reason),
    lastStatus: v?.last_update?.status ?? null,
  });
}

export default function NodeModelSection({ cfg, node, runtimeVersion, onEffectiveConfig }: { cfg: HubConfig; node: HubNode; runtimeVersion?: string | null; onEffectiveConfig?: (value: NodeConfigRead | null) => void }) {
  const scope = useMemo(() => ({}), [cfg, node.node_id]);
  const currentScope = useRef<object | null>(scope);
  currentScope.current = scope;
  useEffect(() => { currentScope.current = scope; return () => { currentScope.current = null; }; }, [scope]);
  const writeLock = useRef<object | null>(null);
  const readGeneration = useRef(0);
  const callback = useRef(onEffectiveConfig);
  callback.current = onEffectiveConfig;
  // undefined = 还没读到;null = hub 没有这个接口
  const [record, setRecord] = useState<{ scope: object; value: NodeConfigRead | null } | null>(null);
  const view = record?.scope === scope ? record.value : undefined;
  const setView = (value: NodeConfigRead | null) => setRecord({ scope, value });
  const [readFailed, setReadFailed] = useState(false);
  const [picked, setPicked] = useState<string>('');
  // 点了「当前：provider / model」会复制,但以前没有任何反馈 —— 用户不知道到底复制没复制。
  const [currentCopied, setCurrentCopied] = useState(false);
  const [custom, setCustom] = useState('');
  const [phase, setPhase] = useState<ModelChangePhase>({ kind: 'idle' });
  // #4099 档位写入走自己那条状态机：它不改 model，确认条件是 last_update=applied
  // **且**顶层 modelVariant === 目标 —— 复用 model 那条（按 model_effective 确认）会假成功。
  // 文案/忙碌判定都在 node-variant-patch.ts（纯，可测）。
  const [variantPhase, setVariantPhase] = useState<VariantChangePhase>({ kind: 'idle' });
  // 观测窗口的「一次提交」凭据（scope 用对象身份，切节点即失效）。
  const [variantWatch, setVariantWatch] = useState<{ scope: object; target: string | null; effectiveModel: string; updateId?: string } | null>(null);
  const v2 = isOpenCodeV2Node(node);
  const [v2Models, setV2Models] = useState<string[] | null>(null);
  // #4099：per-model variants（catalog 提供后填充；当前未提供 → 未知）
  const [v2VariantMap, setV2VariantMap] = useState<Record<string, unknown> | null>(null);
  // 同 runtime 兄弟节点报过的模型(仅在本机没上报时使用)
  const [peerModels, setPeerModels] = useState<string[]>([]);
  // 贡献候选的兄弟节点台数(写进提示里:数字比一串 id 更可信)
  const [peerNodes, setPeerNodes] = useState(0);
  const [v2Note, setV2Note] = useState('');
  // 「重新读取模型列表」:读失败/读到空之后,人还能自己再敲一次,不用退出重进页面。
  const [catalogAttempt, setCatalogAttempt] = useState(0);
  // 自动再试一次(2026-11-02):daemon 刚重启时,第一轮 15 秒常常抓不到清单,
  // 用户得手动点「重新读取」。这里在本机版本够、却仍读不到时,20 秒后自动再试一次(仅一次)。
  const autoRetried = useRef(false);
  // 换节点要重置「自动重试已用过」的标记:否则从 A 节点切到 B 节点时,B 永远不会自动重试。
  useEffect(() => { autoRetried.current = false; }, [node.node_id]);

  const reload = useCallback(async (publish = true) => {
    const token = scope;
    const generation = ++readGeneration.current;
    try {
      const v = await fetchNodeConfig(cfg, node.node_id);
      if (currentScope.current !== token || generation !== readGeneration.current) return null;
      if (v && v.node_id !== node.node_id) { setReadFailed(true); callback.current?.(null); return null; }
      setRecord({ scope: token, value: v });
      setReadFailed(false);
      if (publish && writeLock.current !== token) callback.current?.(v);
      return v;
    } catch {
      if (currentScope.current === token && generation === readGeneration.current) {
        setReadFailed(true);
        if (publish) callback.current?.(null);
      }
      return null;
    }
  }, [cfg, node.node_id, scope]);

  useEffect(() => { void reload(); }, [reload]);
  useEffect(() => {
    setPhase({ kind: 'idle' }); setV2Models(null); setV2VariantMap(null); setReadFailed(false);
    setPicked(''); setCustom(''); setFilter('');
    setVariantPhase({ kind: 'idle' }); setVariantWatch(null);
  }, [scope]);

  useEffect(() => {
    if (!v2) return;
    let live = true;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    const daemonId = nodeProviderDaemon(node);
    // 中继链失败/走不通时的兜底：改读这台机器自己上报的清单（#2293）。
    const fallback = async (reason: string) => {
      const ids = await reportedModelList(cfg, node.node_id);
      if (!live) return;
      setV2Models(ids);
      if (ids.length) { setV2Note(`${reason}改用这台机器上次上报的 OpenCode 模型清单。`); return; }
      // #2293 —— 空列表时区分「版本太旧不会上报」和「真的还没上报」：
      // 前者给出可执行的升级提示（TMAI欧 / TMAI文档欧 跑的就是 .146），后者仍是“等一等/手输”。
      const fresh = reportsCatalogSince(runtimeVersion);
      const peers = await peerModelList(cfg, node);
      if (!live) return;
      setPeerModels(peers.models);
      setPeerNodes(peers.nodes);
      if (peers.models.length > 0) {
        setV2Note(`${reason}这台机器还没上报模型清单；下面是同 runtime 其他 ${peers.nodes} 台节点报过的模型，点选或用它们开头手输（别的节点的清单，本机未必装了同一个 Provider，选错会拒绝运行）。`);
        return;
      }
      setV2Note(fresh === false
        ? `${reason}这台节点的 agent-node ${runtimeVersion} 不会自动上报模型清单（需 ≥ 2.5.0-preview.160，升级后 3 分钟内生效）—— 现在仍可手输 provider/model。`
        : `${reason}这台机器也还没上报过模型清单 —— 仍可手输 provider/model；20 秒后会自动再试一次。`);
      // 只在「版本够、却仍读不到」且本轮还没自动试过时再试一次,避免无休止轮询。
      if (fresh !== false && !autoRetried.current) {
        autoRetried.current = true;
        retryTimer = setTimeout(() => { if (live) setCatalogAttempt((n) => n + 1); }, 20000);
      }
    };
    if (!daemonId) {
      setV2Note('这个节点没有所属 daemon，正在读它自己上报的模型清单…');
      void fallback('');
      return;
    }
    // #3144 负控发现：同一个 section 实例里 A→B 切节点时，旧节点的候选没有被清掉 ——
    // B 还在 pending 的时候，列表里仍然显示 A 的模型，而且可以直接提交给 B。切节点就当换了一份数据源，
    // 先清空候选/同 runtime 兜底清单，再开始读；否则用户会把 A 的模型名发给 B。
    setV2Models([]);
    setPeerModels([]);
    setPeerNodes(0);
    setV2Note('正在从 OpenCode V2 服务器读取模型列表…');
    void (async () => {
      const queued = await queueOpenCodeCatalog(cfg, { nodeId: node.node_id, daemonNodeId: daemonId });
      if (!live) return;
      if (!queued.ok) { void fallback(catalogErrorText(queued.error)); return; }
      for (let i = 0; i < 15; i++) {
        await new Promise(resolve => setTimeout(resolve, 1000));
        if (!live) return;
        const polled = await pollOpenCodeCatalog(cfg, queued.request_id);
        if (!live) return;
        if (!polled.ok) { void fallback(catalogErrorText(polled.error)); return; }
        if (polled.status === 'ready') {
          const ids = modelIdsFromCatalog(polled.snapshot);
          setV2Models(ids);
          // #4099：把目录里的 per-model variants 记下来（接口没给就是 undefined → UI 显示未知）
          const map: Record<string, unknown> = {};
          for (const m of (polled.snapshot as { models?: Array<{ providerId?: string; id?: string; variants?: unknown }> }).models ?? []) {
            const key = `${m.providerId ?? ''}/${m.id ?? ''}`;
            if (key && m.variants !== undefined) map[key] = m.variants;
          }
          setV2VariantMap(Object.keys(map).length ? map : null);
          setV2Note(ids.length ? '列表来自这台机器上的 OpenCode V2 服务器，不是内置清单。' : 'OpenCode 服务器返回了空列表。仍可手输 provider/model。');
          return;
        }
      }
      if (live) void fallback('OpenCode 服务器还没返回模型列表。');
    })();
    return () => { live = false; if (retryTimer) clearTimeout(retryTimer); };
  }, [v2, cfg, node.node_id, node.lifecycle_daemon_node_id, node.adoption?.daemon_node_id, node.adoption?.status, catalogAttempt]);

  const requested = phase.kind === 'restarting' ? phase.requested : null;
  const baseRevision = phase.kind === 'restarting' ? phase.baseRevision : null;
  // One observation window per accepted change, independent of read latency.
  // Expiry/cleanup invalidates in-flight reads; it never cancels or resubmits
  // the server-side change. Poll counts must not reset the deadline.
  useEffect(() => {
    if (requested === null || baseRevision === null) return;
    const token = scope;
    let active = true;
    let current: Extract<ModelChangePhase, { kind: 'restarting' }> = { kind: 'restarting', requested, baseRevision, polls: 0 };
    let timer: ReturnType<typeof setTimeout>;
    const deadline = Date.now() + RESTART_TIMEOUT_MS;
    const expire = () => {
      if (!active || currentScope.current !== token) return;
      active = false;
      clearTimeout(timer);
      setPhase({ kind: 'timeout', requested });
    };
    const deadlineTimer = setTimeout(expire, RESTART_TIMEOUT_MS);
    const tick = async () => {
      if (!active || currentScope.current !== token) return;
      if (Date.now() >= deadline) { expire(); return; }
      let v: NodeConfigRead | null = null;
      let failed = false;
      try { v = await fetchNodeConfig(cfg, node.node_id); } catch { failed = true; }
      if (!active || currentScope.current !== token) return;
      if (Date.now() >= deadline) { expire(); return; }
      if (!failed) setView(v);
      setReadFailed(failed);
      const next = afterPoll(current, v, undefined, { hot: v2 });
      setPhase(next);
      if (next.kind === 'restarting') {
        current = next;
        timer = setTimeout(tick, RESTART_POLL_MS);
      } else {
        active = false;
        clearTimeout(deadlineTimer);
      }
    };
    timer = setTimeout(tick, RESTART_POLL_MS);
    return () => { active = false; clearTimeout(timer); clearTimeout(deadlineTimer); };
  }, [requested, baseRevision, cfg, node.node_id, scope]);

  // ── #4099 档位写入的观测窗口 ───────────────────────────────────────────────
  // 2026-11-10 真节点实测：写档位 Hub 很快回 applied、会话 ~20s 内翻转，但 Hub 快照的
  // 顶层 modelVariant 要等下一次心跳（几十秒）才跟上。以前这里提交后只读一次就下结论，
  // 于是**成功的切换**被报成红色失败文案（0.2.497 之前那条）。
  // 现在与改模型同构：窗口内反复读，双条件都满足才算成功；窗口只读，绝不重发。
  const activeVariantWatch = variantWatch && variantWatch.scope === scope ? variantWatch : null;
  useEffect(() => {
    if (!activeVariantWatch) return;
    const watch = activeVariantWatch;
    const token = scope;
    let active = true;
    let current: Extract<VariantChangePhase, { kind: 'verifying' }> = { kind: 'verifying', target: watch.target, polls: 0 };
    let timer: ReturnType<typeof setTimeout> | null = null;
    const deadline = Date.now() + VARIANT_TIMEOUT_MS;
    const outcomeOf = (v: NodeConfigRead | null): VariantOutcome => variantOutcomeOf(v, watch);
    const settle = (v: NodeConfigRead | null) => {
      if (!active || currentScope.current !== token) return;
      active = false;
      if (timer) clearTimeout(timer);
      const outcome = outcomeOf(v);
      setVariantPhase({ kind: 'result', target: watch.target, effectiveModel: watch.effectiveModel, updateId: watch.updateId, outcome });
      setVariantWatch(null);
      if (outcome.kind === 'applied' && v) callback.current?.(v);
    };
    const tick = async () => {
      if (!active || currentScope.current !== token) return;
      let v: NodeConfigRead | null = null;
      let failed = false;
      try { v = await fetchNodeConfig(cfg, node.node_id); } catch { failed = true; }
      if (!active || currentScope.current !== token) return;
      if (!failed) setView(v);
      setReadFailed(failed);
      if (!failed && v && outcomeOf(v).kind === 'applied') { settle(v); return; }
      const polls = current.polls + 1;
      if (polls >= VARIANT_MAX_POLLS || Date.now() >= deadline) { settle(failed ? null : v); return; }
      current = { kind: 'verifying', target: watch.target, polls };
      setVariantPhase(current);
      timer = setTimeout(tick, VARIANT_POLL_MS);
    };
    timer = setTimeout(tick, VARIANT_POLL_MS);
    return () => { active = false; if (timer) clearTimeout(timer); };
  }, [activeVariantWatch, cfg, node.node_id, scope]);

  // V2 共存节点上纯 model 是 hot 变更:不受 config_update_capable 限制(它只挡重启级).
  const availability = modelControlAvailability(view === undefined ? null : view, { hotModel: v2 });
  const busy = phaseIsBusy(phase) || variantPhaseBusy(variantPhase);
  // 机器上报了 V2 目录就用它;没上报(常见:刚接入/还没轮询到)就退回内置候选,
  // 否则「建议」里只剩「当前」那一个 chip,用户会以为没法切换(admin 2026-11-01 截图)。
  const v2Catalog = v2Models ?? [];
  const suggestions = v2 && v2Catalog.length > 0
    ? v2Catalog
    : (v2 && peerModels.length > 0 ? peerModels : suggestedModels(node.runtime));
  const usingBuiltinFallback = v2 && v2Catalog.length === 0 && peerModels.length === 0;
  const usingPeerFallback = v2 && v2Catalog.length === 0 && peerModels.length > 0;
  const currentModel = view?.model_effective ?? view?.model ?? node.model ?? node.config_snapshot?.model ?? null;
  const candidate = custom.trim() ? custom : picked;
  // 只在「opencode 系 runtime 却没写代际」时提示;写了 v1/v2 或不是 opencode 都不打扰。
  const isOpenCodeRuntime = /opencode/i.test(node.runtime ?? '');
  const generationUnset = isOpenCodeRuntime && !generationOf(node);
  const chips = modelChips(suggestions, currentModel);
  // 目录大的时候(OpenCodeV2 常有几十个模型)一屏放不下,加一个筛选框;列表短就不出现,免得喧宾夺主。
  const [filter, setFilter] = useState('');
  const shownChips = filterModels(chips, filter);
  const showFilter = chips.length >= 8;
  // 当前模型所在的 Provider 组排最前:换模型多是「同 Provider 内换一个」。
  const groups = orderGroupsByCurrent(groupModelsByProvider(shownChips), currentModel);
  const hint = v2
    ? (usingPeerFallback ? v2Note
      : usingBuiltinFallback ? '这台机器还没上报模型清单，下面是内置候选（可能滞后于实际可用模型）。'
      : v2Note)
    : catalogHint(node.runtime);
  // 只在 V2 目录**读到了**的时候才谈「不在列表里」:目录为空/读不到 ⇒ 不知道,不乱报。
  const notOnMachine = v2 && (v2Models?.length ?? 0) > 0 ? modelNotOnMachineNote(currentModel, v2Models ?? []) : null;
  // 内置候选只是 OpenCode Zen 的两个免费模型;这类节点多半跑别的 Provider,
  // 所以手输框直接把「当前 Provider」当样板,减少用户猜格式。
  const providerPrefix = typeof currentModel === 'string' && currentModel.includes('/')
    ? currentModel.slice(0, currentModel.indexOf('/')) : '';
  // 注意:placeholder 前半段必须保留「模型 id(provider/model)」——
  // tests/model-change-deadline 用这个文案定位输入框,只改后半段补充内容。
  const inputPlaceholder = usingBuiltinFallback && providerPrefix
    ? `模型 id(provider/model)，如 ${providerPrefix}/<模型名>`
    : (suggestions.length > 0 ? '或手输模型 id(provider/model)' : '模型 id(provider/model)');

  // 真正下发一次配置变更。抽出来是为了让「超时后再下发一次」复用同一条路径,
  // 而不是让用户重新在列表/输入框里把同一个模型再选一遍。
  const applyModel = async (model: string) => {
    if (!view || busy || writeLock.current === scope) return;
    const token = scope;
    writeLock.current = token;
    ++readGeneration.current;
    // 换模型就把档位那条状态收起来：两条状态机不同时挂在界面上（避免旧结论误导）。
    setVariantPhase({ kind: 'idle' });
    setVariantWatch(null);
    setPhase({ kind: 'submitting', requested: model });
    try {
      const res = await updateNodeConfig(cfg, { nodeId: node.node_id, baseRevision: view.config_revision, patch: { model } });
      if (currentScope.current !== token) return;
      if (v2 && res.ok) {
        // 改模型在 V2 共存节点上要么热切、要么以新模型重启;两种都不是「立刻」能读到的。
        // 以前这里只 reload 一次就判失败,于是必然报“已接受,但生效模型未确认” ——
        // 明明已下发、节点还在重启。交给下面那条统一的 90s 观测窗口去确认,
        // 只有真的读到 model_effective === 目标才算成功(读不回就不冒充成功)。
        setPhase(afterSubmit(model, view.config_revision, res, currentModel, { hot: true }));
        return;
      }
      // Legacy restart controls keep their existing revision observation path.
      const next = afterSubmit(model, view.config_revision, res, currentModel, { hot: v2 });
      if (next.kind === 'conflict') void reload();
      if (next.kind === 'applied') setFilter('');
      setPhase(next);
    } finally { if (writeLock.current === token) writeLock.current = null; }
  };

  // #4099 档位：能力门 = 节点显式声明；写 = 同 model + modelVariant（hot）。不拼后缀、不硬编码档位。
  const variantGate = variantWritable({ variantCapable: view?.opencode_variant_config_capable === true, runtime: node.runtime ?? null });
  const variantOpts = (() => {
    // 目录里的 per-model variants（接口就绪后由 catalog 快照提供）；当前未提供 → 未知，绝不编造
    const perModel = (v2VariantMap as Record<string, unknown> | null) ?? null;
    return variantChoices(perModel ? perModel[view?.model_effective ?? ''] : undefined);
  })();
  const currentVariant = view?.modelVariant;

  // #4099：切模型时原档位是否适配（keep / clear / must-reselect）——只提示，不自动改配置。
  const pendingModel = (() => {
    const raw = (typeof candidate === 'string' ? candidate : '').trim();
    return raw || null;
  })();
  const variantHint = pendingModel && pendingModel !== currentModel && currentVariant
    ? variantAfterModelSwitch({
        previousModel: currentModel,
        nextModel: pendingModel,
        currentVariant,
        nextModelVariants: v2VariantMap ? v2VariantMap[pendingModel] : undefined,
      })
    : null;

  const applyVariant = async (nextVariant: string | null) => {
    if (!view || busy || !variantGate.ok || writeLock.current === scope) return;
    const err = variantValueError(nextVariant);
    if (err) {
      setVariantPhase({ kind: 'result', target: nextVariant, outcome: { kind: 'failed', tone: 'error', text: `失败：${err}`, code: err } });
      return;
    }
    const effectiveModel = view.model_effective;
    if (!effectiveModel) {
      setVariantPhase({ kind: 'result', target: nextVariant, outcome: { kind: 'failed', tone: 'error', text: '失败：生效模型未知，不能写档位', code: 'model_effective_unknown' } });
      return;
    }
    const token = scope;
    writeLock.current = token;
    ++readGeneration.current;
    // 档位这条和模型那条互斥：开始写档位就把模型那边的旧结论清掉。
    setPhase({ kind: 'idle' });
    setVariantWatch(null);
    setVariantPhase({ kind: 'submitting', target: nextVariant });
    try {
      const res = await updateNodeConfig(cfg, {
        nodeId: node.node_id,
        baseRevision: view.config_revision,
        // 同 model 只改档位：显式带 modelVariant（=hot），不传 flags/channels
        patch: { model: effectiveModel, modelVariant: nextVariant },
      });
      if (currentScope.current !== token) return;
      if (res.ok) {
        // 回 ok 只是 ack：顶层 modelVariant 要等下一次心跳才跟上。交给 60s 观测窗口确认，
        // 双条件都满足才 applied；窗口内只读，绝不重发（节点自己的 writer 已经等过一轮）。
        setVariantWatch({ scope: token, target: nextVariant, effectiveModel, updateId: res.update_id });
        return;
      }
      if (res.conflict) { void reload(); setPhase({ kind: 'conflict' }); setVariantPhase({ kind: 'idle' }); return; }
      // variant_busy 不是失败：这一轮还在跑，档位会对下一轮生效（分类在纯模块里）。
      setVariantPhase({
        kind: 'result',
        target: nextVariant,
        effectiveModel,
        outcome: describeVariantOutcome({ applied: false, variantMatches: false, target: nextVariant, lastError: res.error }),
      });
    } finally { if (writeLock.current === token) writeLock.current = null; }
  };

  const submit = async () => {
    if (!view || busy) return;
    const v = validateModelId(candidate);
    if (!v.ok) { setPhase({ kind: 'error', message: v.reason }); return; }
    if (v.model === currentModel) { setPhase({ kind: 'error', message: '和当前模型相同,无需修改' }); return; }
    await applyModel(v.model);
  };

  // 档位那条状态机的展示文本/色调（idle 是空串，不渲染）。
  const variantText = variantPhaseText(variantPhase);
  const variantTone = variantPhase.kind === 'result' ? variantPhase.outcome.tone : 'neutral';

  return (
    <View style={{ paddingTop: spacing.xl }}>
      <Text style={{ color: colors.textMuted, fontSize: 13, marginBottom: spacing.sm }}>模型</Text>
      <View style={{ backgroundColor: colors.card, borderRadius: radius.surface, padding: spacing.lg, gap: spacing.md }}>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <Text style={{ color: colors.textMuted, width: 96, fontSize: 13 }}>当前模型</Text>
          <Text style={{ color: colors.text, flex: 1, fontSize: 14 }} selectable>
            {currentModel || (view === undefined && !readFailed ? '读取中…' : '—')}
          </Text>
        </View>
        {variantHint && variantHint.action !== 'keep' ? (
          <Text testID="node-variant-hint" style={{ color: colors.textMuted, fontSize: 12, lineHeight: 18 }}>
            {`切到 ${pendingModel} 后原档位可能不再适用：不会自动清除，请手动选择或清除档位`}
          </Text>
        ) : null}
        <View testID="node-variant-row" style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6 }}>
          <Text style={{ color: colors.textMuted, width: 96, fontSize: 13 }}>思考档位</Text>
          {!variantGate.ok ? (
            <Text testID="node-variant-disabled" style={{ color: colors.textMuted, fontSize: 12, flex: 1 }}>
              {variantGate.reason}
            </Text>
          ) : variantOpts.kind === 'unknown' ? (
            <Text testID="node-variant-unknown" style={{ color: colors.textMuted, fontSize: 12, flex: 1 }}>
              未知：本节点目录未提供该模型的 variants
            </Text>
          ) : variantOpts.kind === 'none' ? (
            <Text testID="node-variant-none" style={{ color: colors.textMuted, fontSize: 12, flex: 1 }}>
              该模型没有可选档位{currentVariant ? `（当前上报 ${currentVariant}）` : ''}
            </Text>
          ) : (
            <>
              {variantOpts.options.map(v => (
                <Pressable
                  key={v}
                  testID={`node-variant-chip-${v}`}
                  disabled={busy}
                  onPress={() => void applyVariant(v === currentVariant ? null : v)}
                  style={({ pressed }) => [{ paddingHorizontal: 10, paddingVertical: 4, borderRadius: radius.pill, borderWidth: 1, borderColor: v === currentVariant ? colors.accent : colors.border, opacity: pressed ? 0.6 : 1 }]}
                >
                  <Text style={{ fontSize: 12, color: v === currentVariant ? colors.accent : colors.text }}>
                    {v}{v === currentVariant ? '（当前）' : ''}
                  </Text>
                </Pressable>
              ))}
              {currentVariant ? (
                <Pressable testID="node-variant-clear" onPress={() => void applyVariant(null)} disabled={busy}>
                  <Text style={{ fontSize: 12, color: colors.textMuted }}>清除档位</Text>
                </Pressable>
              ) : null}
            </>
          )}
        </View>
        {/* 代际没声明(opencode 系 runtime 但 flags 里没有 opencodeGeneration)时,
            模型清单很可能是读不到的——这是排查里最常见的一步,提前说一句。 */}
        {isOpenCodeRuntime && generationUnset ? (
          <Text testID="node-model-gen-unset" style={{ color: colors.textMuted, fontSize: 12, lineHeight: 18 }}>
            这台节点没有声明 OpenCode 代际（gen=unset），模型清单可能读不到；把节点诊断行贴给它的运维就能定位。
          </Text>
        ) : null}
        {/* 贴到群里的诊断行(gen=/catalog=/agent=/net=)得有人能读:
            这里给一行字段表,省得每次再解释一遍。 */}
        <Text testID="node-model-diag-legend" style={{ color: colors.textMuted, fontSize: 11, lineHeight: 16 }}>
          诊断行字段：gen=代际（v1 不报清单） · mode=共存/单飞 · catalog=清单上报 · agent=agent-node 版本 · net=网络 · client=客户端版本
        </Text>
        {readFailed && view === undefined ? (
          <Text style={{ color: colors.failed, fontSize: 12 }}>读取节点配置失败。<Text style={{ color: colors.accent }} onPress={() => void reload()}>重试</Text></Text>
        ) : null}
        {view !== undefined && !availability.enabled ? (
          <Text style={{ color: colors.textMuted, fontSize: 12, lineHeight: 18 }}>{availability.hint}</Text>
        ) : null}
        {availability.enabled ? (
          <>
            <Text style={{ color: colors.textMuted, fontSize: 12, lineHeight: 18 }}>
              改模型不经过任何大模型:Hub 下发后节点自己写配置并重启一次(约 5–45 秒),期间它不接任务。
            </Text>
            {/* 点一下整行复制:把这句原样发给后端/别人,对方不用再问「哪个节点、什么版本」。 */}
            {/* 内置候选是 OpenCode Zen 的两个免费模型;而这类节点常常跑别的 Provider,
                直接从「当前模型」里取出 provider 前缀提示一句,省得用户不知道手输什么。 */}
            {usingBuiltinFallback && currentModel && currentModel.includes('/') ? (
              <Text testID="node-model-provider-hint" style={{ color: colors.textMuted, fontSize: 12, lineHeight: 18 }}>
                {`这台机器当前用的是 ${currentModel.slice(0, currentModel.indexOf('/'))}，可在下面手输 ${currentModel.slice(0, currentModel.indexOf('/'))}/<模型名>。`}
              </Text>
            ) : null}
            {!v2 ? (
              <Text testID="node-model-catalog-na" style={{ color: colors.textMuted, fontSize: 12, lineHeight: 18 }}>
                这个 runtime 不上报模型清单，模型由节点自己的配置决定（下面的候选是内置建议）。
              </Text>
            ) : null}
            {v2 ? (
              <Text testID="node-model-catalog-status" style={{ color: colors.textMuted, fontSize: 12, lineHeight: 18 }}
                onPress={() => {
                  const line = `${catalogStatusLine(v2Catalog.length, runtimeVersion)} node_id=${node.node_id}${node.runtime ? ` runtime=${node.runtime}` : ''}`;
                  void import('expo-clipboard').then(m => m.setStringAsync(line)).catch(() => undefined);
                }}>
                {catalogStatusLine(v2Catalog.length, runtimeVersion)}
                {v2Catalog.length === 0 ? '（下方按钮可立刻重试）' : ''}
              </Text>
            ) : null}
            {v2 && hint ? <Text testID="opencode-v2-models-note" style={{ color: colors.textMuted, fontSize: 12, lineHeight: 18 }}>{hint}</Text> : null}
            {usingBuiltinFallback || usingPeerFallback ? (
              <Pressable testID="node-model-catalog-retry" disabled={busy}
                onPress={() => setCatalogAttempt((n) => n + 1)}
                style={({ pressed }) => [
                  { alignSelf: 'flex-start', borderWidth: 1, borderColor: colors.accent, borderRadius: radius.control, paddingHorizontal: spacing.md, height: 30, justifyContent: 'center' },
                  pressed && { opacity: 0.7 },
                ]}>
                <Text style={{ color: colors.accent, fontSize: 12 }}>重新读取模型列表</Text>
              </Pressable>
            ) : null}
            {notOnMachine ? (
              <Text testID="model-not-on-machine" style={{ color: colors.blocked, fontSize: 12, lineHeight: 18 }}>{notOnMachine}</Text>
            ) : null}
            {/* 当前 Provider / 模型单独一行:分组展示后,"我现在在哪个 provider 下"不该靠 chip 上的小字去找。 */}
            <Text style={{ color: colors.textSecondary, fontSize: 12 }} testID="node-model-current"
              onPress={() => {
                const cur = (currentModel ?? '').trim();
                if (!cur) return;
                void import('expo-clipboard').then(m => m.setStringAsync(cur)).then(() => {
                  setCurrentCopied(true);
                  setTimeout(() => setCurrentCopied(false), 1600);
                }).catch(() => undefined);
              }}>
              当前：{(() => {
                const cur = (currentModel ?? '').trim();
                if (!cur) return '未设置';
                const slash = cur.indexOf('/');
                return slash > 0 ? `${cur.slice(0, slash)} / ${cur.slice(slash + 1)}` : cur;
              })()}{currentCopied ? '（已复制）' : ''}
            </Text>

            {chips.length > 0 ? (
              <View style={{ gap: spacing.sm }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
                  <Text style={{ color: colors.textMuted, fontSize: 12 }}>建议</Text>
                  {showFilter ? (
                    <TextInput
                      value={filter}
                      onChangeText={setFilter}
                      editable={!busy}
                      placeholder="筛选（provider 或模型名）"
                      placeholderTextColor={colors.textMuted}
                      autoCapitalize="none"
                      autoCorrect={false}
                      testID="node-model-filter"
                      style={{ flex: 1, borderWidth: 1, borderColor: colors.border, borderRadius: radius.control, paddingHorizontal: spacing.md, height: 30, color: colors.text, fontSize: 12 }}
                    />
                  ) : null}
                  {showFilter && filter.trim() ? (
                    <Text style={{ color: colors.accent, fontSize: 12 }} onPress={() => setFilter('')} testID="node-model-filter-clear">清除</Text>
                  ) : null}
                </View>
                {showFilter && shownChips.length === 0 ? (
                  <Text style={{ color: colors.textMuted, fontSize: 12 }} testID="node-model-filter-empty">没有匹配「{filter.trim()}」的模型;清掉筛选,或在下面直接手输模型 id。</Text>
                ) : null}
                {providerGroupSummary(groups) ? (
                  <Text style={{ color: colors.textMuted, fontSize: 12 }} testID="node-model-group-summary">
                    {providerGroupSummary(groups)}
                  </Text>
                ) : null}
                {groups.map(g => (
                  <View key={g.provider} style={{ gap: 4 }} testID={`node-model-provider-${g.provider}`}>
                    <Text style={{ color: colors.textSecondary, fontSize: 12 }}>{groupCountLabelFor(g, currentModel)}</Text>
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
                {g.models.map(m => {
                  const active = !custom.trim() && (picked ? picked === m : m === currentModel);
                  return (
                    <Pressable
                      key={m}
                      disabled={busy}
                      accessibilityState={{ selected: active }}
                      onPress={() => { setPicked(m); setCustom(''); }}
                      style={({ pressed }) => [
                        { borderWidth: 1, borderRadius: radius.control, paddingHorizontal: spacing.md, height: 34, justifyContent: 'center', borderColor: active ? colors.accent : colors.border, backgroundColor: colors.card },
                        pressed && { opacity: 0.7 },
                        busy && { opacity: 0.5 },
                      ]}
                    >
                      <Text style={{ color: active ? colors.accent : colors.text, fontSize: 13 }}>{m}{m === currentModel ? '(当前)' : active ? ' ✓' : ''}</Text>
                    </Pressable>
                  );
                })}
                    </View>
                  </View>
                ))}
                {!v2 && hint ? <Text style={{ color: colors.textMuted, fontSize: 12, lineHeight: 18 }}>{hint}</Text> : null}
              </View>
            ) : null}
            <TextInput
              value={custom.trim() ? custom : picked}
              onChangeText={(text) => { setCustom(text); if (picked) setPicked(''); }}
              editable={!busy}
              placeholder={inputPlaceholder}
              placeholderTextColor={colors.textMuted}
              autoCapitalize="none"
              autoCorrect={false}
              style={{ borderWidth: 1, borderColor: colors.border, borderRadius: radius.control, paddingHorizontal: spacing.md, height: 36, color: colors.text, fontSize: 13 }}
            />
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
              <Pressable
                disabled={busy || !candidate}
                onPress={() => void submit()}
                style={({ pressed }) => [styles.retryBtn, (busy || !candidate) && { opacity: 0.5 }, pressed && { opacity: 0.7 }]}
              >
                <Text style={styles.retryBtnText}>{busy ? '处理中…' : '切换模型'}</Text>
              </Pressable>
              {busy ? <ActivityIndicator size="small" color={colors.accent} /> : null}
            </View>
          </>
        ) : null}
        {phase.kind !== 'idle' ? (
          <Text style={{ color: phase.kind === 'applied' ? colors.running : phase.kind === 'error' || phase.kind === 'timeout' || phase.kind === 'conflict' ? colors.failed : colors.textMuted, fontSize: 12, lineHeight: 18 }}>
            {phaseText(phase)}
          </Text>
        ) : null}
        {/* #4099 档位：等待/成功/滞后/忙碌/失败各有各的话，中性态一律不上红字。 */}
        {variantText ? (
          <Text testID="node-variant-status" style={{ color: variantTone === 'success' ? colors.running : variantTone === 'error' ? colors.failed : colors.textMuted, fontSize: 12, lineHeight: 18 }}>
            {variantText}
          </Text>
        ) : null}
        {variantPhase.kind === 'result' && variantPhase.outcome.kind === 'lagging' && !busy ? (
          <Pressable accessibilityRole="button" testID="node-variant-recheck"
            onPress={async () => {
              const receipt = variantPhase;
              const token = scope;
              try {
                const v = await fetchNodeConfig(cfg, node.node_id);
                if (currentScope.current !== token) return;
                if (v) setView(v);
                const outcome = variantOutcomeOf(v, receipt);
                setVariantPhase({ ...receipt, outcome });
                if (outcome.kind === 'applied' && v) callback.current?.(v);
              } catch { /* 读失败就保留原结论：再点一次即可，不重发 */ }
            }}
            style={state => [{ alignSelf: 'flex-start' }, ((state as { hovered?: boolean }).hovered || state.pressed) && { opacity: 0.7 }]}>
            <Text style={{ color: colors.accent, fontSize: 12 }}>再检查一次</Text>
          </Pressable>
        ) : null}
        {/* 0.486:超时/报错/冲突时给一行可复制的诊断(只含 node_id/runtime/from/target,不含 token)。
            用户贴回来这一行,运维就不用再问五个问题。 */}
        {(() => {
          const line = modelChangeDiag(phase, {
            nodeId: node.node_id,
            runtime: node.runtime ?? runtimeVersion ?? null,
            current: currentModel ?? view?.model ?? null,
            target: phase.kind === 'timeout' ? phase.requested : candidate,
          });
          if (!line) return null;
          return (
            <Pressable accessibilityRole="button" testID="node-model-diag-copy"
              accessibilityLabel="复制模型切换诊断"
              onPress={() => { void import('expo-clipboard').then(m => m.setStringAsync(line)).catch(() => undefined); }}
              style={state => [{ alignSelf: 'flex-start' }, ((state as { hovered?: boolean }).hovered || state.pressed) && { opacity: 0.7 }]}>
              <Text selectable style={{ color: colors.textMuted, fontSize: 11, lineHeight: 16 }}>{line}</Text>
            </Pressable>
          );
        })()}
        {/* 切换成功后给「切回上一版」:换错了不用再翻列表找回去。 */}
        {phase.kind === 'applied' && phase.previous && phase.previous !== phase.model && !busy ? (
          <Pressable accessibilityRole="button" onPress={() => void applyModel(phase.previous as string)} testID="node-model-revert"
            style={state => [{ alignSelf: 'flex-start' }, ((state as { hovered?: boolean }).hovered || state.pressed) && { opacity: 0.7 }]}>
            <Text style={{ color: colors.accent, fontSize: 12 }}>切回 {phase.previous}</Text>
          </Pressable>
        ) : null}
        {/* 失败(如网络抖动)后按原样再试一次:输入框里的内容没变,不该逼用户重选。 */}
        {phase.kind === 'error' && !busy && validateModelId(candidate).ok ? (
          <Pressable accessibilityRole="button" onPress={() => void submit()} testID="node-model-retry-error"
            style={state => [{ alignSelf: 'flex-start' }, ((state as { hovered?: boolean }).hovered || state.pressed) && { opacity: 0.7 }]}>
            <Text style={{ color: colors.accent, fontSize: 12 }}>再试一次</Text>
          </Pressable>
        ) : null}
        {/* 超时后节点可能只是还没重启完:给一个「再下发一次」,不用重新选模型。 */}
        {phase.kind === 'timeout' && !busy ? (
          <View style={{ flexDirection: 'row', gap: 12 }}>
            {/* 0.2.474:超时先「再检查一次」——读一次配置就能定论,别让用户以为必须重下发。 */}
            <Pressable accessibilityRole="button" testID="node-model-recheck"
              onPress={async () => {
                const before = phase;
                const token = scope;
                try {
                  const v = await fetchNodeConfig(cfg, node.node_id);
                  if (currentScope.current !== token) return;
                  const next = recheckAfterTimeout(before, v);
                  setPhase(next);
                  if (next.kind === 'restarting') setPhase({ kind: 'timeout', requested: before.requested, previous: before.previous, hot: before.hot });
                } catch {
                  if (currentScope.current === token) setPhase(before);
                }
              }}
              style={state => [{ alignSelf: 'flex-start' }, ((state as { hovered?: boolean }).hovered || state.pressed) && { opacity: 0.7 }]}>
              <Text style={{ color: colors.accent, fontSize: 12 }}>再检查一次</Text>
            </Pressable>
            <Pressable accessibilityRole="button" onPress={() => void applyModel(phase.requested)} testID="node-model-retry-timeout"
              style={state => [{ alignSelf: 'flex-start' }, ((state as { hovered?: boolean }).hovered || state.pressed) && { opacity: 0.7 }]}>
              <Text style={{ color: colors.textSecondary, fontSize: 12 }}>再下发一次（{phase.requested}）</Text>
            </Pressable>
          </View>
        ) : null}
      </View>
    </View>
  );
}
